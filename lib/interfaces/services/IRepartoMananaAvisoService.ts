// FICHA 413 (T5.1, design §11) — contrato del proceso que emite el aviso «tu reparto de mañana».
//
// Lo invoca el route handler del cron `aviso-reparto-manana` (19:00 CR). Sin HTTP, sin Prisma y
// sin transacciones: el reloj entra por parametro y todo lo demas por constructor.

/**
 * R35 — lo que la corrida deja dicho. **SOLO CONTEOS Y LA FECHA.** Ni un identificador de orden,
 * de persona ni de zona: este objeto lo enumera CAMPO A CAMPO el route handler y cruza tal cual a
 * una respuesta HTTP que puede quedar en un log de Vercel.
 */
export interface RepartoMananaResumen {
  /** Dia calendario CR de la corrida (`fechaCalendarioCR`). El dia ANUNCIADO es el siguiente. */
  fecha: string;
  /** `YYYY-MM-DD` del dia del que habla el aviso: el siguiente al de `fecha`. */
  diaAnunciado: string;
  /** Cuantos mensajeros tienen al menos una orden en su reparto de mañana. */
  mensajerosConReparto: number;
  /** Cuantos de ellos estaban BLOQUEADOS por cierres y por tanto NO recibieron aviso (R42). */
  mensajerosBloqueados: number;
  /** Cuantos avisos se emitieron de verdad (los con reparto, menos los bloqueados, menos fallos). */
  avisosEmitidos: number;
  /** Cuantas emisiones fallaron. La corrida TERMINA igualmente (R34). */
  fallos: number;
}

export interface IRepartoMananaAvisoService {
  /**
   * R6/R12/R18/R22/R34/R42 — recorre los mensajeros con reparto para el dia siguiente y emite UN
   * aviso a cada uno que no este bloqueado.
   *
   * @param now instante de la corrida. Decide el dia CR en curso (`startOfDayCR`) y, con el, el
   *   dia anunciado. Entra por parametro para que los tests fijen el reloj sin tocar nada global.
   */
  ejecutar(now: Date): Promise<RepartoMananaResumen>;
}
