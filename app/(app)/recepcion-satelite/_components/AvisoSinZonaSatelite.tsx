// Feature 278 (T3.3, R25) — el aviso de «no tienes zona asignada», en UN solo sitio.
//
// Por qué existe este archivo: la ficha 278 parte el portal del `adminSatelite` en dos
// pantallas («Por recibir» y «En bodega») y R25 exige que las dos muestren EXACTAMENTE el
// mismo aviso. Dos copias del literal en dos módulos es la receta conocida de dos textos
// gemelos que divergen: el día que alguien corrija la redacción en una pantalla, la otra
// se queda con la vieja y nada se pone rojo.
//
// No es un Client Component: no tiene estado ni manejadores. Se monta tanto desde
// `PorRecibirModule` como desde `RecepcionSateliteModule`, que sí lo son.

/**
 * El texto del aviso, exportado para que los tests lo afirmen SIN copiarlo.
 *
 * Un test que reescriba el literal a mano deja de medir el texto de la pantalla y pasa a
 * medir su propia copia: la aserción se vuelve verde contra sí misma y el día que el aviso
 * cambie, el test no se entera. Aquí la fuente es una sola.
 */
export const AVISO_SIN_ZONA_SATELITE =
  "No tienes una zona asignada. Pide a un administrador que te asigne una zona para poder recibir órdenes.";

/**
 * Aviso accionable (`role="alert"`) para el `adminSatelite` sin zona asignada.
 *
 * `role="alert"` y no `role="status"`: sin zona el actor no puede recibir NADA —el
 * servidor le responde `sin_zona`— así que es una condición que le impide trabajar, no
 * una nota informativa. Es el mismo rol que llevaba el aviso antes de partirse en dos.
 */
export function AvisoSinZonaSatelite() {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {AVISO_SIN_ZONA_SATELITE}
    </p>
  );
}
