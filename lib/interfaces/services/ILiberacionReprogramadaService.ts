// Feature 46 (R7/R12/R13/R14/R17) — contrato del servicio de la liberacion programada.
// Logica de negocio pura (sin HTTP ni Prisma directo): el route handler
// `/api/cron/liberar-reprogramadas` la invoca con "hoy" en zona CR ya calculado.

// Resumen de una corrida (sin PII, R7/R19): se devuelve al cron para observabilidad.
export interface LiberacionResult {
  // Ordenes candidatas evaluadas (reprogramadas con fecha <= hoy CR, R10).
  evaluadas: number;
  // Ordenes efectivamente liberadas a su bodega responsable (R12/R13).
  liberadas: number;
  // Ordenes omitidas: fallo por orden (R14) o guarda de estado ya no vigente (R17).
  omitidas: number;
}

export interface ILiberacionReprogramadaService {
  /**
   * R12-R14/R17: libera las ordenes reprogramadas cuya fecha ya llego (`hoyCR`),
   * derivando la bodega responsable por zona (central -> `en_bodega_central`, satelite ->
   * `en_bodega_satelite`), limpiando el mensajero y marcando `liberada_reprogramada_at`.
   * Resiliente por orden (un fallo no aborta la corrida). Idempotente (una re-corrida no
   * re-libera: la orden ya salio de `reprogramada`). No conoce HTTP; la fecha se inyecta.
   */
  ejecutarLiberacion(hoyCR: Date): Promise<LiberacionResult>;
}
