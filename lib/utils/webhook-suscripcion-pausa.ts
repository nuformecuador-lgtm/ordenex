// FICHA 403 (design §2) — EL PREDICADO DEL CIRCUITO. Helper PURO (`docs/architecture.md`,
// `lib/utils/`): sin `Date.now()`, sin `process.env`, sin repositorio y sin efectos.
//
// POR QUE UNA FUNCION Y NO UNA COLUMNA. "Pausada" es un estado 100 % DERIVADO de dos datos que ya
// hay que guardar (`fallosConsecutivos`, `sinExitoDesde`) mas el reloj. Persistir en paralelo un
// booleano `pausada` abriria la puerta a que divergiera de los datos que lo determinan —basta con
// que un camino de recuperacion futuro se olvide de limpiarlo— y entonces el flag mentiria sobre
// el historial de fallos. Con el valor derivado hay UNA sola fuente de verdad (design §1.1,
// alternativa descartada 3).
//
// SE USA EN DOS SITIOS, Y ESE ES EL PUNTO:
//   1. ESCRITURA — `WebhookEstadoService.ejecutar`, tras un fallo: decide si ESTE intento se
//      espacia al intervalo de pausa en vez del backoff exponencial normal (R4).
//   2. LECTURA — `WebhookSuscripcionRepository.findByOwner`: decide si la pantalla de
//      Configuracion > API muestra el aviso de pausa (R18).
// Al ser la MISMA funcion, "cuando espaciamos los reintentos" y "que le enseñamos al dueño" no
// pueden divergir. Y al evaluarse en el momento de la consulta, la lectura nunca queda congelada:
// si pasa el tiempo suficiente sin que nadie mire, la proxima vez que se abra el modal ya lo dira.
//
// ⚠️ PAUSAR NO ES DESACTIVAR. Esta funcion no lee ni escribe `activa` (R5): la suscripcion sigue
// viva, sigue encolando y sigue reintentando; lo unico que cambia es el ESPACIADO. Y se sale de la
// pausa SOLA, sin intervencion manual, en cuanto `registrarEntregaOk` reinicia los dos datos (R2).

/** Los dos numeros que definen el umbral. Vienen de `WebhookConfig` (R8), nunca hardcodeados. */
export interface WebhookPausaConfig {
  /** Piso de EVIDENCIA: fallos consecutivos minimos antes de que el reloj pueda actuar. */
  fallosMinimos: number;
  /** Ventana sin ninguna entrega aceptada, en ms. */
  ventanaMs: number;
}

/**
 * R4/R6 — `true` solo si se cumplen LAS DOS condiciones a la vez:
 *
 *   · `fallosConsecutivos >= fallosMinimos`  (piso de evidencia), y
 *   · `ahora - sinExitoDesde >= ventanaMs`   (eje de tiempo).
 *
 * POR QUE HACEN FALTA LAS DOS (design §3):
 *
 *  - SOLO CONTEO: es sensible al volumen de la propia app. Una carga masiva puede generar en
 *    minutos el mismo numero de fallos que una caida real de horas, y el historico del incidente
 *    (89 a 772 jobs/dia para la MISMA suscripcion) muestra que el volumen diario no es estable.
 *  - SOLO TIEMPO: una suscripcion con trafico muy esporadico —un pedido, un fallo aislado y luego
 *    silencio REAL porque no llega ningun otro pedido— entraria en pausa por el solo transcurso
 *    del reloj sobre UN dato. El piso de 3 exige mas de un caso antes de que el tiempo cuente.
 *
 * Es tambien lo que hace R6 estructural: una CAIDA CORTA Y AISLADA —el falso positivo que de
 * verdad importa, porque ahora hay un integrador real conectado— no cruza la ventana, asi que
 * devuelve `false` y sus reintentos siguen con el backoff exponencial generico de la cola.
 *
 * `>=` en las DOS comparaciones, no `>`: el umbral se ALCANZA, no se supera (R4 dice "alcanza el
 * umbral" y "han transcurrido al menos la ventana").
 */
export function estaPausada(
  fallosConsecutivos: number,
  sinExitoDesde: Date,
  ahora: Date,
  config: WebhookPausaConfig,
): boolean {
  if (fallosConsecutivos < config.fallosMinimos) return false;
  return ahora.getTime() - sinExitoDesde.getTime() >= config.ventanaMs;
}
