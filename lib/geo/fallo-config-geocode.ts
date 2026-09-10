// Feature 400 (2026-09-09, design §2, R11-R16) — EL MARCADOR DE «FALLO DE CONFIGURACION
// NUESTRA» QUE VIAJA CON EL ERROR DEL JOB DE GEOCODIFICACION.
//
// EL PROBLEMA QUE RESUELVE. El 2026-09-08 la credencial de Google empezo a rechazar todas
// las peticiones (`REQUEST_DENIED`) y 42 ordenes quedaron 19 horas sin poder asignarse a
// ningun mensajero, con el operador leyendo «Direccion no encontrada» sobre direcciones
// perfectamente validas. La causa no era la direccion: era NUESTRA configuracion. Pero al
// llegar al gate de asignabilidad los dos casos eran indistinguibles, porque lo unico que
// sobrevive al salto por la cola es una CADENA de texto (`jobs.last_error`).
//
// POR QUE UN PREFIJO Y NO OTRA COSA (design §2.2):
//   - `JobQueueService.mensajeError` recorta el mensaje a 500 caracteres DESDE EL PRINCIPIO
//     (`raw.slice(0, MAX_ERROR_LEN)`). Un marcador al final se perderia con un detalle
//     largo; uno al principio es indestructible por ese recorte (R12).
//   - Se detecta con `startsWith`, no con `includes`: asi un error ajeno que MENCIONE el
//     marcador dentro de su texto no se confunde con un fallo de configuracion.
//   - Es un literal CONSTANTE, nunca una plantilla con datos: no puede colarse por aqui la
//     direccion, el id de la orden, la credencial ni la URL del proveedor (R14).
//   - Se declara UNA sola vez, aqui, y las dos puntas lo importan (R13). Un literal copiado
//     en el gate se desincronizaria en silencio el dia que alguien cambie el prefijo, y el
//     fallo seria MUDO: el gate dejaria de reconocer el caso y volveriamos al bug de origen
//     sin ningun test rojo. Lo protege
//     `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts`.
//
// Modulo SIN dependencias a proposito: lo importan un service de dominio
// (`GeocodificacionService`, que lo escribe) y otro (`AsignabilidadCoordenadasService`, que
// lo lee), y ninguno debe arrastrar al otro.

/**
 * Prefijo estable que identifica «fallo de configuracion NUESTRA» en `jobs.last_error`.
 *
 * NO depende de la prosa del error: la frase «el proveedor rechazo la peticion
 * (REQUEST_DENIED)» puede reescribirse manana sin romper nada; este prefijo no, porque hay
 * un guard y un test de contrato que lo afirman.
 */
export const MARCADOR_FALLO_CONFIG_GEOCODE = "[geocode:config]";

/**
 * Envuelve el detalle del fallo con el marcador. UNICA forma de producirlo (R13).
 *
 * Idempotente: marcar dos veces no duplica el prefijo. Lo necesita la reparacion de datos
 * historicos (`scripts/backfill-marcador-config-geocode.ts`, R17), que debe poder correrse
 * dos veces sin dejar `[geocode:config] [geocode:config] ...`.
 */
export function marcarFalloConfigGeocode(detalle: string): string {
  if (esFalloConfigGeocode(detalle)) return detalle;
  return `${MARCADOR_FALLO_CONFIG_GEOCODE} ${detalle}`;
}

/**
 * UNICA forma de detectarlo (R13). `null`/`undefined` -> `false`: un job sin error
 * registrado no es un fallo de configuracion.
 *
 * `startsWith` y no `includes`: ver la cabecera. Un error de red cuyo texto citara el
 * marcador no debe abrir la puerta de la asignacion.
 */
export function esFalloConfigGeocode(lastError: string | null | undefined): boolean {
  if (lastError === null || lastError === undefined) return false;
  return lastError.startsWith(MARCADOR_FALLO_CONFIG_GEOCODE);
}
