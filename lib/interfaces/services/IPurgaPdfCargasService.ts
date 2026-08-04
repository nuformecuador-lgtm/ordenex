// Feature 178 (design §4.3, R4/R5/R10/R12/R19/R20/R21/R22/R24) — contrato del servicio del cron
// diario de purga de los PDF de etiquetas de cargas antiguas. Logica de negocio pura (sin HTTP ni
// Prisma directo): el route handler `/api/cron/purga-pdf-cargas` lo invoca con el reloj (`now`)
// inyectado y devuelve este resumen tal cual como cuerpo del `200` (R23/R24).

/**
 * Resumen agregado de una corrida (R24). SOLO numeros y un booleano: nunca rutas de objetos (que
 * contienen el id del usuario), nunca `carga_id`, nunca ids de usuario.
 */
export interface PurgaResultado {
  /** Cargas cuyas referencias quedaron limpias en esta corrida. */
  cargasPurgadas: number;
  /** Ordenes tocadas por los UPDATE de limpieza (suma de todas las cargas purgadas). */
  ordenesAfectadas: number;
  /**
   * Rutas **ENVIADAS** a `IFileStorage.remove`, NO "confirmadas como borradas" (design §6):
   * `SupabaseFileStorage.remove` descarta el `{ error }` del SDK, asi que con el contrato actual
   * es imposible saber si un borrado concreto fallo. No leer este numero como garantia.
   */
  objetosBorrados: number;
  /** R22: quedaban candidatas mas alla del tope de la corrida; las retoma la corrida siguiente. */
  quedaPendiente: boolean;
}

export interface IPurgaPdfCargasService {
  /**
   * R4/R5: resuelve la configuracion EN CADA LLAMADA y calcula el corte `now - N dias`
   * (inclusivo); purga secuencialmente hasta `PURGA_PDF_MAX_CARGAS_POR_CORRIDA` cargas y devuelve
   * los conteos agregados. El reloj se inyecta para pruebas deterministas.
   */
  ejecutar(now: Date): Promise<PurgaResultado>;
}
