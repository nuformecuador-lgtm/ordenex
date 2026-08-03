import type { PlanBackfill } from "@/lib/analytics/backfill-rango";
import type { EtapaCorrida } from "@/lib/interfaces/services/IAnaliticaRollupService";

// Feature 125 (design §3, T2.1) — CONTRATO del iterador de fechas del backfill.
//
// Este servicio NO agrega nada: recorre un plan de fechas y llama, una vez por fecha, a
// `IAnaliticaRollupService.agregarFecha` (feature 124, entregada). Lo que la 124 devuelve es lo
// que se reporta, sin transformar ni enriquecer.
//
// Todo lo que sale por aqui son fechas y conteos: ni un id de zona, tienda, mensajero, estatus u
// orden, porque `ResumenCorrida` tampoco los lleva (`IAnaliticaRollupService.ts`, lineas 7-11).

/**
 * El modo de la corrida. Los DOS escriben, y eso se dice en voz alta (R26): la verificacion
 * recomputa la fecha con el agregador de la 124, y no hay forma de recomputar sin escribir con
 * ese contrato. Como la escritura es idempotente, sobre una base estable el efecto es nulo
 * salvo `updated_at`.
 */
export type ModoBackfill = "escritura" | "verificacion";

/**
 * R20/R25 — la clasificacion de UNA fecha. `procesada` es la del modo escritura; `estable` y
 * `cambiada` solo aparecen en verificacion; `no_comparable` y `fallida` en los dos.
 *
 * `no_comparable` se decide ANTES de mirar el resultado y gana a `estable`/`cambiada`: bajo el
 * horizonte del historial el agregador devuelve cero filas en TODAS las medidas (L1), asi que
 * llamar «estable» a ese cero seria decir que se verifico algo que no se pudo mirar.
 */
export type ClasificacionFecha = "procesada" | "no_comparable" | "fallida" | "estable" | "cambiada";

/** R17/R19 — lo que se emite (y se reporta) por CADA fecha del rango. Sin ids. */
export interface LineaFecha {
  readonly fecha: string;
  readonly filasEscritas: number;
  readonly filasRetiradas: number;
  readonly ms: number;
  readonly clasificacion: ClasificacionFecha;
}

/**
 * R30/R31 — el fallo de UNA fecha, con su contexto. El error crudo viaja aparte (`error`) para
 * que quien imprime decida: por defecto solo `fecha`, `nombreError` y `etapa`; con `--verboso`,
 * el error entero. El mensaje crudo de `PrimerIntentoIncoherenteError` incluye la clave del cubo
 * (ids de catalogo), y ese es justamente el vector que R30 cierra.
 */
export interface FallaFecha {
  readonly fecha: string;
  readonly modo: ModoBackfill;
  readonly nombreError: string;
  readonly etapa?: EtapaCorrida;
  readonly error: unknown;
}

/**
 * Puerto de salida del servicio. El servicio NO habla por `console`: asi la corrida completa se
 * ejecuta en test sin ensuciar la salida y sin espiar globales (R3), y el script decide el
 * formato, el nivel de detalle y el reporte en disco.
 */
export interface SalidaProgreso {
  linea(linea: LineaFecha): void;
  falla(falla: FallaFecha): void;
  aviso(mensaje: string): void;
}

/** R23 — lo que el modo verificacion compara contra la pasada anterior, leido del reporte. */
export interface EntradaPrevia {
  readonly fecha: string;
  readonly filasEscritas: number;
}

export interface OpcionesBackfill {
  /** Plan YA validado por `planificarBackfill`: el servicio no reinterpreta el rango. */
  readonly plan: PlanBackfill;
  readonly modo: ModoBackfill;
  /** R16 — pausa entre fechas consecutivas, en milisegundos. Por defecto 0. */
  readonly pausaMs?: number;
  /** Obligatorio en modo verificacion: sin linea base no se puede decir «estable» (design §6). */
  readonly previo?: ReadonlyMap<string, EntradaPrevia>;
}

/**
 * R18 — el resumen de la corrida. Invariantes que el test comprueba y que hacen las cuentas
 * legibles:
 *   `procesadas + fallidas + sinProcesar === fechasDelRango`
 *   `noComparables` es un SUBCONJUNTO de `procesadas` (una fecha bajo horizonte se procesa
 *   igual que cualquier otra, R21: la unica diferencia es la etiqueta).
 */
export interface ResumenBackfill {
  readonly desde: string;
  readonly hasta: string;
  readonly modo: ModoBackfill;
  readonly fechasDelRango: number;
  readonly procesadas: number;
  readonly fallidas: number;
  readonly noComparables: number;
  readonly estables: number;
  readonly cambiadas: number;
  readonly filasEscritas: number;
  readonly filasRetiradas: number;
  /** Duracion total de la corrida, medida con el reloj INYECTADO. */
  readonly ms: number;
  /** R31 — toda fecha fallida aparece por su nombre; no hay «exito parcial silencioso». */
  readonly fechasFallidas: readonly string[];
  /** R14 — fechas del rango que la corrida no llego a tocar por el corte de fallos. */
  readonly sinProcesar: number;
  readonly abortadaPorFallosConsecutivos: boolean;
  /** design §7 — `0` todo bien; `2` hubo fechas fallidas o cambiadas. */
  readonly codigoSalida: number;
}

export interface IAnaliticaBackfillService {
  ejecutar(opciones: OpcionesBackfill): Promise<ResumenBackfill>;
}
