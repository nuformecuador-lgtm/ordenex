import type { GastoFijoCobroTxClient } from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type { WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 45 (design §2.2c) — contrato del servicio de GENERACION de egresos de gasto fijo
// (logica del cron). Logica de negocio pura (sin HTTP ni Prisma directo): el route handler
// `/api/cron/generar-gastos-fijos` la invoca con `now`.
//
// Feature 84: el cron pasa de MENSUAL DIA 1 a DIARIO (`0 6 * * *`) y es el SERVICE quien decide
// que plantillas aplican HOY segun su periodicidad. Por eso el resultado ya NO lleva un unico
// `periodo`: con periodicidad arbitraria no existe "el periodo de la corrida" (cada plantilla
// tiene el suyo). Lleva conteos + la fecha CR de la corrida.

// Resumen de una corrida (sin PII, R29): solo conteos + la fecha CR.
export interface GeneracionGastosFijosResult {
  fecha: string; // `YYYY-MM-DD`: dia calendario CR de la corrida (hora CR, UTC-6)
  plantillasActivas: number; // plantillas ACTIVAS evaluadas (R27)
  plantillasQueAplicanHoy: number; // de las activas, las que disparan hoy (feature 84)
  egresosGenerados: number; // egresos efectivamente insertados (0 en una reejecucion, R28)
  /**
   * FICHA 333 (D3/D6, R13) — cobros PENDIENTES creados en ESTA corrida: las plantillas que
   * aplican hoy y estan en «requiere aprobacion». `0` en una reejecucion del mismo dia, porque
   * `gasto_fijo_cobro_origen_uq` los deduplica en el motor (R9).
   */
  cobrosPendientesCreados: number;
  /**
   * FICHA 333 (D3/D6, R13/R29/R30) — cobros que siguen `pendiente` al terminar la corrida.
   *
   * TODOS, no solo los de hoy, y esa diferencia ES el recordatorio (R30): el aviso existe
   * precisamente para los dias en que no se genero ninguno nuevo y sigue habiendo cola. Es
   * ademas el numero que viaja al aviso de la campana (R29/R35).
   */
  cobrosPendientesTotales: number;
}

/**
 * FICHA 333 (D3, design §5) — el cliente que la transaccion de la corrida necesita: las DOS
 * tablas que escribe, y ninguna mas. `wallet_movimiento` (las plantillas que cobran solas) y
 * `gasto_fijo_cobro` (las que requieren aprobacion).
 */
export type GeneracionGastosFijosTx = WalletTxClient & GastoFijoCobroTxClient;

/**
 * FICHA 333 (D3, R10) — ejecuta `fn` dentro de UNA transaccion y revierte si lanza: o quedan las
 * DOS colecciones de la corrida, o no queda ninguna.
 *
 * Hasta esta ficha la corrida era un unico `createMany`, o sea atomica por construccion. Al
 * partirse en dos escrituras hace falta devolver esa garantia explicitamente: si la segunda
 * fallara sin transaccion, los cobros de ese dia NO se recuperarian mañana, porque `aplicaHoy`
 * es una regla de dia y no una cola.
 *
 * Se INYECTA por constructor (precedente: `LiquidacionTxRunner`): el servicio no importa Prisma.
 */
export type GeneracionGastosFijosTxRunner = <T>(
  fn: (tx: GeneracionGastosFijosTx) => Promise<T>,
) => Promise<T>;

export interface IGeneracionGastosFijosService {
  /**
   * R27/R28/R30/R31 + feature 84: de las plantillas ACTIVAS, genera UN egreso `egreso_gasto_fijo`
   * en la caja principal por cada una que APLIQUE HOY segun su periodicidad (`aplicaHoy`, dia
   * calendario CR de `now`). Un unico createMany atomico con skipDuplicates -> idempotente por
   * (plantilla, periodo), con la clave `<plantillaId>:<YYYY-MM>` para `meses` y
   * `<plantillaId>:<YYYY-MM-DD>` para `dias`/`semanas`. Devuelve conteos (sin PII).
   */
  ejecutarGeneracion(now: Date): Promise<GeneracionGastosFijosResult>;
}
