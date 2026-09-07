import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient, type RolValue } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import { esViolacionDeClaveForanea } from "@/lib/repositories/_shared/prisma-fk";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { zonaUnicaDeDistrito } from "@/lib/repositories/_shared/zona-colapso";
import { normalizeName } from "@/lib/utils/normalize";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import type { ImpactoZonaCentralDTO, TarifaZonaMensajeroDTO, ZonaDTO } from "@/lib/types/zona";
import type {
  CreateZonaData,
  DeleteZonaResult,
  IZonaRepository,
  ListZonasParams,
  ListZonasResult,
  UpdateZonaData,
  UpdateZonaResult,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { OpcionCatalogo } from "@/lib/types/filtros-ordenes";

// Delegates + $transaction necesarios (permite acotar/mocakear en tests).
type ZonaPrismaClient = Pick<
  PrismaClient,
  | "zona"
  | "zonaDistrito"
  | "tarifaZonaMensajero"
  | "distrito"
  | "vehiculo"
  | "$transaction"
  // FICHA 362 (R9): el borrado registra su accion en la MISMA transaccion que el `delete`.
  | "historialAccion"
  | "usuario"
  // FICHA 376 (Q4): el conteo de ordenes vivas que re-tarifaria mover la marca de zona central.
  | "orden"
>;

/** Una zona nombrada, tal como la necesita una fila del historial (376/R12/R13). */
interface ZonaConNombre {
  id: string;
  nombre: string;
}

/**
 * ⭑ FICHA 376 (R12/R13/R15) — LAS FILAS DEL CAMBIO DE MARCA, UNA POR ZONA AFECTADA.
 *
 * `centralPrevia` es la zona que PIERDE la marca sin que nadie la haya nombrado en el payload —el
 * caso que hoy no deja ningun rastro— y puede no existir (R8: la base puede no tener central).
 * `zonaQueLaGana` es la que se guardo o se acaba de crear.
 *
 * `valorAnterior`/`valorNuevo` en `"true"`/`"false"` es el precedente LITERAL de
 * `usuario_fulfillment_cambiado` (`UserRepository`): sin ellos la fila diria «alguien toco la
 * marca» sin decir en que direccion. `monto` va a `null` por defecto en `appendAccion`: lo que se
 * mueve no es un importe, son dos tarifas por cada tienda de dos zonas enteras.
 */
function filasDeCambioDeMarca(
  centralPrevia: ZonaConNombre | null,
  zonaQueLaGana: ZonaConNombre,
  actor: { actorUsuarioId: string | null; actorNombre: string | null; actorRol: RolValue | null },
) {
  const entrada = (zona: ZonaConNombre, anterior: boolean) => ({
    accion: "zona_central_cambiada" as const,
    entidadTipo: "zona" as const,
    entidadId: zona.id,
    entidadEtiqueta: etiquetaDeEntidad("zona", { nombre: zona.nombre }),
    valorAnterior: anterior ? "true" : "false",
    valorNuevo: anterior ? "false" : "true",
    ...actor,
  });
  return [
    ...(centralPrevia === null ? [] : [entrada(centralPrevia, true)]),
    entrada(zonaQueLaGana, false),
  ];
}

type TarifaRow = {
  id: string;
  cobroEntregado: Prisma.Decimal;
  cobroRechazado: Prisma.Decimal;
  vehiculoId: string | null;
};

function tarifaToDTO(row: TarifaRow): TarifaZonaMensajeroDTO {
  return {
    id: row.id,
    cobroEntregado: row.cobroEntregado.toNumber(),
    cobroRechazado: row.cobroRechazado.toNumber(),
    vehiculoId: row.vehiculoId,
  };
}

function toDTO(
  zona: { id: string; nombre: string; cobroVehiculo: boolean; esCentral: boolean },
  distritosCount: number,
  tarifas: TarifaRow[] | undefined,
): ZonaDTO {
  const dto: ZonaDTO = {
    id: zona.id,
    nombre: zona.nombre,
    cobroVehiculo: zona.cobroVehiculo,
    distritosCount,
    esCentral: zona.esCentral,
  };
  if (tarifas !== undefined) dto.tarifas = tarifas.map(tarifaToDTO);
  return dto;
}

// Feature 55/R6: el indice unico parcial `zona_es_central_unico` garantiza <=1
// central a nivel DB. Si por una carrera se colara un segundo `es_central=true`,
// Prisma lanzaria P2002; lo traducimos a un ConflictError de dominio (no un 500)
// SOLO cuando el conflicto es sobre la constraint de es_central.
// `textoConstraintP2002` disambigua de forma robusta tanto en el motor nativo
// (`meta.target`) como bajo el driver adapter
// (`meta.driverAdapterError.cause.originalMessage`, donde vive el nombre real del
// indice `zona_es_central_unico`).
function isEsCentralUniqueViolation(e: unknown): boolean {
  const texto = textoConstraintP2002(e);
  if (!texto) return false;
  return texto.includes("es_central") || texto.includes("zona_es_central_unico");
}

function translateEsCentralConflict(e: unknown): never {
  if (isEsCentralUniqueViolation(e)) {
    throw new ConflictError("Ya existe una zona central");
  }
  throw e;
}

function tarifaCreateRows(zonaId: string, tarifas: CreateZonaData["tarifas"]) {
  return tarifas.map((t) => ({
    zonaId,
    cobroEntregado: new Prisma.Decimal(t.cobroEntregado),
    cobroRechazado: new Prisma.Decimal(t.cobroRechazado),
    vehiculoId: t.vehiculoId,
  }));
}

export class ZonaRepository implements IZonaRepository {
  constructor(private readonly prisma: ZonaPrismaClient) {}

  /**
   * ⭑ FICHA 376 (R12) — CREAR UNA ZONA CENTRAL TAMBIEN ES UN TRASLADO, Y TAMBIEN DEJA RASTRO.
   *
   * `create` con la marca encendida le quita la marca a la central anterior EXACTAMENTE igual que
   * `update` (el `updateMany` de abajo, que estaba aqui desde la feature 55). Que crear una zona
   * no tenga tipo propio en el catalogo no es motivo para que el traslado que provoca sea
   * invisible: las dos filas que escribe son las MISMAS que las de un guardado.
   */
  async create(data: CreateZonaData, actorUsuarioId: string | null): Promise<ZonaDTO> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 376/R12: la central previa se lee ANTES del `updateMany` que la apaga. Despues ya no
        // habria a quien preguntar: el `updateMany` no devuelve las filas que toco.
        const centralPrevia =
          data.esCentral === true
            ? await tx.zona.findFirst({
                where: { esCentral: true },
                select: { id: true, nombre: true },
              })
            : null;

        // Feature 55/R5/R6 (F1.4-A = reasignar): si esta zona sera central, desmarca
        // cualquier central previa ANTES de crear, para no violar el indice unico parcial.
        if (data.esCentral === true) {
          await tx.zona.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
        }
        const zona = await tx.zona.create({
          data: { nombre: data.nombre, cobroVehiculo: data.cobroVehiculo, esCentral: data.esCentral },
        });
        if (data.distritoIds.length > 0) {
          await tx.zonaDistrito.createMany({
            data: data.distritoIds.map((distritoId) => ({ zonaId: zona.id, distritoId })),
          });
        }
        if (data.tarifas.length > 0) {
          await tx.tarifaZonaMensajero.createMany({ data: tarifaCreateRows(zona.id, data.tarifas) });
        }

        // 376/R12-R17: DENTRO del callback y con la `tx`, nunca `this.prisma`. Una zona creada SIN
        // la marca no entra aqui y no deja ni una fila (R18).
        if (data.esCentral === true) {
          const actor = await resolverActorCongelado(tx, actorUsuarioId);
          await appendAccion(
            tx,
            filasDeCambioDeMarca(centralPrevia, { id: zona.id, nombre: zona.nombre }, actor),
            randomUUID(), // 376/R15: UN lote por creacion, aunque produzca dos filas.
          );
        }

        const tarifas = await tx.tarifaZonaMensajero.findMany({ where: { zonaId: zona.id } });
        return toDTO(zona, data.distritoIds.length, tarifas);
      });
    } catch (e) {
      translateEsCentralConflict(e);
    }
  }

  async findById(id: string, includeTarifas: boolean): Promise<ZonaDTO | null> {
    const zona = await this.prisma.zona.findUnique({
      where: { id },
      include: { _count: { select: { distritos: true } } },
    });
    if (!zona) return null;
    const tarifas = includeTarifas
      ? await this.prisma.tarifaZonaMensajero.findMany({ where: { zonaId: id } })
      : undefined;
    return toDTO(zona, zona._count.distritos, tarifas);
  }

  async list(params: ListZonasParams): Promise<ListZonasResult> {
    const [rows, total] = await Promise.all([
      this.prisma.zona.findMany({
        orderBy: { nombre: "asc" },
        skip: params.skip,
        take: params.take,
        include: { _count: { select: { distritos: true } } },
      }),
      this.prisma.zona.count(),
    ]);

    // include tarifas: una sola consulta agrupada por zona (evita N+1).
    const tarifasByZona = new Map<string, TarifaRow[]>();
    if (params.includeTarifas && rows.length > 0) {
      const tarifas = await this.prisma.tarifaZonaMensajero.findMany({
        where: { zonaId: { in: rows.map((r) => r.id) } },
      });
      for (const t of tarifas) {
        const bucket = tarifasByZona.get(t.zonaId);
        if (bucket) bucket.push(t);
        else tarifasByZona.set(t.zonaId, [t]);
      }
    }

    const items = rows.map((r) =>
      toDTO(
        r,
        r._count.distritos,
        params.includeTarifas ? (tarifasByZona.get(r.id) ?? []) : undefined,
      ),
    );
    return { items, total };
  }

  /** Feature 144/B2 (R48/R49): `{id, nombre}` de TODAS las zonas, por nombre asc. */
  async listLite(): Promise<OpcionCatalogo[]> {
    return this.prisma.zona.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" }, // R49: orden determinista
    });
  }

  /**
   * ⭑ FICHA 366 (design §6) — GUARDAR UNA ZONA RECONCILIA LA ZONA DE SUS ORDENES.
   *
   * Hasta hoy `orden.zona_id` se derivaba UNA sola vez, al crear la orden: mover un distrito de
   * una zona a otra desde esta pantalla dejaba a las ordenes ya creadas con la zona VIEJA
   * estampada, y sin ninguna via manual para corregirlo (`CorregirDatosClienteService` solo
   * re-deriva la zona cuando el distrito CAMBIA DE VALOR, y aqui el distrito no cambia: cambia el
   * mapa `zona_distrito`). Medido en produccion el 2026-09-03: 42 ordenes desalineadas, 41 de
   * ellas atascadas en la bodega equivocada porque `recibirEnSatelite` acota su guarda por zona.
   *
   * TODO OCURRE EN LA TRANSACCION QUE YA EXISTIA —la misma que reemplaza la N:M y las tarifas—,
   * asi que o se guarda la zona Y se reconcilian sus ordenes, o no ocurre ninguna de las dos.
   */
  async update(
    id: string,
    data: UpdateZonaData,
    actorUsuarioId: string | null,
  ): Promise<UpdateZonaResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 376/R5: la lectura que ya existia gana UNA columna. No hace falta contar zonas: el
        // indice unico parcial `zona_es_central_unico` garantiza «a lo sumo una», asi que «esta
        // zona ES la central» equivale a «quitarle la marca deja el sistema sin ninguna».
        const exists = await tx.zona.findUnique({
          where: { id },
          select: { id: true, esCentral: true },
        });
        if (!exists) return { estado: "not_found" as const };

        // ⭑ 376/R5 — EL RECHAZO SALE ANTES DE LA PRIMERA ESCRITURA, y por eso no se aplica NADA
        // del guardado: ni el nombre, ni los distritos, ni las tarifas, ni la marca. Solo un
        // `false` EXPLICITO llega aqui; `undefined` (el campo ausente) NO es una peticion de
        // apagar y no entra (R1/R3).
        if (data.esCentral === false && exists.esCentral) {
          return { estado: "sin_zona_central" as const };
        }

        // 376/R12: ¿la marca va a LLEGAR a esta zona? Entonces la central previa se lee ANTES del
        // `updateMany` que la apaga: despues ya no habria a quien preguntar. Es la zona que pierde
        // la marca sin aparecer en ningun payload — la fila que hoy no existe.
        const laMarcaLlega = data.esCentral === true && !exists.esCentral;
        const centralPrevia = laMarcaLlega
          ? await tx.zona.findFirst({
              where: { esCentral: true, NOT: { id } },
              select: { id: true, nombre: true },
            })
          : null;

        // Feature 55/R5/R6 (F1.4-A = reasignar): si esta zona pasa a central, desmarca
        // cualquier OTRA central antes de actualizar, para no violar el indice unico parcial.
        if (data.esCentral === true) {
          await tx.zona.updateMany({
            where: { esCentral: true, NOT: { id } },
            data: { esCentral: false },
          });
        }

        const zona = await tx.zona.update({
          where: { id },
          // ⚠️ 376/R1 — `esCentral: undefined` NO ESCRIBE LA COLUMNA. Es una propiedad de Prisma
          // («campo no provisto»), no una casualidad, y es lo que hace que un payload sin la marca
          // deje la marca como estaba. Un doble de Prisma NO distingue esto de escribir `false`:
          // por eso R1 se mide contra Postgres real.
          data: { nombre: data.nombre, cobroVehiculo: data.cobroVehiculo, esCentral: data.esCentral },
        });

        // 366/R5: los distritos que la zona tenia ANTES, leidos ANTES del `deleteMany`. Sin esta
        // lectura, un distrito que este mismo guardado ACABA DE QUITAR de la zona no se
        // re-evaluaria: no esta en la lista final, asi que sus ordenes seguirian apuntando aqui
        // hasta un guardado futuro que podria no llegar nunca.
        const distritosPrevios = await tx.zonaDistrito.findMany({
          where: { zonaId: id },
          select: { distritoId: true },
        });

        // Reemplazo completo del N:M y de las tarifas.
        await tx.zonaDistrito.deleteMany({ where: { zonaId: id } });
        if (data.distritoIds.length > 0) {
          await tx.zonaDistrito.createMany({
            data: data.distritoIds.map((distritoId) => ({ zonaId: id, distritoId })),
          });
        }
        await tx.tarifaZonaMensajero.deleteMany({ where: { zonaId: id } });
        if (data.tarifas.length > 0) {
          await tx.tarifaZonaMensajero.createMany({ data: tarifaCreateRows(id, data.tarifas) });
        }

        // 366/R5 (design §2): LA UNION de los distritos de ANTES y los de DESPUES.
        const distritosAfectados = [
          ...new Set([...distritosPrevios.map((d) => d.distritoId), ...data.distritoIds]),
        ];

        let ordenesReconciliadas = 0;
        if (distritosAfectados.length > 0) {
          // El estado YA reemplazado de la N:M: es el que decide cual es la zona correcta.
          const filas = await tx.zonaDistrito.findMany({
            where: { distritoId: { in: distritosAfectados } },
            select: { distritoId: true, zonaId: true },
          });

          const zonasPorDistrito = new Map<string, string[]>();
          for (const fila of filas) {
            const bucket = zonasPorDistrito.get(fila.distritoId);
            if (bucket) bucket.push(fila.zonaId);
            else zonasPorDistrito.set(fila.distritoId, [fila.zonaId]);
          }

          // 366/R2/R3: el colapso 1/0/>1 es EL MISMO que usan la carga masiva y la correccion
          // manual (`_shared/zona-colapso`). Un distrito con 0 o con >1 zonas resuelve `null` y NO
          // mueve ninguna orden: no se inventa una zona eligiendo la primera.
          const distritosPorZonaResuelta = new Map<string, string[]>();
          for (const distritoId of distritosAfectados) {
            const zonaResuelta = zonaUnicaDeDistrito(zonasPorDistrito.get(distritoId) ?? []);
            if (zonaResuelta === null) continue;
            const bucket = distritosPorZonaResuelta.get(zonaResuelta);
            if (bucket) bucket.push(distritoId);
            else distritosPorZonaResuelta.set(zonaResuelta, [distritoId]);
          }

          if (distritosPorZonaResuelta.size > 0) {
            // 366/R11: UN lote por GUARDADO, aunque toque varias zonas resueltas. Y UN solo
            // `resolverActorCongelado` para todas sus filas (362/design §2.4).
            const loteId = randomUUID();
            const actor = await resolverActorCongelado(tx, actorUsuarioId);

            for (const [zonaResueltaId, distritoIds] of distritosPorZonaResuelta) {
              // ⭑ EL CORTE DE ELEGIBILIDAD (366/R6/R7), y vive en el `WHERE` a proposito: es una
              // condicion sobre filas de OTRAS tablas, no un `if` que un doble pueda esquivar.
              //   · `deletedAt: null`       — una orden borrada no se re-estampa;
              //   · `cierreDetalles: none`  — ya tiene un detalle congelado en un cierre: eso ya
              //     se facturo, y `cierre_detail` es INMUTABLE (R8);
              //   · `gestiones: none {...}` — tiene una gestion VIGENTE cuyo resultado ya decidio
              //     dinero (`entregada`, `rechazada`, `incidente`). Una `reprogramada` o una
              //     `devuelta` vigentes NO excluyen: las dos se rutean HACIA ADELANTE por
              //     `orden.zonaId` (`LiberacionReprogramadaService`, `DevolucionSlaService`), asi
              //     que dejarlas con la zona vieja las liberaria a la bodega equivocada — el
              //     mismo atasco que esta ficha viene a arreglar (design §1).
              const elegibles = await tx.orden.findMany({
                where: {
                  distritoId: { in: distritoIds },
                  zonaId: { not: zonaResueltaId },
                  deletedAt: null,
                  cierreDetalles: { none: {} },
                  gestiones: {
                    none: {
                      anuladaAt: null,
                      resultado: { in: ["entregada", "rechazada", "incidente"] },
                    },
                  },
                },
                select: { id: true, numGuia: true, numRemision: true },
              });
              if (elegibles.length === 0) continue;

              // 366/R9: SOLO `zonaId`. Ni el estado, ni el mensajero, ni el monto, ni la
              // ubicacion: esta ficha corrige la zona y nada mas.
              await tx.orden.updateMany({
                where: { id: { in: elegibles.map((o) => o.id) } },
                data: { zonaId: zonaResueltaId },
              });

              // 362/R9 + 366/R10: una fila POR ORDEN ALCANZADA (no por orden candidata) y en la
              // MISMA transaccion. La etiqueta es la guia —o la remision si no hay guia—, que es
              // un identificador de envio de Ordenex; `valorAnterior`/`valorNuevo`/`monto` van
              // NULL a proposito: ahi irian la zona vieja y la nueva, que R10 deja fuera.
              await appendAccion(
                tx,
                elegibles.map((o) => ({
                  accion: "orden_zona_reconciliada" as const,
                  entidadTipo: "orden" as const,
                  entidadId: o.id,
                  entidadEtiqueta: etiquetaDeEntidad("orden", {
                    numGuia: o.numGuia,
                    numRemision: o.numRemision,
                  }),
                  ...actor,
                })),
                loteId,
              );

              ordenesReconciliadas += elegibles.length;
            }
          }
        }

        // ⭑ 376/R12-R17 — EL RASTRO DEL CAMBIO DE MARCA. Va DESPUES de las escrituras y DENTRO del
        // mismo callback, recibiendo la `tx` y nunca `this.prisma`: escribir por `this.prisma`
        // aqui dentro compila, parece correcto y escribe FUERA de la transaccion (la mutacion que
        // sobrevivio en la ficha 373).
        //
        // ⚠️ EL `loteId` ES PROPIO Y DISTINTO del de la reconciliacion de la 366, aunque los dos
        // ocurran en el mismo guardado: son dos hechos de naturaleza distinta —«se movio la marca»
        // y «se re-estamparon N ordenes»— y el lote existe para agrupar filas HOMOGENEAS.
        // Compartirlo haria que filtrar por lote devolviera una mezcla que nadie pidio.
        //
        // R18: si la marca NO cambia —porque el payload la omite, o porque reenvia el valor que la
        // zona ya tenia— `laMarcaLlega` es `false` y no se escribe ni una fila.
        if (laMarcaLlega) {
          const actorDeLaMarca = await resolverActorCongelado(tx, actorUsuarioId);
          await appendAccion(
            tx,
            filasDeCambioDeMarca(centralPrevia, { id, nombre: zona.nombre }, actorDeLaMarca),
            randomUUID(),
          );
        }

        const tarifas = await tx.tarifaZonaMensajero.findMany({ where: { zonaId: id } });
        return {
          estado: "ok" as const,
          zona: toDTO(zona, data.distritoIds.length, tarifas),
          ordenesReconciliadas,
        };
      });
    } catch (e) {
      translateEsCentralConflict(e);
    }
  }

  /**
   * FICHA 362 (R4/R9) — `zona_borrada`. Esta escritura YA corria en `$transaction`, asi que la
   * instrumentacion es literalmente la llamada dentro del callback que ya existia.
   *
   * ⚠️ LA ETIQUETA SE CONGELA CON EL `findUnique` DE ARRIBA, ANTES DEL `delete`, y esa lectura ya
   * estaba: solo se le pide ademas el `nombre`. Despues del borrado no habria a quien preguntar
   * —el borrado es FISICO y ademas ARRASTRA SUS TARIFAS EN CASCADA—, asi que un join al leer
   * dejaria la fila del registro diciendo la nada sobre lo unico que documenta.
   */
  async hardDelete(id: string, actorUsuarioId: string | null): Promise<DeleteZonaResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.zona.findUnique({
          where: { id },
          select: { id: true, nombre: true, esCentral: true },
        });
        if (!exists) return "not_found" as const;
        // ⭑ 376/R10 — ANTES DEL PRIMER `deleteMany`, asi que no se borra nada: ni las tarifas, ni
        // la N:M, ni la zona. Es el unico rechazo que las FK NO cubren: una zona central sin
        // ninguna orden y sin ningun usuario apuntando se borraba sin mas hasta esta ficha, y con
        // ella se iba la unica zona que `findCentralZonaId()` puede devolver.
        //
        // 376/R19: sale ANTES del `appendAccion` de `zona_borrada`, asi que un borrado rechazado
        // no deja ninguna fila.
        if (exists.esCentral) return "es_central" as const;
        // 362/R4: congelada ANTES de que la fila desaparezca.
        const etiqueta = etiquetaDeEntidad("zona", { nombre: exists.nombre });
        // tarifa_zona_mensajero -> zona es FK RESTRICT: hay que borrarlas antes.
        await tx.tarifaZonaMensajero.deleteMany({ where: { zonaId: id } });
        // zona_distrito es CASCADE; lo borramos explicito por claridad/simetria.
        await tx.zonaDistrito.deleteMany({ where: { zonaId: id } });
        await tx.zona.delete({ where: { id } });

        // 362/R9: DESPUES del `delete` y DENTRO del mismo callback. Si el borrado falla por la FK
        // RESTRICT de `orden`, el error sale de la transaccion y aqui no se llega: no queda fila
        // de un borrado que no ocurrio (R11).
        const actor = await resolverActorCongelado(tx, actorUsuarioId);
        await appendAccion(tx, [
          {
            accion: "zona_borrada",
            entidadTipo: "zona",
            entidadId: id,
            entidadEtiqueta: etiqueta,
            ...actor,
          },
        ]);
        return "ok" as const;
      });
    } catch (e) {
      // FK RESTRICT desde orden (y desde cierre_detail.tarifa_id, que bloquea la cascada
      // de `tarifas` cuando alguna ya se liquido) -> la zona esta en uso.
      // `tarifas` ya NO llega hasta aqui por si sola: su FK es CASCADE desde la migracion
      // 20260826160000_tarifa_fk_cascade.
      //
      // ⚠️ EL DETECTOR NO ES `e.code === "P2003"`, y esto NO es preferencia de estilo: MEDIDO el
      // 2026-09-04 borrando una zona con una orden apuntando, el error llega asi:
      //   ctor: DriverAdapterError · code: undefined · meta: null · cause.code: "23001"
      //   isKnownRequestError: false
      //   message: 'update or delete on table "zona" violates RESTRICT setting of foreign key
      //             constraint "orden_zona_id_fkey" on table "orden"'
      // Con la comprobacion vieja este `catch` NO devolvia `referenced` NUNCA: el error crudo
      // escapaba hasta `withErrorHandler` y el maestro veia un error interno en vez de «esta zona
      // esta en uso». Ver `_shared/prisma-fk.ts` (ficha 373) para las dos formas del error.
      if (esViolacionDeClaveForanea(e)) return "referenced";
      throw e;
    }
  }

  async countExistingDistritos(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.distrito.count({ where: { id: { in: ids } } });
  }

  async countExistingVehiculos(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.vehiculo.count({ where: { id: { in: ids } } });
  }

  async findCentralZonaId(): Promise<string | null> {
    const z = await this.prisma.zona.findFirst({
      where: { esCentral: true },
      select: { id: true },
    });
    return z?.id ?? null;
  }

  /**
   * ⭑ FICHA 376 (Q4) — CUANTAS ORDENES RE-TARIFA MOVER LA MARCA, POR ZONA.
   *
   * EL CORTE VIVE EN EL `WHERE` a proposito, igual que el de la 366: es una condicion sobre filas
   * de OTRA tabla, no un `if` que un doble pueda esquivar.
   *   · `deletedAt: null`      — una orden borrada no se factura;
   *   · `cierreDetalles: none` — ya tiene un detalle congelado en un cierre, y ese detalle
   *     fotografio `es_central` (`cierre_detail.es_central`, INMUTABLE): pase lo que pase con la
   *     marca, su flete ya no cambia. Contarla seria inflar el numero que se le enseña a quien
   *     esta a punto de confirmar.
   *
   * Solo lectura y UNA consulta agrupada, no una por zona. Un id sin ordenes vivas sale igual, con
   * cero: «no afecta a ninguna» y «no lo sé» no pueden verse iguales en la confirmacion.
   */
  async contarOrdenesVivasPorZona(zonaIds: string[]): Promise<ImpactoZonaCentralDTO[]> {
    const ids = [...new Set(zonaIds)];
    if (ids.length === 0) return [];
    const filas = await this.prisma.orden.groupBy({
      by: ["zonaId"],
      where: { zonaId: { in: ids }, deletedAt: null, cierreDetalles: { none: {} } },
      _count: { _all: true },
    });
    const conteo = new Map(filas.map((f) => [f.zonaId, f._count._all]));
    return ids.map((zonaId) => ({ zonaId, ordenesVivas: conteo.get(zonaId) ?? 0 }));
  }
}
