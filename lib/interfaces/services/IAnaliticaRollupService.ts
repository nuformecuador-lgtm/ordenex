import type { MedidaReconciliable } from "@/lib/interfaces/repositories/IAnaliticaRollupRepository";

// Feature 124 (design §2) — contrato del servicio que agrega UNA fecha calendario de Costa
// Rica en `analytics_daily`. El servicio NO conoce Next.js ni Prisma: recibe el repositorio
// y el contador de intentos por constructor y devuelve un resumen plano.

/**
 * Salida observable de una corrida (R37/R47/D9). SIN `BigInt` a proposito (R32):
 * `seg_ciclo_acum` es `BigInt` en la base y `JSON.stringify` de un `BigInt` LANZA
 * `TypeError`, asi que el resumen que se registra y se devuelve solo lleva conteos y
 * milisegundos. Tampoco lleva ids ni ningun dato de dominio: nada de PII (R37).
 */
export interface ResumenCorrida {
  /** Fecha agregada, `YYYY-MM-DD` calendario CR. */
  readonly fecha: string;
  readonly filasEscritas: number;
  readonly filasRetiradas: number;
  /** Duracion de la corrida en milisegundos, medida con el reloj INYECTADO (R8). */
  readonly ms: number;
}

/** Etapa de la corrida, para dar contexto al error sin filtrar datos de dominio (R38). */
export type EtapaCorrida =
  | "ordenes_creadas"
  | "ordenes_estado_stock"
  | "gestiones"
  | "entregas_vigentes"
  | "intentos_previos"
  | "ciclos_cerrados"
  | "totales_de_control"
  | "escritura";

/**
 * R38 — todo fallo de la corrida se propaga envuelto con la fecha objetivo y la etapa. El
 * error original viaja en `cause`; el mensaje NO incluye ids, guias ni destinatarios.
 */
export class AnaliticaRollupError extends Error {
  constructor(
    readonly fecha: string,
    readonly etapa: EtapaCorrida,
    causa: unknown,
  ) {
    super(`rollup analitica ${fecha}: fallo en la etapa ${etapa}`);
    this.name = "AnaliticaRollupError";
    this.cause = causa;
  }
}

/**
 * R18 — invariante LOCAL comprobado ANTES de tocar la base: ninguna fila puede llevar
 * `primer_intento_ok > entregas`. El `CHECK analytics_daily_pio_lte_entregas` es la red de
 * la base; este error es el diagnostico util, con la fecha y el cubo (coordenadas, que no
 * son PII: son ids de catalogo).
 */
export class PrimerIntentoIncoherenteError extends Error {
  constructor(
    readonly fecha: string,
    readonly cubo: string,
    readonly primerIntentoOk: number,
    readonly entregas: number,
  ) {
    super(
      `rollup analitica ${fecha}: primer_intento_ok (${primerIntentoOk}) > entregas (${entregas}) en el cubo ${cubo}`,
    );
    this.name = "PrimerIntentoIncoherenteError";
  }
}

/**
 * R33/R34 (D5) — la suma de una medida sobre las filas escritas de la fecha no coincide con
 * el escalar independiente. Se lanza DENTRO de la transaccion, que aborta. El mensaje nombra
 * la MEDIDA y la FECHA, que es lo que R34 exige.
 */
export class ReconciliacionError extends Error {
  constructor(
    readonly fecha: string,
    readonly medida: MedidaReconciliable,
    readonly sumaEscrita: number,
    readonly totalEsperado: number,
  ) {
    super(
      `rollup analitica ${fecha}: la medida ${medida} no reconcilia (escrito ${sumaEscrita}, esperado ${totalEsperado})`,
    );
    this.name = "ReconciliacionError";
  }
}

export interface IAnaliticaRollupService {
  /**
   * Agrega la fecha calendario CR `YYYY-MM-DD` indicada: escribe SUS filas y solo las suyas
   * (R35). Idempotente (R27) y todo-o-nada (R30). Un dia sin datos termina con exito y CERO
   * filas escritas (R46).
   */
  agregarFecha(fecha: string): Promise<ResumenCorrida>;
}
