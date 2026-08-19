// Feature 192 (T0.1/T0.2) — CONTRATO COMPARTIDO del tablero del dia.
//
// Es la unica frontera entre el bloque backend y el bloque frontend de esta feature
// (`tasks.md`): lo fija T0 y despues ninguno de los dos lo cambia sin avisar al otro.
//
// Modulo de TIPOS + una tabla de clasificacion. NO importa `repositories/`, `services/`,
// `@/lib/db` ni `next/headers`: cualquiera de esos imports lo convertiria en codigo de
// servidor y lo haria inutilizable desde un Client Component.

import type { GestionResultado } from "@prisma/client";

import type { MotivoDenegacion } from "@/lib/analytics/alcance";
import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";

/* -------------------------------------------------------------------------- */
/* 1. Segundo eje: el desglose de "sin resultado" (design.md §1.bis, R21/R43-R46) */
/* -------------------------------------------------------------------------- */

/**
 * R21 — una orden asignada hoy SIN gestion vigente en el dia cae en exactamente uno de
 * estos tres buckets, segun el estatus actual de la orden. No hay un cuarto cubo
 * indiferenciado de "pendientes": el sentido de la pantalla es distinguir al mensajero
 * que todavia no arranco del que ya esta en la calle.
 */
export type BucketSinResultado = "sinRecoger" | "enReparto" | "otros";

/**
 * R43 — la clasificacion estatus -> bucket. **Esta es su UNICA declaracion en todo el
 * arbol** (lo censa `tests/unit/tablero-dia/buckets-estatus.guardia.test.ts`): una
 * segunda tabla paralela es exactamente lo que R46 persigue.
 *
 * Es un mapa PARCIAL a proposito, con `otros` como valor por defecto
 * (`BUCKET_POR_DEFECTO`): asi un estatus retirado del catalogo pero vivo en filas
 * historicas —el caso real de la feature 155, cuya fila sobrevivio huerfana— sigue
 * teniendo bucket y la identidad de ocho sumandos de R25 no se rompe.
 *
 * - `por_recoger`: tiene guia y mensajero, espera que el mensajero la acepte (feature 17).
 * - `recolectando`: alguien va en camino a la tienda (feature 157).
 * - `en_reparto`: FUE recogida por el mensajero y esta en la calle (feature 36).
 *
 * R44 — `por_recolectar_en_tienda` NO esta aqui, y no es un olvido: en ese estatus
 * *nadie va todavia* (la asignacion es la transicion que la saca de ahi, feature 157), asi
 * que verla en `sinRecoger` seria contar como "trabajo parado de este mensajero" algo que
 * no es de nadie. Cae en `otros` por defecto.
 *
 * FEATURE 239 (T1.7, 2026-08-19) — `devolucion_por_confirmar` NO esta aqui, y tampoco es un
 * olvido. Este mapa es PARCIAL con default `otros`, asi que ABSORBE un value nuevo sin quejarse:
 * por eso la decision se afirma en `buckets-estatus.test.ts`. Los tres buckets solo particionan
 * ordenes SIN gestion vigente en el dia; una orden en el pre-estado tiene gestion del dia —la
 * devolucion que el mensajero acaba de registrar—, asi que cuenta en `devueltas` del primer eje
 * y no puede aparecer como "trabajo parado" en `sinRecoger` ni en `enReparto`.
 *
 * El `satisfies` sobre `OrderStatusValue` es lo que hace que un RENAME del catalogo no
 * compile (R46); que no falte ni sobre ningun value lo comprueba el guardia.
 */
export const BUCKET_POR_ESTATUS = {
  por_recoger: "sinRecoger",
  recolectando: "sinRecoger",
  en_reparto: "enReparto",
} as const satisfies Partial<Record<OrderStatusValue, BucketSinResultado>>;

/**
 * R45 — todo lo NO enumerado cae aqui, de forma explicita y visible. `otros` es el bucket
 * que delata que el mapa se quedo corto; absorberlo en `sinRecoger` haria que un cambio de
 * flujo pasara desapercibido.
 */
export const BUCKET_POR_DEFECTO: BucketSinResultado = "otros";

/**
 * R43/R45 — bucket de un estatus. Acepta `string` porque el value llega crudo de la base
 * (`order_status.value`) y puede ser una fila huerfana fuera del catalogo vigente.
 */
export function bucketDeEstatus(estatus: string): BucketSinResultado {
  const explicito: Partial<Record<string, BucketSinResultado>> = BUCKET_POR_ESTATUS;
  return explicito[estatus] ?? BUCKET_POR_DEFECTO;
}

/**
 * Los values del catalogo VIGENTE que caen en `bucket`. Lo consumen la UI (para explicar
 * que contiene cada bucket) y los tests. Se deriva de `ORDER_STATUS_SEED`, no se escribe a
 * mano: una lista paralela es la falla que R46 persigue.
 */
export function estatusDelBucket(bucket: BucketSinResultado): readonly OrderStatusValue[] {
  return ORDER_STATUS_SEED.filter((value) => bucketDeEstatus(value) === bucket);
}

/**
 * Los values con bucket EXPLICITO (los del mapa). El SQL del repositorio los recibe como
 * PARAMETROS (`= ANY($…)`) y construye `otros` con el `NOT IN` de esta misma lista, de
 * modo que las tres ramas sean disjuntas y exhaustivas por construccion (design.md §5,
 * nota 3.bis). Escribir estas listas tambien dentro de la cadena SQL seria declarar la
 * clasificacion dos veces.
 */
export const ESTATUS_CON_BUCKET_EXPLICITO: readonly OrderStatusValue[] = ORDER_STATUS_SEED.filter(
  (value) => value in BUCKET_POR_ESTATUS,
);

/* -------------------------------------------------------------------------- */
/* 2. El tablero (design.md §6)                                                */
/* -------------------------------------------------------------------------- */

/**
 * R25 — los OCHO contadores de una tarjeta. La identidad
 * `asignadas = entregadas + reprogramadas + devueltas + rechazadas + incidentes +
 *  sinRecoger + enReparto + otros`
 * se cumple por construccion (los `FILTER` del SQL son particiones disjuntas del mismo
 * `COUNT(*)`), no por una resta a posteriori.
 */
export interface FilaTableroDia {
  readonly mensajeroId: string;
  /** "Juan Perez" (nombre + primer apellido). */
  readonly mensajeroNombre: string;
  readonly asignadas: number;
  readonly entregadas: number;
  readonly reprogramadas: number;
  readonly devueltas: number;
  readonly rechazadas: number;
  readonly incidentes: number;
  /** R21/R43 — sin gestion vigente hoy y todavia sin arrancar. */
  readonly sinRecoger: number;
  /** R21/R43 — sin gestion vigente hoy, ya en la calle. */
  readonly enReparto: number;
  /** R45 — cualquier otro estatus sin gestion vigente hoy. Se pinta aunque valga 0. */
  readonly otros: number;
}

/** R30 — los totales tienen la forma de una fila menos su identidad. */
export type TotalesTableroDia = Omit<FilaTableroDia, "mensajeroId" | "mensajeroNombre">;

export interface TableroDia {
  /** `YYYY-MM-DD` calendario de Costa Rica del dia representado (R34). */
  readonly fecha: string;
  /**
   * R34 — instante en que los conteos se LEYERON de la base. Se estampa dentro de
   * `producir`, viaja dentro del valor cacheado y NO se re-estampa al servir un acierto
   * de cache: si dijera la hora de la respuesta, la pantalla anunciaria como fresco un
   * dato de hasta ~45 s (design.md §5.quater).
   */
  readonly generadoAt: string;
  readonly alcance: "global" | "zona";
  readonly filas: readonly FilaTableroDia[];
  readonly totales: TotalesTableroDia;
}

/* -------------------------------------------------------------------------- */
/* 3. El detalle de un mensajero (design.md §6, R47-R51)                       */
/* -------------------------------------------------------------------------- */

export interface OrdenDetalleDia {
  readonly ordenId: string;
  readonly numGuia: string | null;
  /** Value crudo de `order_status`; la etiqueta y el color los pone `EstatusBadge` (R48). */
  readonly estatus: string;
  readonly resultadoDelDia: GestionResultado | null;
  readonly cliente: string;
  readonly destino: string;
  /** ISO-8601 UTC. */
  readonly asignadoAt: string;
}

export interface DetalleMensajeroDia {
  readonly mensajeroId: string;
  readonly fecha: string;
  readonly ordenes: readonly OrdenDetalleDia[];
  /** R51 — debe cuadrar con `asignadas` de la tarjeta desde la que se abrio. */
  readonly total: number;
  readonly pagina: number;
  readonly pageSize: number;
}

/* -------------------------------------------------------------------------- */
/* 4. Contrato de denegacion (design.md §3.4)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dominio CERRADO de motivos: literales, nunca un texto con ids ajenos, nombres ni PII.
 * `MotivoDenegacion` viene de `lib/analytics/alcance` con `import type` (sin runtime): el
 * resolutor de alcance es el mismo, asi que sus motivos no se reescriben aqui (R8).
 * `rol_no_autorizado` es el unico motivo propio: lo produce la lista blanca de
 * `global|zona` cuando el alcance resuelto es `tienda` o `mensajero` (R3/R9).
 */
export type MotivoTableroDia = MotivoDenegacion | "rol_no_autorizado";

/** Una Server Action no puede responder 403: devuelve un resultado discriminado (R2/R3). */
export type ResultadoTableroDia =
  | { readonly estado: "ok"; readonly tablero: TableroDia }
  | { readonly estado: "denegado"; readonly motivo: MotivoTableroDia };

/**
 * R42/R63 — el detalle comparte el mismo dominio de motivos. Los tres casos malos
 * (mensajero inexistente, fuera de alcance, sin ordenes hoy) NO se distinguen: los tres
 * dan un detalle VACIO, nunca un motivo distinto que confirme la existencia de un usuario
 * de otra zona.
 */
export type ResultadoDetalleDia =
  | { readonly estado: "ok"; readonly detalle: DetalleMensajeroDia }
  | { readonly estado: "denegado"; readonly motivo: MotivoTableroDia };
