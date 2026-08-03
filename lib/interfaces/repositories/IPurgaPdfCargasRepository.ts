// Feature 178 (design §4.2, R5/R7/R8/R9/R13/R14/R15/R22) — contrato del repositorio del cron de
// purga de los PDF de etiquetas de cargas antiguas. SOLO queries Prisma: la ventana de retencion
// (`now - N dias`), el borrado en Storage y el orden de operaciones los decide
// `PurgaPdfCargasService`. Sin tablas ni columnas nuevas: se leen y anulan las cuatro columnas
// testigo que ya existen (`carga.download_url`, `carga.download_storage_path`,
// `orden.download_url`, `orden.download_storage_path`).

/**
 * Feature 178/R7 — unidad de purga: UNA carga con todas las rutas de Storage que le cuelgan.
 * La agrupacion es por `carga_id` (decision del humano), asi que la carga y sus ordenes se
 * resuelven juntas o no se resuelven.
 */
export interface CargaPurgable {
  cargaId: string;
  /** Ruta del PDF consolidado del lote, o null si nunca se persistio (features 136/141). */
  cargaPath: string | null;
  /**
   * Rutas de los PDF individuales de las ordenes del lote, SIN nulos. Incluye las ordenes
   * borradas (`deleted_at` no nulo): sus objetos ocupan el mismo bucket (R9).
   */
  ordenPaths: string[];
}

export interface IPurgaPdfCargasRepository {
  /**
   * R5/R7/R8/R9: hasta `limite` cargas con `created_at <= corte` (corte INCLUSIVO, decision (f))
   * que conserven alguna REFERENCIA VIVA — `download_storage_path` o `download_url` no nulos en
   * la propia carga, o en alguna de sus ordenes (R8: una carga ya purgada no es candidata) —,
   * ordenadas por `created_at` ASC (lo mas viejo primero, §2.1). El corte se mide SIEMPRE sobre
   * `created_at`, NUNCA sobre `fecha_carga` (decision (a): `created_at` es inmutable).
   * Las rutas de las ordenes se recogen SIN filtrar por `deleted_at` (R9).
   */
  findCargasPurgables(corte: Date, limite: number): Promise<CargaPurgable[]>;
  /**
   * R22: ¿EXISTE todavia alguna candidata con este corte? Se consulta DESPUES del bucle de purga,
   * asi que la pregunta correcta es de mera EXISTENCIA, no "¿hay algo mas alla del tope?".
   *
   * NO lleva `limite` ni `skip` A PROPOSITO: saltarse las `limite` ya procesadas seria INCORRECTO
   * porque esas cargas YA NO CASAN el predicado — `limpiarReferencias` acaba de poner sus cuatro
   * columnas testigo a NULL, asi que salieron del `where` de candidatas (R8). Un `skip: limite`
   * descontaria un SEGUNDO lote de candidatas todavia VIVAS y devolveria `false` con backlog
   * pendiente para todo P con `limite < P <= 2*limite`. No reintroducir el `skip` "optimizando".
   */
  existeAlgunaCandidata(corte: Date): Promise<boolean>;
  /**
   * R13/R14/R15/R9: en UNA transaccion, deja a NULL `download_url` y `download_storage_path` en
   * TODAS las ordenes de la carga (incluidas las borradas: sin `deleted_at` en el `where`, R9) y
   * en la propia carga. Ninguna otra columna en el `data` y ninguna fila borrada (R15).
   * Devuelve cuantas ordenes toco el UPDATE.
   */
  limpiarReferencias(cargaId: string): Promise<{ ordenesActualizadas: number }>;
}
