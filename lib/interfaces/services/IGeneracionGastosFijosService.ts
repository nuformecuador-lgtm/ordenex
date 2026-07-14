// Feature 45 (design §2.2c) — contrato del servicio de GENERACION de egresos de gasto fijo
// (logica del cron mensual). Logica de negocio pura (sin HTTP ni Prisma directo): el route
// handler `/api/cron/generar-gastos-fijos` la invoca con `now`. Idempotente por (plantilla,
// periodo) via el indice unico parcial existente.

// Resumen de una corrida (sin PII, R29): solo conteos + el periodo generado.
export interface GeneracionGastosFijosResult {
  periodo: string; // YYYY-MM (hora CR, R30)
  plantillasActivas: number; // plantillas ACTIVAS evaluadas (R27)
  egresosGenerados: number; // egresos efectivamente insertados (0 en una reejecucion, R28)
}

export interface IGeneracionGastosFijosService {
  /**
   * R27/R28/R30/R31: por cada plantilla ACTIVA genera UN egreso `egreso_gasto_fijo` en la caja
   * principal para el periodo `YYYY-MM` (hora CR) de `now`. Un unico createMany atomico con
   * skipDuplicates -> idempotente por (plantilla, periodo). Devuelve conteos (sin PII).
   */
  ejecutarGeneracion(now: Date): Promise<GeneracionGastosFijosResult>;
}
