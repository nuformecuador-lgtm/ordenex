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
  /**
   * FEATURE 276 (T6.2, R12/R13) — candidatas que NO se liberan porque su gestion `reprogramada`
   * vigente TODAVIA PUEDE SUBIR EL CONTADOR: nace de una visita real y su cierre no esta aprobado.
   *
   * Es un CONTADOR AGREGADO y sin PII (R38), y no es decorativo: es lo unico que hace OBSERVABLE
   * la poblacion congelada del «Riesgo declarado» de requirements — ordenes que se quedan quietas
   * en `reprogramada` esperando a que alguien apruebe un cierre. La vigilancia continua sobre esa
   * poblacion sigue siendo ficha aparte (M3 del §7bis de la 215); esto es el minimo para poder
   * verla crecer.
   *
   * Opcional (`?`) por el patron aditivo del repo: no rompe los dobles ni los fixtures que
   * construyen un `LiberacionResult` sin el. El servicio SIEMPRE lo emite, el `0` incluido.
   */
  esperandoCierre?: number;
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
