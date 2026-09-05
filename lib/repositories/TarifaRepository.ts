import { Prisma, type Tarifa, type PrismaClient } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import { esViolacionDeClaveForanea } from "@/lib/repositories/_shared/prisma-fk";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { ROLES_TARIFABLES, type TarifaDTO } from "@/lib/types/tarifa";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad, etiquetaDePersona } from "@/lib/types/historial-accion-etiquetas";
import type {
  CreateTarifaData,
  DeleteTarifaResult,
  ITarifaRepository,
  ListTarifasParams,
  ListTarifasResult,
  UpdateTarifaData,
} from "@/lib/interfaces/repositories/ITarifaRepository";

// FICHA 362 — los tres escritores de esta tabla registran su accion EN LA MISMA TRANSACCION que
// la mutacion (R9). Por eso el `Pick` gana `$transaction` y `historialAccion`: sin ellos el
// registro solo podria escribirse fuera, que es exactamente lo que R10/R11 prohiben.
type TarifaPrismaClient = Pick<
  PrismaClient,
  "tarifa" | "usuario" | "zona" | "$transaction" | "historialAccion"
>;

/**
 * FICHA 362 — la etiqueta CONGELADA de una tarifa, leida DENTRO de la transaccion y ANTES del
 * `DELETE` cuando toca borrar. `tarifas` borra en FISICO: si se leyera despues no habria a quien
 * preguntar, y la fila del registro diria «(sin identificar)» sobre algo que si tenia nombre.
 *
 * Solo se leen los NOMBRES de la zona y de la tienda. Ni un importe, ni un dato de cliente (R5).
 */
async function etiquetaDeTarifa(
  tx: Pick<Prisma.TransactionClient, "tarifa">,
  tarifaId: string,
): Promise<string> {
  const fila = await tx.tarifa.findUnique({
    where: { id: tarifaId },
    select: {
      zona: { select: { nombre: true } },
      tienda: { select: { nombre: true, primerApellido: true } },
    },
  });
  return etiquetaDeEntidad("tarifa", {
    zonaNombre: fila?.zona?.nombre ?? null,
    tiendaNombre:
      fila?.tienda == null
        ? null
        : etiquetaDePersona({
            nombre: fila.tienda.nombre,
            primerApellido: fila.tienda.primerApellido,
          }),
  });
}

type TarifaRow = Tarifa;

// Serializa la fila de Prisma a TarifaDTO: las 8 columnas Decimal -> number
// (R27), incluye tiendaId. Ya no hay `deletedAt` que ocultar: la tabla borra en
// fisico (ver la migracion tarifa_zona_is_default), ni `status` que proyectar
// (274/R12: la columna se fue con `20260825120000_drop_tarifa_status`).
function toDTO(row: TarifaRow): TarifaDTO {
  return {
    id: row.id,
    tiendaId: row.tiendaId ?? null,
    valorFlete: row.valorFlete.toNumber(),
    valorFleteDevuelto: row.valorFleteDevuelto.toNumber(),
    valorFleteGam: row.valorFleteGam.toNumber(),
    valorFleteDevueltoGam: row.valorFleteDevueltoGam.toNumber(),
    // Nullable en la base, pero NO se propaga la ausencia: NULL se normaliza a 0 porque para
    // esta columna "sin monto" y "cero" son el mismo hecho (no hay fulfillment). Justo lo
    // contrario que `tarifaEspecial`, tres lineas mas abajo.
    fulfillment: row.fulfillment == null ? 0 : row.fulfillment.toNumber(),
    comisionCod: row.comisionCod.toNumber(),
    ivaFlete: row.ivaFlete.toNumber(),
    ivaComisionCod: row.ivaComisionCod.toNumber(),
    // Opcional: se conserva la ausencia como `null`, no se degrada a 0 (0 seria
    // un cobro especial de cero colones, que no es lo mismo que no tener pacto).
    tarifaEspecial: row.tarifaEspecial == null ? null : row.tarifaEspecial.toNumber(),
    tarifaEspecialDevuelta:
      row.tarifaEspecialDevuelta == null ? null : row.tarifaEspecialDevuelta.toNumber(),
    zonaId: row.zonaId ?? null,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// El unico `(zona_id, tienda_id)` (NULLS NOT DISTINCT, ver la migracion
// tarifa_zona_is_default) hace que un par repetido llegue aqui como P2002 crudo. Sin
// traducirlo saldria como error 500 en vez de como el conflicto que es. Se reconoce
// por el texto del constraint -robusto en motor nativo y bajo el driver adapter-,
// mismo helper y mismo patron que `ZonaRepository` con `zona_es_central_unico`.
function translateParDuplicado(e: unknown): never {
  const texto = textoConstraintP2002(e);
  if (texto && (texto.includes("tarifas_zona_id_tienda_id_key") || texto.includes("zona_id,tienda_id"))) {
    throw new ConflictError("Ya existe una tarifa para esa combinacion de zona y tienda");
  }
  throw e;
}

export class TarifaRepository implements ITarifaRepository {
  constructor(private readonly prisma: TarifaPrismaClient) {}

  async create(data: CreateTarifaData, actorUsuarioId: string | null): Promise<TarifaDTO> {
    try {
      return await this.createUnsafe(data, actorUsuarioId);
    } catch (e) {
      translateParDuplicado(e);
    }
  }

  /**
   * FICHA 362 (R9) — `tarifa_creada`. La creacion pasa a `$transaction` para que la fila del
   * registro no pueda existir sin la tarifa ni al reves.
   *
   * `monto` va NULL a proposito: una tarifa son DIEZ importes, no uno, y elegir cual congelar
   * seria inventar un dato. `valorAnterior`/`valorNuevo` tambien van NULL (Q3, cerrada por el
   * humano: NO se abre el versionado de tarifas; se vive con «quien y cuando» y el valor anterior
   * se pierde). Meter aqui un volcado de los diez importes seria texto libre en una columna de
   * vocabulario cerrado, que es lo que R5 prohibe.
   */
  private async createUnsafe(
    data: CreateTarifaData,
    actorUsuarioId: string | null,
  ): Promise<TarifaDTO> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.tarifa.create({
        data: {
          tiendaId: data.tiendaId ?? null,
          valorFlete: new Prisma.Decimal(data.valorFlete),
          valorFleteDevuelto: new Prisma.Decimal(data.valorFleteDevuelto),
          valorFleteGam: new Prisma.Decimal(data.valorFleteGam),
          valorFleteDevueltoGam: new Prisma.Decimal(data.valorFleteDevueltoGam),
          // Ausente = NULL explicito (sin fulfillment). No se degrada a 0 al ESCRIBIR: el cero
          // que se guarda es el que alguien tecleo, y el NULL dice que nadie lo hizo.
          fulfillment: data.fulfillment == null ? null : new Prisma.Decimal(data.fulfillment),
          comisionCod: new Prisma.Decimal(data.comisionCod),
          ivaFlete: new Prisma.Decimal(data.ivaFlete),
          ivaComisionCod: new Prisma.Decimal(data.ivaComisionCod),
          tarifaEspecial:
            data.tarifaEspecial == null ? null : new Prisma.Decimal(data.tarifaEspecial),
          tarifaEspecialDevuelta:
            data.tarifaEspecialDevuelta == null
              ? null
              : new Prisma.Decimal(data.tarifaEspecialDevuelta),
          zonaId: data.zonaId ?? null,
          // Sin `?? false` explicito quedaria en manos del default de la columna;
          // se escribe para que el valor persistido no dependa de dos sitios.
          isDefault: data.isDefault ?? false,
        },
      });

      const actor = await resolverActorCongelado(tx, actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: "tarifa_creada",
          entidadTipo: "tarifa",
          entidadId: row.id,
          entidadEtiqueta: await etiquetaDeTarifa(tx, row.id),
          ...actor,
        },
      ]);

      return toDTO(row);
    });
  }

  async findById(id: string): Promise<TarifaDTO | null> {
    const row = await this.prisma.tarifa.findFirst({
      where: { id },
    });
    return row ? toDTO(row) : null;
  }

  async list(params: ListTarifasParams): Promise<ListTarifasResult> {
    // Sin filtro de borrados: la tabla no los tiene. Se deja el `where` explicito
    // porque `count` y `findMany` DEBEN compartirlo para que `total` case con `items`.
    const where: Prisma.TarifaWhereInput = {};

    const [items, total] = await Promise.all([
      this.prisma.tarifa.findMany({
        where,
        orderBy: { createdAt: "desc" }, // R18: orden por defecto
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.tarifa.count({ where }),
    ]);

    return { items: items.map(toDTO), total };
  }

  /**
   * FICHA 362 (R9/R11) — `tarifa_actualizada`, dentro de la MISMA transaccion que el `UPDATE`.
   *
   * ⚠️ EL REGISTRO VA DESPUES DE COMPROBAR `result.count`, y ese orden es el requisito: si el
   * `updateMany` no alcanza ninguna fila (la tarifa no existe) NO se escribe ninguna fila de
   * registro. Escribirlo antes dejaria constancia de una actualizacion que no ocurrio.
   *
   * La etiqueta se lee DESPUES del `UPDATE`: aqui la fila sigue existiendo y el cambio puede
   * haber movido la zona o la tienda, o sea lo que la etiqueta nombra. Se congela lo que la
   * tarifa ES tras el cambio.
   */
  async update(
    id: string,
    data: UpdateTarifaData,
    actorUsuarioId: string | null,
  ): Promise<TarifaDTO | null> {
    return this.prisma.$transaction(async (tx) => {
      // Solo aplica si existe (R21); updateMany no lanza si 0 filas.
      // El try envuelve SOLO el UPDATE: reasignar zona o tienda puede chocar con el
      // unico y eso es un conflicto, no un fallo del repositorio.
      let result;
      try {
        result = await tx.tarifa.updateMany({
          where: { id },
          data: this.toUpdateData(data),
        });
      } catch (e) {
        translateParDuplicado(e);
      }
      if (result.count === 0) return null;

      const actor = await resolverActorCongelado(tx, actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: "tarifa_actualizada",
          entidadTipo: "tarifa",
          entidadId: id,
          entidadEtiqueta: await etiquetaDeTarifa(tx, id),
          ...actor,
        },
      ]);

      const row = await tx.tarifa.findFirst({ where: { id } });
      return row ? toDTO(row) : null;
    });
  }

  // Borrado FISICO: la tabla ya no tiene `deleted_at`. Es lo que permite que el
  // unico `(zona_id, tienda_id)` sea total -una tarifa borrada deja de ocupar su
  // par y se puede volver a crear-.
  /**
   * FICHA 362 (R4/R9) — `tarifa_borrada`, EL CASO QUE JUSTIFICA CONGELAR LA ETIQUETA.
   *
   * ⚠️ EL ORDEN NO ES NEGOCIABLE: la etiqueta se lee ANTES del `DELETE`. El borrado es FISICO —la
   * fila desaparece y con ella el precio que estuvo vigente—, asi que despues no habria a quien
   * preguntar de que tarifa se trataba. Esa es exactamente la propiedad que R4 exige y la que un
   * join al leer no puede dar.
   *
   * El `appendAccion` va DESPUES del `delete`: si el borrado falla (la FK, la tarifa esta
   * congelada en un cierre) no se escribe fila de registro, porque no hubo borrado (R11). Y si el
   * `appendAccion` fallara, la transaccion revierte y la tarifa NO se borra (R10).
   */
  async hardDelete(id: string, actorUsuarioId: string | null): Promise<DeleteTarifaResult> {
    // ⚠️ EL `try` ENVUELVE LA TRANSACCION ENTERA Y NO EL `delete` SUELTO. Dentro de una
    // transaccion de Postgres una sentencia que falla ABORTA la transaccion: capturar la
    // violacion de FK por dentro y seguir dejaria la tx en estado abortado y cualquier consulta
    // posterior reventaria con `25P02`. Dejando que el error salga, la transaccion revierte
    // limpiamente y la traduccion a `not_found`/`referenced` sigue dando el mismo contrato.
    try {
      return await this.prisma.$transaction(async (tx) => {
        // ANTES del DELETE: despues no hay a quien preguntar.
        const etiqueta = await etiquetaDeTarifa(tx, id);
        await tx.tarifa.delete({ where: { id } });

        const actor = await resolverActorCongelado(tx, actorUsuarioId);
        await appendAccion(tx, [
          {
            accion: "tarifa_borrada",
            entidadTipo: "tarifa",
            entidadId: id,
            entidadEtiqueta: etiqueta,
            ...actor,
          },
        ]);
        return "ok" as const;
      });
    } catch (e) {
      // P2025: la fila no existe (o se borro en la carrera). Este SI conserva su codigo bajo el
      // driver adapter —lo produce Prisma, no Postgres—: MEDIDO el 2026-09-04 contra la base,
      // `ctor: PrismaClientKnownRequestError · code: "P2025"`. Por eso aqui la comprobacion
      // directa vale, y la de abajo NO.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return "not_found";
      }
      // FK RESTRICT desde `cierre_detail.tarifa_id`. La tarifa quedo congelada en un cierre y
      // sacarla romperia la auditoria de esa deuda; NO se fuerza aqui. El service lo traduce a
      // `conflict`.
      //
      // ⚠️ EL DETECTOR NO ES `e.code === "P2003"`, y esto NO es preferencia de estilo: MEDIDO el
      // 2026-09-04 borrando una tarifa con un `cierre_detail` apuntando, el error llega asi:
      //   ctor: DriverAdapterError · code: undefined · meta: null · cause.code: "23001"
      //   isKnownRequestError: false
      //   message: 'update or delete on table "tarifas" violates RESTRICT setting of foreign key
      //             constraint "cierre_detail_tarifa_id_fkey" on table "cierre_detail"'
      // Con la comprobacion vieja este `catch` NO devolvia `referenced` NUNCA: el error crudo
      // escapaba hasta `withErrorHandler` y el maestro veia un error interno en vez de «esta
      // tarifa esta en uso». Ver `_shared/prisma-fk.ts` (ficha 373) para las dos formas.
      if (esViolacionDeClaveForanea(e)) return "referenced";
      throw e;
    }
  }

  async esTiendaAsignable(tiendaId: string): Promise<boolean> {
    const row = await this.prisma.usuario.findFirst({
      where: { id: tiendaId, rol: { value: { in: [...ROLES_TARIFABLES] } } },
      select: { id: true },
    });
    return row !== null;
  }

  async existeZona(zonaId: string): Promise<boolean> {
    const row = await this.prisma.zona.findFirst({
      where: { id: zonaId },
      select: { id: true },
    });
    return row !== null;
  }

  // 274/R13: aqui vivia `inactivarPorTienda(tiendaId)` (updateMany a
  // `status: "inactivo"`). Se fue con la columna `tarifas.status`.
  // HUECO ACEPTADO Y DECLARADO (design 274 §2.2, decision del humano 2026-08-24):
  // el caso «la tienda deja de ser adminTienda» queda SIN cobertura —como ya
  // estaba de hecho, porque ningun llamador invocaba este metodo— y NO se abre
  // ficha. No lo reintroduzcas sin decidir antes cual es el sustituto real.

  private toUpdateData(data: UpdateTarifaData): Prisma.TarifaUncheckedUpdateManyInput {
    const out: Prisma.TarifaUncheckedUpdateManyInput = {};
    if (data.tiendaId !== undefined) out.tiendaId = data.tiendaId;
    if (data.valorFlete !== undefined) out.valorFlete = new Prisma.Decimal(data.valorFlete);
    if (data.valorFleteDevuelto !== undefined) {
      out.valorFleteDevuelto = new Prisma.Decimal(data.valorFleteDevuelto);
    }
    if (data.valorFleteGam !== undefined) {
      out.valorFleteGam = new Prisma.Decimal(data.valorFleteGam);
    }
    if (data.valorFleteDevueltoGam !== undefined) {
      out.valorFleteDevueltoGam = new Prisma.Decimal(data.valorFleteDevueltoGam);
    }
    // `null` viaja tal cual (deja la tarifa sin fulfillment); solo `undefined` se ignora.
    if (data.fulfillment !== undefined) {
      out.fulfillment = data.fulfillment === null ? null : new Prisma.Decimal(data.fulfillment);
    }
    if (data.comisionCod !== undefined) out.comisionCod = new Prisma.Decimal(data.comisionCod);
    if (data.ivaFlete !== undefined) out.ivaFlete = new Prisma.Decimal(data.ivaFlete);
    if (data.ivaComisionCod !== undefined) {
      out.ivaComisionCod = new Prisma.Decimal(data.ivaComisionCod);
    }
    // `null` es un valor CON significado aqui (limpiar el pacto especial), asi
    // que solo se omite cuando el campo no viaja (`undefined`).
    if (data.tarifaEspecial !== undefined) {
      out.tarifaEspecial =
        data.tarifaEspecial === null ? null : new Prisma.Decimal(data.tarifaEspecial);
    }
    if (data.tarifaEspecialDevuelta !== undefined) {
      out.tarifaEspecialDevuelta =
        data.tarifaEspecialDevuelta === null
          ? null
          : new Prisma.Decimal(data.tarifaEspecialDevuelta);
    }
    // `null` tiene significado (desacotar de la zona); solo se omite `undefined`.
    if (data.zonaId !== undefined) out.zonaId = data.zonaId;
    if (data.isDefault !== undefined) out.isDefault = data.isDefault;
    return out;
  }
}
