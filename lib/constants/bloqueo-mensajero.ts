/**
 * Feature 111/R12 + 167/R9 — aviso accionable del BLOQUEO TOTAL del mensajero por un cierre
 * pendiente (`solicitado` / `vencido`). Texto separado del componente (i18n-ready).
 *
 * Vive aquí, y no dentro de un módulo de página, porque desde la feature 167 lo necesitan DOS
 * portales del mensajero: "Entregas" (`MisAsignacionesModule`) y "Recolección"
 * (`RecoleccionModule`). Duplicarlo dejaría que divergieran en el mensaje que el humano ya
 * declaró como preciso —decir la causa REAL del rechazo y qué hacer para resolverlo (commit
 * `8428498a`)—, que es justo la clase de deriva silenciosa que un texto compartido impide.
 *
 * NO lo usa `CierreDiaModule`: allí el mensajero YA está en "Cierre del día" y remitirlo a la
 * pantalla en la que está sería ruido. Ese módulo conserva su propia variante sin el CTA.
 */
export const BLOQUEO_AVISO =
  "No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente. Ve a «Cierre del día» para resolverlo.";
