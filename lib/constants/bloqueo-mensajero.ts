/**
 * Feature 111/R12 + 167/R9 — aviso accionable del bloqueo del mensajero por un cierre sin
 * resolver. Texto separado del componente (i18n-ready).
 *
 * ⚠️ FEATURE 241 (2026-08-20) — EL TEXTO CAMBIO PORQUE DECIA ALGO FALSO. Decia «No puedes
 * gestionar NI RECIBIR NUEVAS ASIGNACIONES»: desde el 2026-08-18 recibir asignaciones no se
 * bloquea, y la regla firmada lo ratifica. Un aviso que prohibe mas de lo que el servidor rechaza
 * es peor que no avisar — el mensajero deja de intentar cosas que si puede hacer.
 *
 * Y se enciende SOLO con `vencido` o `rechazado`, nunca con `solicitado`: quien ya pidio su cierre
 * esta esperando al admin y no tiene nada que resolver, asi que mandarlo a «Cierre del día» seria
 * mandarlo a mirar. Ver `findMensajerosBloqueadosParaGestion` en `OrdenRepository`.
 *
 * Vive aquí, y no dentro de un módulo de página, porque desde la feature 167 lo necesitan DOS
 * portales del mensajero: "Entregas" (`RepartoModule` / `RecogerModule`) y "Recolección"
 * (`RecoleccionModule`). Duplicarlo dejaría que divergieran en el mensaje que el humano ya
 * declaró como preciso —decir la causa REAL del rechazo y qué hacer para resolverlo (commit
 * `8428498a`)—, que es justo la clase de deriva silenciosa que un texto compartido impide.
 *
 * NO lo usa `CierreDiaModule`: allí el mensajero YA está en "Cierre del día" y remitirlo a la
 * pantalla en la que está sería ruido. Ese módulo conserva su propia variante sin el CTA.
 */
export const BLOQUEO_AVISO =
  "No puedes gestionar entregas ni cobrar hasta resolver tu cierre. Sí puedes seguir recibiendo asignaciones. Ve a «Cierre del día» para resolverlo.";
