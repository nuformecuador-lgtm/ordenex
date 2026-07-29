// Feature 92 (design §7, R1-R8) — contrato del gate de asignabilidad por coordenadas.
// Servicio PROPIO, consumido por los TRES writers de `mensajero_asignado_id`
// (`GuiaAsignacionService.generarGuia` rama GAM con mensajero, `.asignarDesdeBodega` y
// `AsignacionSateliteService.asignar`), para que la regla no se escriba tres veces.

/**
 * R1 — los SEIS estados posibles. La union es cerrada a proposito: la UI mapea cada valor
 * a un mensaje distinto (R9, feature 93), asi que anadir uno nuevo debe romper el
 * exhaustive check, no colarse como texto libre.
 */
export type EstadoAsignabilidad =
  /** R2: tiene latitud y longitud. Se puede asignar. */
  | "asignable"
  /** R3: la geocodificacion ya concluyo que la direccion NO existe. Terminal. */
  | "direccion_no_geocodificable"
  /** R5: el job de la direccion vigente agoto sus intentos (`estado = 'failed'`). */
  | "geocodificacion_agotada"
  /** R6: hay un job `pending` o `processing` para la direccion vigente. */
  | "geocodificacion_en_curso"
  /** R7: no habia job; se acaba de encolar uno puntual. */
  | "geocodificacion_encolada"
  /** R7: no habia job y el encolado puntual LANZO. */
  | "geocodificacion_no_encolable";

/**
 * Proyeccion MINIMA que necesita el gate. `direccion` es imprescindible: sin ella no se
 * puede reconstruir la clave exacta del job (design §0.2).
 */
export interface OrdenAsignabilidadRow {
  id: string;
  direccion: string | null;
  /** `null` cuando la orden no esta geocodificada. */
  latitud: number | null;
  longitud: number | null;
  /** Vocabulario opaco del proveedor: OK | ZERO_RESULTS | INVALID_REQUEST | SIN_DIRECCION. */
  geocodeStatus: string | null;
}

export interface IAsignabilidadCoordenadasService {
  /**
   * R1-R7: clasifica el lote completo en UNA pasada, con como mucho UNA consulta a la
   * cola. Devuelve el estado de CADA orden recibida (nunca omite ninguna).
   */
  evaluar(ordenes: OrdenAsignabilidadRow[]): Promise<Map<string, EstadoAsignabilidad>>;
}
