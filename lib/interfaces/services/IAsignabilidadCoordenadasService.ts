// Feature 92 (design §7, R1-R8) — contrato del gate de asignabilidad por coordenadas.
// Servicio PROPIO, consumido por los TRES writers de `mensajero_asignado_id`
// (`GuiaAsignacionService.generarGuia` rama GAM con mensajero, `.asignarDesdeBodega` y
// `AsignacionSateliteService.asignar`), para que la regla no se escriba tres veces.

/**
 * R1 — los SIETE estados posibles (SEIS hasta la ficha 400). La union es cerrada a
 * proposito: la UI mapea cada valor BLOQUEANTE a un mensaje distinto (R9, feature 93), asi
 * que anadir uno nuevo debe romper el exhaustive check, no colarse como texto libre.
 *
 * FEATURE 400 (2026-09-09): ese exhaustive check pasa a ser REAL. Hasta esta ficha era una
 * promesa de este mismo comentario y nada lo comprobaba —el mapa de mensajes clasificaba
 * los motivos con dos arrays de literales y un valor nuevo caia al `null` defensivo—. Con
 * `EstadoBloqueante` (abajo) el mapa se tipa por la lista, y olvidarse de un estado es un
 * error de compilacion.
 */
export type EstadoAsignabilidad =
  /** R2: tiene latitud y longitud. Se puede asignar. */
  | "asignable"
  /**
   * FEATURE 400 (R1): no tiene coordenadas, pero el ultimo intento de geocodificacion
   * murio por un fallo de configuracion NUESTRO (el proveedor rechazo la peticion, o falta
   * la credencial) — la direccion NUNCA llego a consultarse. Se puede asignar: la orden
   * queda SIN ubicacion y entra en el modo degradado que ya existe (feature 92 R37/R28/R30:
   * se excluye del calculo de ruta sin abortarlo, se muestra al final de la lista del
   * mensajero y el modulo avisa). Puede recibir coordenadas mas tarde, ya asignada.
   */
  | "asignable_sin_ubicacion"
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
 * FEATURE 400 (2026-09-09, design §5) — los estados que DEJAN PASAR la asignacion. UNICO
 * sitio donde se decide eso: `esAsignable` se implementa contra esta lista y los tres
 * writers preguntan por `esAsignable`, nunca por un literal suelto.
 */
export type EstadoAsignable = "asignable" | "asignable_sin_ubicacion";

/**
 * FEATURE 400 (2026-09-09, design §5) — los estados que BLOQUEAN, y por tanto viajan como
 * `motivo` en el `detalle` de un rechazo y necesitan un mensaje de usuario.
 *
 * Se deriva por `Exclude` y no se escribe a mano: asi anadir un valor a
 * `EstadoAsignabilidad` sin clasificarlo como asignable lo mete AUTOMATICAMENTE aqui, y el
 * `Record<EstadoBloqueante, string>` del mapa de mensajes deja de compilar hasta que
 * alguien decida su texto. Un estado nuevo no puede colarse en silencio (R25).
 */
export type EstadoBloqueante = Exclude<EstadoAsignabilidad, EstadoAsignable>;

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
