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
}

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
