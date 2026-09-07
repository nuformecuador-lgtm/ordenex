import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { GestionResultado, PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import type { OrderStatusValue } from "@/lib/types/order-status";
import type {
  UpdateZonaData,
  UpdateZonaResult,
} from "@/lib/interfaces/repositories/IZonaRepository";

import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * ⭑ FICHA 366 / T5 — EL CORTE DE ELEGIBILIDAD, MEDIDO CONTRA POSTGRES REAL.
 *
 * POR QUE AQUI Y NO CON DOBLES. La elegibilidad de una orden NO es un `if` del repositorio: es un
 * `WHERE` con dos sub-consultas sobre OTRAS tablas (`cierre_detail` y `gestion_orden`), y los
 * tests de servicio usan dobles que NO VEN EL SQL. Este repo ya midio CUATRO veces que una
 * mutacion de un `where` sobrevive en verde por arriba. Cada exclusion de abajo tiene su caso que
 * la prueba EN VERDE (se reconcilia) y su caso que la prueba EN ROJO (no se reconcilia), que es lo
 * unico que hace que una mutacion del `where` se caiga.
 *
 * MUTACIONES PROBADAS A MANO DURANTE EL DESARROLLO (2026-09-03), cada una contra este archivo:
 *   · quitar `"incidente"` de la lista de `resultado`      -> rojo en «gestion `incidente`».
 *   · quitar el `resultado: { in: [...] }` entero          -> rojo en «`reprogramada` SI» y «`devuelta` SI».
 *   · quitar `anuladaAt: null`                             -> rojo en «gestion ANULADA SI».
 *   · quitar `cierreDetalles: { none: {} }`                -> rojo en «ya facturada».
 *   · `zonaId: { not: ... }` -> `zonaId: undefined`        -> rojo en «idempotencia».
 *   · la union de distritos -> solo `data.distritoIds`     -> rojo en «distrito recien quitado».
 *
 * ⚠️ NADA DE `if (!fks) return;`: con base y sin catalogo esto REVIENTA con un mensaje que dice
 * que hacer. Un test que no encuentra datos y se va por un `return` reporta `passed` sin haber
 * comprobado nada, y este repo ya se comio ese verde. Sin base alcanzable, `describe.skip` VISIBLE.
 * Todo ocurre dentro de una transaccion que SIEMPRE se revierte: la base local es compartida.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ⭑ FICHA 377 / T2 + T5 — EL EJE QUE ESTE ARCHIVO NO VARIABA: EL ESTADO DE LA ORDEN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ `FKS.estatusId` SALE DE UN `findFirst` SIN `orderBy` sobre `orden` (`_postgres-real.ts`,
 * `fksDeOrden`): es un estado ARBITRARIO Y NO DETERMINISTA, el mismo para todas las ordenes
 * semilla. Sirve de RELLENO para los casos que no miran el estado y NO VALE para ninguno que si
 * lo mire. Que las 17 ordenes de la 366 compartieran ese estado unico es EXACTAMENTE el hueco por
 * el que el defecto de la 377 —una orden ya en el estante de una satelite cambiando de zona— entro
 * en `dev` con la suite en verde.
 *
 * Por eso `crearOrden` acepta ahora `estatusValue`, que se resuelve contra el catalogo REAL con
 * `findUniqueOrThrow`: si el catalogo no esta sembrado, REVIENTA con nombre y apellido en vez de
 * reportar `passed`. Sin `estatusValue` el comportamiento es el de siempre, asi que los 17 casos
 * de la 366 no se editan.
 *
 * MUTACIONES EJECUTADAS A MANO DURANTE EL DESARROLLO (2026-09-07), cada una contra este archivo
 * MAS `tests/unit/repositories/zona-repository.test.ts`. Los conteos son los medidos, no los
 * esperados:
 *   · quitar `estatus: { value: { notIn: ESTANTE } }` del `findMany` -> 6 rojos, entre ellos «en
 *     el estante NO se mueve» y «la bodega que TIENE el paquete lo sigue viendo».
 *   · `notIn` -> `in` en ese mismo `findMany` -> 24 rojos: los 11 de la 366 (que es exactamente
 *     lo que impide que este corte se invierta a costa de la 366) y los 8 de la 377.
 *   · quitar `estatus: { value: { in: ESTANTE } }` del `count` -> 8 rojos, entre ellos «sin nada
 *     en el estante, las retenidas son 0» y «los dos conteos son DISJUNTOS».
 *     ⚠️ «el conteo cuenta lo que dice contar» NO se cae con esta mutacion, y es correcto: sus
 *     cuatro ordenes estan TODAS en el estante, asi que el `where` base ya deja 1 sola con o sin
 *     la clausula. Ese caso mide el `where` BASE del conteo, no su clausula de estado.
 *   · usar `ESTADOS_CUSTODIA_SATELITE` en vez de `ESTADOS_PAQUETE_EN_ESTANTE` -> 3 rojos, entre
 *     ellos «en transito SI se reconcilia»: es la confusion que el docstring de la constante
 *     avisa, y aqui se cae.
 *   · quitar `cierreDetalles: { none: {} }` de `whereBaseElegible` (el refactor de la 377) -> 3
 *     rojos, entre ellos el «YA FACTURADA» de la 366: extraer el `where` a una funcion no dejo
 *     ningun corte sin vigilar.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `366-${Date.now().toString(36)}`;
let contador = 0;
/** Sufijo unico por fila: `zona.nombre` es UNIQUE y `orden.num_remision` lo es por tienda. */
function unico(): string {
  contador += 1;
  return `${SUFIJO}-${contador.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** La forma que `update` espera. El nombre se repite tal cual para no chocar con el UNIQUE. */
function datosDeZona(nombre: string, distritoIds: string[]): UpdateZonaData {
  return { nombre, cobroVehiculo: false, esCentral: false, distritoIds, tarifas: [] };
}

/**
 * FICHA 376: el desenlace de `update` viaja NOMBRADO. Falla RUIDOSAMENTE si no es `ok` — devolver
 * `undefined` dejaria pasar por vacuidad un `sin_zona_central` que nadie esperaba aqui.
 */
function reconciliadasDe(res: UpdateZonaResult): number {
  if (res.estado !== "ok") throw new Error(`se esperaba \`ok\` y llego \`${res.estado}\``);
  return res.ordenesReconciliadas;
}

/** FICHA 377 (R8): el otro conteo, con la misma exigencia de desenlace `ok`. */
function retenidasDe(res: UpdateZonaResult): number {
  if (res.estado !== "ok") throw new Error(`se esperaba \`ok\` y llego \`${res.estado}\``);
  return res.ordenesRetenidasEnBodegaSatelite;
}

interface Escenario {
  tx: TxDeTest;
  repo: ZonaRepository;
  /** Las tres zonas del escenario, con su nombre (que `update` tiene que reenviar igual). */
  zonas: { A: { id: string; nombre: string }; B: { id: string; nombre: string }; C: { id: string; nombre: string } };
  crearDistrito: (zonaIds: string[]) => Promise<string>;
  crearOrden: (opciones: {
    distritoId: string | null;
    zonaId: string;
    borrada?: boolean;
    /**
     * FICHA 377 (T2): el estado de la orden, resuelto contra el catalogo REAL. Ausente = el
     * `FKS.estatusId` de siempre, que es arbitrario y NO sirve para mirar el estado.
     */
    estatusValue?: OrderStatusValue;
  }) => Promise<string>;
  /**
   * FICHA 377 (R4): una entrada de `orden_historial_estado` con el DESTINO que se le diga. Es la
   * EVIDENCIA de haber pasado por una bodega, que es cosa distinta del estado ACTUAL.
   */
  crearHistorialEstado: (ordenId: string, destino: OrderStatusValue) => Promise<void>;
  /** El estado ACTUAL de una orden, por su `value` de catalogo. */
  estadoDe: (ordenId: string) => Promise<string>;
  crearGestion: (
    ordenId: string,
    resultado: GestionResultado,
    opciones?: { anulada?: boolean },
  ) => Promise<void>;
  crearDetalleDeCierre: (ordenId: string, zonaId: string) => Promise<string>;
  /** Las filas de historial de la reconciliacion que tocan a estas ordenes. */
  historialDe: (ordenIds: string[]) => Promise<
    { entidadId: string; loteId: string; valorAnterior: string | null; valorNuevo: string | null }[]
  >;
  zonaDe: (ordenId: string) => Promise<string>;
}

describeSiHayBase("⭑ 366/T5 — la reconciliacion de la zona de las ordenes, contra Postgres", () => {
  let prisma: PrismaClient;
  let FKS: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let USUARIO: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y `pnpm run db:seed:zonas`) antes de esta suite.",
      );
    }
    FKS = fks;
    const usuario = await prisma.usuario.findFirst({ select: { id: true } });
    if (usuario === null) {
      throw new Error(
        "hacen falta usuarios en la base: la gestion y el cierre del dia cuelgan de uno. Corre " +
          "`pnpm run db:seed:maestro`.",
      );
    }
    USUARIO = usuario.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Siembra tres zonas vacias y entrega los constructores del escenario. Todo se revierte. */
  async function conEscenario<T>(fn: (e: Escenario) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const nombres = { A: `366 A ${unico()}`, B: `366 B ${unico()}`, C: `366 C ${unico()}` };
      const [a, b, c] = await Promise.all([
        tx.zona.create({ data: { nombre: nombres.A }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.B }, select: { id: true } }),
        tx.zona.create({ data: { nombre: nombres.C }, select: { id: true } }),
      ]);

      const escenario: Escenario = {
        tx,
        // `update` abre su propia `$transaction`; el pass-through la resuelve SOBRE ESTA MISMA tx,
        // asi que el SQL que se mide sigue siendo el real.
        repo: new ZonaRepository(clienteConTransaccionAnidada(tx)),
        zonas: {
          A: { id: a.id, nombre: nombres.A },
          B: { id: b.id, nombre: nombres.B },
          C: { id: c.id, nombre: nombres.C },
        },

        crearDistrito: async (zonaIds) => {
          const d = await tx.distrito.create({
            data: { nombre: `366 D ${unico()}`, cantonId: FKS.cantonId },
            select: { id: true },
          });
          for (const zonaId of zonaIds) {
            await tx.zonaDistrito.create({ data: { zonaId, distritoId: d.id } });
          }
          return d.id;
        },

        crearOrden: async ({ distritoId, zonaId, borrada = false, estatusValue }) => {
          // FICHA 377 (T2): el estado, resuelto contra el catalogo REAL. `findUniqueOrThrow` a
          // proposito: si el `value` no existe en `order_status`, el caso REVIENTA diciendo cual
          // falta. Un `findUnique` con `?? FKS.estatusId` habria dejado el caso en verde sembrando
          // el estado equivocado, que es la peor de las dos salidas.
          const estatusId =
            estatusValue === undefined
              ? FKS.estatusId
              : (
                  await tx.orderStatus.findUniqueOrThrow({
                    where: { value: estatusValue },
                    select: { id: true },
                  })
                ).id;
          const o = await tx.orden.create({
            data: {
              numRemision: `R-${unico()}`,
              destinatario: "Destinataria 366",
              telefonoDest: "8888-0000",
              producto: "caja de zapatos",
              estatusId,
              tiendaId: FKS.tiendaId,
              zonaId,
              provinciaId: FKS.provinciaId,
              cantonId: FKS.cantonId,
              distritoId,
              direccion: "avenida siempre viva 742",
              montoCobrar: 12_000,
              intentosContacto: 2, // un valor DISTINGUIBLE: si algo lo tocara, se veria
              deletedAt: borrada ? new Date() : null,
            },
            select: { id: true },
          });
          return o.id;
        },

        // `mensajeroId` apunta a un usuario cualquiera: la FK es a `usuario` y este archivo mide el
        // `WHERE` sobre `gestion_orden`, no el rol de quien gestiono.
        crearGestion: async (ordenId, resultado, opciones = {}) => {
          await tx.gestionOrden.create({
            data: {
              ordenId,
              mensajeroId: USUARIO,
              resultado,
              ...(opciones.anulada === true ? { anuladaAt: new Date("2026-08-30T12:00:00Z") } : {}),
            },
            select: { id: true },
          });
        },

        crearDetalleDeCierre: async (ordenId, zonaId) => {
          const cierre = await tx.cierreDia.create({
            data: {
              mensajeroId: USUARIO,
              estado: "solicitado",
              destinoTipo: "bodega_central",
              destinoZonaId: zonaId,
            },
            select: { id: true },
          });
          const detalle = await tx.cierreDetail.create({
            data: {
              cierreId: cierre.id,
              ordenId,
              cobraComision: false,
              zonaId,
              tiendaId: FKS.tiendaId,
              esCentral: false,
              numRemision: `R-${unico()}`,
              destinatario: "Destinataria 366",
              producto: "caja de zapatos",
              tiendaNombre: "Tienda de prueba",
              zonaNombre: "Zona congelada",
              provinciaNombre: "Provincia",
              cantonNombre: "Canton",
            },
            select: { id: true },
          });
          return detalle.id;
        },

        // FICHA 377 (R4): la EVIDENCIA historica, que no es el estado actual. `origenTipo` es la
        // familia real de la recepcion en satelite; el actor es un usuario cualquiera porque lo
        // que se mide es el DESTINO de la transicion, no quien la ejecuto.
        crearHistorialEstado: async (ordenId, destino) => {
          const estatus = await tx.orderStatus.findUniqueOrThrow({
            where: { value: destino },
            select: { id: true },
          });
          await tx.ordenHistorialEstado.create({
            data: {
              ordenId,
              estatusDestinoId: estatus.id,
              actorUsuarioId: USUARIO,
              origenTipo: "recepcion_satelite",
            },
            select: { id: true },
          });
        },

        estadoDe: async (ordenId) =>
          (
            await tx.orden.findUniqueOrThrow({
              where: { id: ordenId },
              select: { estatus: { select: { value: true } } },
            })
          ).estatus.value,

        historialDe: async (ordenIds) =>
          tx.historialAccion.findMany({
            where: { accion: "orden_zona_reconciliada", entidadId: { in: ordenIds } },
            select: { entidadId: true, loteId: true, valorAnterior: true, valorNuevo: true },
          }),

        zonaDe: async (ordenId) =>
          (
            await tx.orden.findUniqueOrThrow({ where: { id: ordenId }, select: { zonaId: true } })
          ).zonaId,
      };

      return fn(escenario);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // El caso base (R2/R4/R10) y las dos formas de no resolver una zona (R3)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R2/R4/R10: el distrito resuelve UNA zona -> la orden se re-estampa y deja su fila", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: reconciliadasDe(res),
        zonaFinal: await e.zonaDe(orden),
        zonaA: e.zonas.A.id,
        historial: await e.historialDe([orden]),
        orden,
      };
    });

    expect(medido.reconciliadas).toBe(1);
    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.historial).toHaveLength(1);
    expect(medido.historial[0].entidadId).toBe(medido.orden);
    expect(medido.historial[0].loteId).toBeTruthy();
    // R10: la fila registra el HECHO. Ahi irian la zona vieja y la nueva, y no entran.
    expect(medido.historial[0].valorAnterior).toBeNull();
    expect(medido.historial[0].valorNuevo).toBeNull();
  });

  it("R3: un distrito que queda con CERO zonas no mueve ninguna orden", async () => {
    const medido = await conEscenario(async (e) => {
      // El distrito estaba SOLO en A y este guardado lo saca: se queda sin ninguna zona.
      const huerfano = await e.crearDistrito([e.zonas.A.id]);
      const queSigue = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: huerfano, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [queSigue]),
        USUARIO,
      );
      return {
        reconciliadas: reconciliadasDe(res),
        zonaFinal: await e.zonaDe(orden),
        zonaC: e.zonas.C.id,
        historial: await e.historialDe([orden]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaC);
    expect(medido.reconciliadas).toBe(0);
    expect(medido.historial).toEqual([]);
  });

  it("R3: un distrito que queda en DOS zonas a la vez es ambiguo -> no mueve ninguna orden", async () => {
    const medido = await conEscenario(async (e) => {
      // El esquema lo permite: `@@unique([zonaId, distritoId])`, no por `distritoId` solo.
      const ambiguo = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const orden = await e.crearOrden({ distritoId: ambiguo, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [ambiguo]),
        USUARIO,
      );
      return {
        reconciliadas: reconciliadasDe(res),
        zonaFinal: await e.zonaDe(orden),
        zonaC: e.zonas.C.id,
        historial: await e.historialDe([orden]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaC);
    expect(medido.reconciliadas).toBe(0);
    expect(medido.historial).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // El corte de elegibilidad (R6/R7/R8) — cada exclusion, con su contraparte incluida
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R6/R7/R8: una orden YA FACTURADA (con detalle de cierre) NO se reconcilia, y su detalle queda intacto", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const facturada = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const libre = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const detalleId = await e.crearDetalleDeCierre(facturada, e.zonas.B.id);
      const detalleAntes = await e.tx.cierreDetail.findUniqueOrThrow({ where: { id: detalleId } });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: reconciliadasDe(res),
        zonaFacturada: await e.zonaDe(facturada),
        zonaLibre: await e.zonaDe(libre),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
        historialFacturada: await e.historialDe([facturada]),
        detalleAntes,
        detalleDespues: await e.tx.cierreDetail.findUniqueOrThrow({ where: { id: detalleId } }),
      };
    });

    // La facturada se queda quieta; la libre del MISMO distrito si se mueve (anti-vacuidad: sin
    // esto, un `where` que no encontrara nada dejaria el caso verde por la razon equivocada).
    expect(medido.zonaFacturada).toBe(medido.zonaB);
    expect(medido.zonaLibre).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
    // R7: y no deja rastro de una orden que no se toco.
    expect(medido.historialFacturada).toEqual([]);
    // R8: la fila del cierre, identica byte a byte.
    expect(medido.detalleDespues).toEqual(medido.detalleAntes);
  });

  const NO_ELEGIBLES: GestionResultado[] = ["entregada", "rechazada", "incidente"];
  it.each(NO_ELEGIBLES)(
    "⭑ R6/R7: una gestion VIGENTE con resultado `%s` deja la orden fuera",
    async (resultado) => {
      const medido = await conEscenario(async (e) => {
        const distrito = await e.crearDistrito([e.zonas.A.id]);
        const conGestion = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
        const libre = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
        await e.crearGestion(conGestion, resultado);

        const res = await e.repo.update(
          e.zonas.A.id,
          datosDeZona(e.zonas.A.nombre, [distrito]),
          USUARIO,
        );
        return {
          reconciliadas: reconciliadasDe(res),
          zonaConGestion: await e.zonaDe(conGestion),
          zonaLibre: await e.zonaDe(libre),
          zonaA: e.zonas.A.id,
          zonaB: e.zonas.B.id,
          historial: await e.historialDe([conGestion]),
        };
      });

      expect(medido.zonaConGestion).toBe(medido.zonaB);
      expect(medido.zonaLibre).toBe(medido.zonaA); // anti-vacuidad
      expect(medido.reconciliadas).toBe(1);
      expect(medido.historial).toEqual([]);
    },
  );

  const SI_ELEGIBLES: GestionResultado[] = ["reprogramada", "devuelta"];
  it.each(SI_ELEGIBLES)(
    "⭑ R6: una gestion VIGENTE con resultado `%s` SI se reconcilia (el corte es por resultado)",
    async (resultado) => {
      // ESTE es el caso que distingue «excluir por resultado» de «excluir toda gestion vigente».
      // Las dos se rutean hacia adelante por `orden.zonaId` (liberacion de reprogramadas y SLA de
      // devoluciones): dejarlas con la zona vieja las mandaria a la bodega equivocada.
      const medido = await conEscenario(async (e) => {
        const distrito = await e.crearDistrito([e.zonas.A.id]);
        const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
        await e.crearGestion(orden, resultado);

        const res = await e.repo.update(
          e.zonas.A.id,
          datosDeZona(e.zonas.A.nombre, [distrito]),
          USUARIO,
        );
        return {
          reconciliadas: reconciliadasDe(res),
          zonaFinal: await e.zonaDe(orden),
          zonaA: e.zonas.A.id,
          historial: await e.historialDe([orden]),
        };
      });

      expect(medido.zonaFinal).toBe(medido.zonaA);
      expect(medido.reconciliadas).toBe(1);
      expect(medido.historial).toHaveLength(1);
    },
  );

  it("⭑ R6: una gestion ANULADA no excluye, aunque su resultado fuera `entregada`", async () => {
    // Prueba que la condicion filtra por `anulada_at IS NULL` y no por «tiene alguna gestion».
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      await e.crearGestion(orden, "entregada", { anulada: true });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );
      return {
        reconciliadas: reconciliadasDe(res),
        zonaFinal: await e.zonaDe(orden),
        zonaA: e.zonas.A.id,
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
  });

  it("R6: una orden BORRADA no se re-estampa", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const borrada = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        borrada: true,
      });
      const viva = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );
      return {
        reconciliadas: reconciliadasDe(res),
        zonaBorrada: await e.zonaDe(borrada),
        zonaViva: await e.zonaDe(viva),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
      };
    });

    expect(medido.zonaBorrada).toBe(medido.zonaB);
    expect(medido.zonaViva).toBe(medido.zonaA); // anti-vacuidad
    expect(medido.reconciliadas).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R5 — el alcance de distritos de cada guardado
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R5: volver a guardar la zona SIN cambiar sus distritos reconcilia la deriva ya existente", async () => {
    // Es el caso de produccion: `zona_distrito` ya apunta bien, pero la orden lleva la zona vieja
    // estampada desde una edicion anterior. El guardado se cura solo.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const derivada = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]), // MISMA lista de antes
        USUARIO,
      );
      return {
        reconciliadas: reconciliadasDe(res),
        zonaFinal: await e.zonaDe(derivada),
        zonaA: e.zonas.A.id,
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
  });

  it("⭑ R5/R11: un distrito RECIEN QUITADO de esta zona se re-evalua en ESTE mismo guardado", async () => {
    // `quitado` estaba en A y en B; este guardado lo saca de A, asi que pasa a resolver B —y sus
    // ordenes se van a B sin necesidad de guardar B—. Es lo que distingue LA UNION de «solo la
    // lista final». De paso: las dos zonas resueltas de este guardado comparten `lote_id` (R11).
    const medido = await conEscenario(async (e) => {
      const quitado = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const queSigue = await e.crearDistrito([e.zonas.A.id]);
      const ordenQuitado = await e.crearOrden({ distritoId: quitado, zonaId: e.zonas.A.id });
      const ordenQueSigue = await e.crearOrden({ distritoId: queSigue, zonaId: e.zonas.C.id });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [queSigue]), // sin `quitado`
        USUARIO,
      );
      return {
        reconciliadas: reconciliadasDe(res),
        zonaDelQuitado: await e.zonaDe(ordenQuitado),
        zonaDelQueSigue: await e.zonaDe(ordenQueSigue),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
        historial: await e.historialDe([ordenQuitado, ordenQueSigue]),
      };
    });

    expect(medido.zonaDelQuitado).toBe(medido.zonaB);
    expect(medido.zonaDelQueSigue).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(2);
    // R11: DOS zonas resueltas distintas, UN solo lote.
    expect(medido.historial).toHaveLength(2);
    expect(new Set(medido.historial.map((f) => f.loteId)).size).toBe(1);
  });

  it("R11: DOS guardados distintos producen lotes DISTINTOS", async () => {
    // La otra mitad de R11: el lote agrupa «lo que hizo UN guardado», asi que dos guardados no
    // pueden compartirlo. Sin esto, un `lote_id` constante pasaria el caso de arriba y volveria
    // indistinguibles dos actos distintos en la pantalla del historial.
    const medido = await conEscenario(async (e) => {
      const deA = await e.crearDistrito([e.zonas.A.id]);
      const deB = await e.crearDistrito([e.zonas.B.id]);
      const ordenA = await e.crearOrden({ distritoId: deA, zonaId: e.zonas.C.id });
      const ordenB = await e.crearOrden({ distritoId: deB, zonaId: e.zonas.C.id });

      await e.repo.update(e.zonas.A.id, datosDeZona(e.zonas.A.nombre, [deA]), USUARIO);
      await e.repo.update(e.zonas.B.id, datosDeZona(e.zonas.B.nombre, [deB]), USUARIO);

      return { historial: await e.historialDe([ordenA, ordenB]) };
    });

    expect(medido.historial).toHaveLength(2);
    expect(new Set(medido.historial.map((f) => f.loteId)).size).toBe(2);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R9, R13 y R14
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R9: de la orden reconciliada cambia `zonaId` (y `updatedAt`), y NADA MAS", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const antes = await e.tx.orden.findUniqueOrThrow({ where: { id: orden } });

      await e.repo.update(e.zonas.A.id, datosDeZona(e.zonas.A.nombre, [distrito]), USUARIO);

      return {
        antes,
        despues: await e.tx.orden.findUniqueOrThrow({ where: { id: orden } }),
        zonaA: e.zonas.A.id,
      };
    });

    // La fila ENTERA comparada, no una lista de columnas que uno recuerde: lo que esta ficha
    // promete es una AUSENCIA, y solo se demuestra mirandolo todo.
    const cambiadas = Object.keys(medido.antes).filter(
      (k) =>
        JSON.stringify((medido.antes as Record<string, unknown>)[k]) !==
        JSON.stringify((medido.despues as Record<string, unknown>)[k]),
    );
    expect(cambiadas.sort()).toEqual(["updatedAt", "zonaId"]);
    expect((medido.despues as unknown as { zonaId: string }).zonaId).toBe(medido.zonaA);
  });

  it("⭑ R13: `create()` de una zona nueva no reconcilia ninguna orden", async () => {
    // Sin esto el distrito quedaba en DOS zonas a la vez tras el `create()` (la B de antes y la
    // nueva): `zonaUnicaDeDistrito` colapsa a `null` con >1 fila, asi que NINGUNA zona resuelta
    // quedaba disponible para estampar, y el caso pasaba en verde sin importar si `create()`
    // reconciliaba o no. Aqui el distrito arranca SIN ninguna zona, asi que tras el `create()`
    // resuelve exactamente una — la nueva—, distinta de la que ya lleva estampada la orden: un
    // `create()` que reconciliara moveria la orden, y este caso lo cazaria.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([]); // sin ninguna zona todavia
      const conDeriva = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.A.id });

      await e.repo.create(
        {
          nombre: `366 NUEVA ${unico()}`,
          cobroVehiculo: false,
          esCentral: false,
          distritoIds: [distrito], // la zona NUEVA es la UNICA que toma este distrito
          tarifas: [],
        },
        USUARIO,
      );

      // Sin ambiguedad: el distrito tiene que resolver a UNA sola zona (la nueva).
      const filasZonaDistrito = await e.tx.zonaDistrito.findMany({ where: { distritoId: distrito } });

      return {
        zonaFinal: await e.zonaDe(conDeriva),
        zonaA: e.zonas.A.id,
        historial: await e.historialDe([conDeriva]),
        filasZonaDistrito: filasZonaDistrito.length,
      };
    });

    expect(medido.filasZonaDistrito).toBe(1);
    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.historial).toEqual([]);
  });

  it("⭑ R14: repetir el mismo guardado informa 0 y no añade ni una fila de historial", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const orden = await e.crearOrden({ distritoId: distrito, zonaId: e.zonas.B.id });
      const datos = datosDeZona(e.zonas.A.nombre, [distrito]);

      const primera = await e.repo.update(e.zonas.A.id, datos, USUARIO);
      const historialTrasPrimera = await e.historialDe([orden]);
      const segunda = await e.repo.update(e.zonas.A.id, datos, USUARIO);

      return {
        primera: reconciliadasDe(primera),
        segunda: reconciliadasDe(segunda),
        historialTrasPrimera: historialTrasPrimera.length,
        historialTrasSegunda: (await e.historialDe([orden])).length,
      };
    });

    expect(medido.primera).toBe(1);
    expect(medido.segunda).toBe(0);
    expect(medido.historialTrasPrimera).toBe(1);
    expect(medido.historialTrasSegunda).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⭑ FICHA 377 / T5 — EL EJE DEL ESTADO: EN TRANSITO SI, EN EL ESTANTE NO
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // Los dos primeros casos son un PAR y solo valen juntos: uno impide que el corte se QUITE, el
  // otro impide que se INVIERTA. Con uno solo, una mutacion del `where` sobrevive.

  it("⭑ 377/T2: `crearOrden` siembra el estado que se le pide, y sin pedirselo cae al de FKS", async () => {
    // El humo de T2: sin esto, ningun caso de esta ficha significa nada, porque todos dependen de
    // que la orden tenga DE VERDAD el estado que dicen que tiene. Se siembran DOS estados
    // distintos —no uno— para que un fixture que ignorase el parametro y devolviera siempre lo
    // mismo se caiga aqui, sea cual sea el estado arbitrario que traiga `FKS`.
    const medido = await conEscenario(async (e) => {
      const enEstante = await e.crearOrden({
        distritoId: null,
        zonaId: e.zonas.A.id,
        estatusValue: "en_bodega_satelite",
      });
      const enTransito = await e.crearOrden({
        distritoId: null,
        zonaId: e.zonas.A.id,
        estatusValue: "en_ruta_bodega_satelite",
      });
      const porDefecto = await e.crearOrden({ distritoId: null, zonaId: e.zonas.A.id });
      const estatusDeFks = await e.tx.orderStatus.findUniqueOrThrow({
        where: { id: FKS.estatusId },
        select: { value: true },
      });

      return {
        enEstante: await e.estadoDe(enEstante),
        enTransito: await e.estadoDe(enTransito),
        porDefecto: await e.estadoDe(porDefecto),
        valorDeFks: estatusDeFks.value,
      };
    });

    expect(medido.enEstante).toBe("en_bodega_satelite");
    expect(medido.enTransito).toBe("en_ruta_bodega_satelite");
    // Sin `estatusValue` el comportamiento es EL DE SIEMPRE: los 17 casos de la 366 no cambian.
    expect(medido.porDefecto).toBe(medido.valorDeFks);
  });

  it("⭑ 377/R2/R6: una orden EN EL ESTANTE de una satelite NO cambia de zona ni deja rastro", async () => {
    // El escenario REAL del defecto: el paquete esta en la bodega A, y el distrito pasa a ser de
    // B porque este guardado lo saca de A. Sin el corte, la orden se iba a B y quedaba sin bodega
    // que pudiera asignarla y sin transicion de salida.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const enEstante = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.A.id,
        estatusValue: "en_bodega_satelite",
      });
      // ANTI-VACUIDAD: la hermana del MISMO distrito, en un estado que no es de estante, SI se
      // mueve. Sin ella, un `where` que no encontrara nada dejaria el caso verde por la razon
      // equivocada.
      const enBodegaCentral = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.A.id,
        estatusValue: "en_bodega_central",
      });

      const res = await e.repo.update(e.zonas.A.id, datosDeZona(e.zonas.A.nombre, []), USUARIO);

      return {
        reconciliadas: reconciliadasDe(res),
        retenidas: retenidasDe(res),
        zonaEnEstante: await e.zonaDe(enEstante),
        zonaCentral: await e.zonaDe(enBodegaCentral),
        estadoEnEstante: await e.estadoDe(enEstante),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
        historialEnEstante: await e.historialDe([enEstante]),
        historialCentral: await e.historialDe([enBodegaCentral]),
      };
    });

    expect(medido.zonaEnEstante).toBe(medido.zonaA); // R2: se queda con la bodega que la tiene
    expect(medido.zonaCentral).toBe(medido.zonaB); // anti-vacuidad
    expect(medido.reconciliadas).toBe(1);
    expect(medido.retenidas).toBe(1);
    // R6: ni un campo tocado, ni una fila de historial por la retenida.
    expect(medido.estadoEnEstante).toBe("en_bodega_satelite");
    expect(medido.historialEnEstante).toEqual([]);
    expect(medido.historialCentral).toHaveLength(1);
  });

  it("⭑ 377/R3: una orden EN TRANSITO a una satelite SI se reconcilia (la 366, intacta)", async () => {
    // El caso que DEFIENDE a la 366: el paquete lo tiene la central, que aun decide adonde lo
    // manda, y `recibirEnSatelite` acota su guarda por `zonaId` — sin reconciliar, la bodega
    // correcta no puede recibirlo (41 de 42 ordenes represadas el 2026-09-03).
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const enTransito = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.A.id,
        estatusValue: "en_ruta_bodega_satelite",
      });

      const res = await e.repo.update(e.zonas.A.id, datosDeZona(e.zonas.A.nombre, []), USUARIO);

      return {
        reconciliadas: reconciliadasDe(res),
        retenidas: retenidasDe(res),
        zonaFinal: await e.zonaDe(enTransito),
        zonaB: e.zonas.B.id,
        historial: await e.historialDe([enTransito]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaB);
    expect(medido.reconciliadas).toBe(1);
    expect(medido.retenidas).toBe(0); // en transito NO es «en el estante»
    expect(medido.historial).toHaveLength(1);
  });

  it("⭑ 377/R5: el corte viejo sigue vivo bajo el nuevo (gestion vigente `entregada`)", async () => {
    // La condicion de estado se SUMO a las cuatro de la 366; no sustituyo a ninguna. Una orden
    // FUERA del estante pero ya gestionada sigue sin moverse, y sin contar como retenida: no la
    // retiene la bodega, la retiene el dinero.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const gestionada = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_central",
      });
      await e.crearGestion(gestionada, "entregada");
      const libre = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_central",
      });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: reconciliadasDe(res),
        retenidas: retenidasDe(res),
        zonaGestionada: await e.zonaDe(gestionada),
        zonaLibre: await e.zonaDe(libre),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
      };
    });

    expect(medido.zonaGestionada).toBe(medido.zonaB);
    expect(medido.zonaLibre).toBe(medido.zonaA); // anti-vacuidad
    expect(medido.reconciliadas).toBe(1);
    expect(medido.retenidas).toBe(0);
  });

  it("⭑ 377/R4: cuenta el estado ACTUAL, no el historico (paso por la bodega y ya salio)", async () => {
    // El caso que distingue `ESTADOS_PAQUETE_EN_ESTANTE` (custodia ACTUAL, se lee del estado) de
    // `ESTADOS_CUSTODIA_SATELITE` (EVIDENCIA historica, se lee del historial y es para siempre).
    // Si alguien "arreglara" esto mirando el historial, esta orden —que ya salio a reparto— se
    // quedaria congelada en la zona vieja para siempre.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const yaSalio = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_reparto",
      });
      await e.crearHistorialEstado(yaSalio, "en_bodega_satelite");

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: reconciliadasDe(res),
        retenidas: retenidasDe(res),
        zonaFinal: await e.zonaDe(yaSalio),
        zonaA: e.zonas.A.id,
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.reconciliadas).toBe(1);
    expect(medido.retenidas).toBe(0);
  });

  it("⭑ 377/R9: el conteo de retenidas cuenta EXACTAMENTE lo que dice contar", async () => {
    // Cuatro ordenes EN EL ESTANTE en el mismo guardado y solo UNA cuenta. Las otras tres se caen
    // por cada uno de los otros cortes: ya esta en la zona correcta, ya se facturo, y su distrito
    // no resuelve ninguna zona. Un `count` que se olvidara del `where` base contaria 3 o 4.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const huerfano = await e.crearDistrito([]); // cero zonas: no resuelve ninguna

      const cuenta = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_satelite",
      });
      const yaEnLaZonaCorrecta = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.A.id,
        estatusValue: "en_bodega_satelite",
      });
      const yaFacturada = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_satelite",
      });
      await e.crearDetalleDeCierre(yaFacturada, e.zonas.B.id);
      const sinZonaResuelta = await e.crearOrden({
        distritoId: huerfano,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_satelite",
      });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        retenidas: retenidasDe(res),
        reconciliadas: reconciliadasDe(res),
        zonas: {
          cuenta: await e.zonaDe(cuenta),
          yaEnLaZonaCorrecta: await e.zonaDe(yaEnLaZonaCorrecta),
          yaFacturada: await e.zonaDe(yaFacturada),
          sinZonaResuelta: await e.zonaDe(sinZonaResuelta),
        },
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
      };
    });

    expect(medido.retenidas).toBe(1);
    expect(medido.reconciliadas).toBe(0);
    // Y ninguna de las cuatro se movio: lo retenido se queda donde estaba.
    expect(medido.zonas.cuenta).toBe(medido.zonaB);
    expect(medido.zonas.yaEnLaZonaCorrecta).toBe(medido.zonaA);
    expect(medido.zonas.yaFacturada).toBe(medido.zonaB);
    expect(medido.zonas.sinZonaResuelta).toBe(medido.zonaB);
  });

  it("⭑ 377/R7: los dos conteos son DISJUNTOS (2 movidas y 3 retenidas en el mismo guardado)", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const movibles = [
        await e.crearOrden({
          distritoId: distrito,
          zonaId: e.zonas.B.id,
          estatusValue: "en_bodega_central",
        }),
        await e.crearOrden({
          distritoId: distrito,
          zonaId: e.zonas.B.id,
          estatusValue: "en_ruta_bodega_satelite",
        }),
      ];
      const enEstante = [];
      for (let i = 0; i < 3; i += 1) {
        enEstante.push(
          await e.crearOrden({
            distritoId: distrito,
            zonaId: e.zonas.B.id,
            estatusValue: "en_bodega_satelite",
          }),
        );
      }

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );

      return {
        reconciliadas: reconciliadasDe(res),
        retenidas: retenidasDe(res),
        zonasMovibles: await Promise.all(movibles.map((o) => e.zonaDe(o))),
        zonasEnEstante: await Promise.all(enEstante.map((o) => e.zonaDe(o))),
        historialEnEstante: await e.historialDe(enEstante),
        zonaA: e.zonas.A.id,
        zonaB: e.zonas.B.id,
      };
    });

    expect(medido.reconciliadas).toBe(2);
    expect(medido.retenidas).toBe(3);
    expect(medido.zonasMovibles).toEqual([medido.zonaA, medido.zonaA]);
    expect(medido.zonasEnEstante).toEqual([medido.zonaB, medido.zonaB, medido.zonaB]);
    expect(medido.historialEnEstante).toEqual([]);
  });

  it("⭑ 377/R10: sin ninguna orden en el estante, las retenidas son 0", async () => {
    // El caso base de la 366, tal cual: el numero nuevo tiene que existir y valer 0, para que la
    // pantalla pueda callarse mirando el cero en vez de mirar un `undefined`.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_central",
      });

      const res = await e.repo.update(
        e.zonas.A.id,
        datosDeZona(e.zonas.A.nombre, [distrito]),
        USUARIO,
      );
      return { reconciliadas: reconciliadasDe(res), retenidas: retenidasDe(res) };
    });

    expect(medido.reconciliadas).toBe(1);
    expect(medido.retenidas).toBe(0);
  });

  it("⭑ 377/R12: repetir el guardado informa las MISMAS retenidas y 0 reconciliadas", async () => {
    // La retenida no se «gasta»: sigue ahi, y el segundo guardado tiene que volver a decirlo. Un
    // conteo que se apagara la segunda vez convertiria esto en un aviso de una sola vez.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id]);
      const enEstante = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_satelite",
      });
      const movible = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.B.id,
        estatusValue: "en_bodega_central",
      });
      const datos = datosDeZona(e.zonas.A.nombre, [distrito]);

      const primera = await e.repo.update(e.zonas.A.id, datos, USUARIO);
      const historialTrasPrimera = (await e.historialDe([enEstante, movible])).length;
      const segunda = await e.repo.update(e.zonas.A.id, datos, USUARIO);

      return {
        primera: { reconciliadas: reconciliadasDe(primera), retenidas: retenidasDe(primera) },
        segunda: { reconciliadas: reconciliadasDe(segunda), retenidas: retenidasDe(segunda) },
        historialTrasPrimera,
        historialTrasSegunda: (await e.historialDe([enEstante, movible])).length,
        zonaEnEstante: await e.zonaDe(enEstante),
        zonaB: e.zonas.B.id,
      };
    });

    expect(medido.primera).toEqual({ reconciliadas: 1, retenidas: 1 });
    expect(medido.segunda).toEqual({ reconciliadas: 0, retenidas: 1 });
    expect(medido.historialTrasPrimera).toBe(1);
    expect(medido.historialTrasSegunda).toBe(1);
    expect(medido.zonaEnEstante).toBe(medido.zonaB);
  });

  it("⭑ 377/R13: `create()` ni reconcilia ni retiene, y su resultado no lleva el conteo", async () => {
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([]); // sin ninguna zona todavia
      const enEstante = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.A.id,
        estatusValue: "en_bodega_satelite",
      });

      const creada = await e.repo.create(
        {
          nombre: `377 NUEVA ${unico()}`,
          cobroVehiculo: false,
          esCentral: false,
          distritoIds: [distrito], // la zona NUEVA es la UNICA que toma este distrito
          tarifas: [],
        },
        USUARIO,
      );

      return {
        creada,
        zonaFinal: await e.zonaDe(enEstante),
        zonaA: e.zonas.A.id,
        historial: await e.historialDe([enEstante]),
      };
    });

    expect(medido.zonaFinal).toBe(medido.zonaA);
    expect(medido.historial).toEqual([]);
    expect(medido.creada).not.toHaveProperty("ordenesRetenidasEnBodegaSatelite");
    expect(medido.creada).not.toHaveProperty("ordenesReconciliadas");
  });

  it("⭑ 377/R1: la bodega que TIENE el paquete lo sigue viendo en su listado, y la otra no", async () => {
    // EL REQUISITO DE RESULTADO. No basta con que el `where` excluya: hay que ver que la bodega
    // sigue teniendo la orden. Por eso aqui se ejercita el LISTADO REAL de la bodega satelite
    // (`OrdenRepository.findRecepcionSatelitePaginada`, el SQL crudo de `condicionesSatelite`),
    // no una reconstruccion de su criterio.
    //
    // LA MITAD QUE ESTE CASO NO EJECUTA, dicha en voz alta: la asignacion. `AsignacionSateliteService`
    // rechaza con `zona_ajena` cuando `orden.zonaId !== zonaDelActor`, asi que lo que decide ese
    // rechazo es EXACTAMENTE el `zonaId` que aqui se afirma. Montar el servicio entero (mensajero
    // de la zona, lote, carrera) mediria su orquestacion, no este corte.
    const medido = await conEscenario(async (e) => {
      const distrito = await e.crearDistrito([e.zonas.A.id, e.zonas.B.id]);
      const enEstante = await e.crearOrden({
        distritoId: distrito,
        zonaId: e.zonas.A.id,
        estatusValue: "en_bodega_satelite",
      });

      // El distrito sale de A: pasa a resolver B. Sin el corte de la 377, la orden se iria a B.
      await e.repo.update(e.zonas.A.id, datosDeZona(e.zonas.A.nombre, []), USUARIO);

      const ordenRepo = new OrdenRepository(clienteConTransaccionAnidada(e.tx));
      const filtro = { estatusValues: [...ESTADOS_BODEGA_SATELITE] };
      const enA = await ordenRepo.findRecepcionSatelitePaginada(
        { ...filtro, zonaId: e.zonas.A.id },
        { skip: 0, take: 50 },
      );
      const enB = await ordenRepo.findRecepcionSatelitePaginada(
        { ...filtro, zonaId: e.zonas.B.id },
        { skip: 0, take: 50 },
      );

      return {
        enEstante,
        zonaDeLaOrden: await e.zonaDe(enEstante),
        zonaA: e.zonas.A.id,
        idsEnA: enA.items.map((o) => o.id),
        idsEnB: enB.items.map((o) => o.id),
      };
    });

    // La bodega que la recibio la sigue viendo...
    expect(medido.idsEnA).toContain(medido.enEstante);
    // ...y la que NO tiene el paquete no la ve aparecer (el otro lado del defecto).
    expect(medido.idsEnB).not.toContain(medido.enEstante);
    // Y `orden.zonaId` sigue siendo el de la bodega que la tiene, que es lo que compara
    // `AsignacionSateliteService` antes de decir `zona_ajena`.
    expect(medido.zonaDeLaOrden).toBe(medido.zonaA);
  });
});
