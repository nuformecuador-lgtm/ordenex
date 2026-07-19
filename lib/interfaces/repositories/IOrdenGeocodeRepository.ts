// Feature 91 (design §5) — contrato de lectura/escritura de los datos de geocodificacion
// de una orden. Interfaz ESTRECHA a proposito: el handler no necesita (ni debe poder)
// tocar el resto de la orden. Solo queries; la politica vive en el service.

/** Datos minimos de la orden para construir la consulta (design §4). */
export interface OrdenGeocodeRow {
  id: string;
  direccion: string | null;
  distritoNombre: string | null;
  cantonNombre: string;
  provinciaNombre: string;
}

/** Resultado a persistir en la orden tras un intento de geocodificacion. */
export interface OrdenGeocodeUpdate {
  latitud: number | null;
  longitud: number | null;
  precision: string | null;
  status: string;
  geocodedAt: Date;
}

export interface IOrdenGeocodeRepository {
  /**
   * Lee la orden con los nombres de su catalogo geografico. Devuelve `null` si no existe
   * o esta borrada (`deleted_at != null`) — el handler lo trata como job completado (R30).
   */
  findParaGeocodificar(ordenId: string): Promise<OrdenGeocodeRow | null>;

  /**
   * Escribe el resultado del intento. Usa `updateMany` con `deletedAt: null` (patron de
   * `OrdenRepository.update`) para NO lanzar si la orden se borro entre la lectura y la
   * escritura: esa carrera no es un error del sistema.
   */
  guardarResultado(ordenId: string, data: OrdenGeocodeUpdate): Promise<void>;
}
