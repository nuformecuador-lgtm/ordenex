/**
 * Feature 211 — el tema visual como dato, sin DOM y sin React.
 *
 * ═══ DOS TEMAS ELEGIBLES, NO TRES (decisión humana, 2026-08-14) ═══
 * El control ofrece SÓLO «Claro» y «Oscuro». «Sistema» dejó de ser una opción: pedirle a
 * alguien que entienda la diferencia entre «oscuro» y «lo que diga tu sistema operativo,
 * que ahora mismo es oscuro» es pedirle que razone sobre un estado que se ve idéntico al
 * otro. La consecuencia práctica era un ciclo de tres pasos en el que dos posiciones
 * pintaban lo mismo y parecía que el botón no hacía nada.
 *
 * ═══ PERO EL SISTEMA SIGUE DECIDIENDO EL ARRANQUE ═══
 * Quien no ha elegido nunca NO tiene tema: `normalizarTema` devuelve `null`, y ese estado
 * lo resuelve `globals.css` con `@media (prefers-color-scheme: dark)` sobre la clase
 * `tema-sistema` — SO en oscuro, se ve oscuro; si no, claro. Esto es lo que hace que no
 * haya parpadeo: el servidor no puede conocer `prefers-color-scheme` (no viaja en ninguna
 * cabecera que pidamos), así que resolverlo en JS obligaría a un script bloqueante en el
 * `<head>` o a pintar el tema equivocado durante un frame. Resolverlo en CSS no cuesta ni
 * lo uno ni lo otro.
 *
 * `null` NO es un tercer tema: es «todavía sin elegir». No se puede seleccionar, no se
 * escribe en la cookie y desaparece en cuanto se pulsa el control una vez.
 *
 * Este archivo es puro a propósito: el ciclo, el mapa de clases y los textos son lo que
 * los tests muerden sin montar nada.
 */

export const TEMAS = ["claro", "oscuro"] as const;

export type Tema = (typeof TEMAS)[number];

/**
 * Lo que se muestra a quien todavía no eligió. `null` y no `"claro"`: fijar un default
 * concreto en el servidor le daría tema claro a quien tiene el SO en oscuro, y sólo se
 * corregiría tras pulsar el control.
 */
export type TemaElegido = Tema | null;

/**
 * Cookie y no `localStorage`: con cookie el SERVIDOR conoce el tema al renderizar y el
 * HTML ya llega con la clase puesta, así que no hay parpadeo POR CONSTRUCCIÓN. Con
 * `localStorage` haría falta un script bloqueante en el `<head>` que corra antes del
 * primer pintado.
 */
export const COOKIE_TEMA = "ordenex_tema";

/** Un año: es una preferencia de presentación, no una sesión. */
export const COOKIE_TEMA_MAX_AGE = 60 * 60 * 24 * 365;

export function esTema(valor: unknown): valor is Tema {
  return typeof valor === "string" && (TEMAS as readonly string[]).includes(valor);
}

/**
 * Un valor ausente, vacío o manipulado a mano NO cae en un tema concreto: cae en «sin
 * elegir», que es exactamente lo mismo que le pasa a quien entra por primera vez. Así una
 * cookie corrupta devuelve al usuario a la preferencia de su sistema en vez de encerrarlo
 * en un tema que nunca pidió.
 *
 * Esto incluye el valor `"sistema"` que escribieron las versiones anteriores: ya no es un
 * tema válido, así que las cookies viejas caducan solas hacia el comportamiento correcto.
 * No hace falta migración.
 */
export function normalizarTema(valor: unknown): TemaElegido {
  return esTema(valor) ? valor : null;
}

/**
 * El otro tema. Con dos estados el control es un INTERRUPTOR, no un ciclo: se ve lo que
 * hay y se va a lo contrario, que es lo único que se puede querer.
 */
export function siguienteTema(tema: Tema): Tema {
  return tema === "oscuro" ? "claro" : "oscuro";
}

/**
 * Clase que se estampa en el envoltorio del portal. Las tres existen en `globals.css`:
 *
 * - `dark` → activa los tokens oscuros y el variant `dark:` de Tailwind.
 * - `tema-claro` → fija los valores claros pase lo que pase (la misma clase que la
 *   feature 208 usa para la landing y las hojas de la factura).
 * - `tema-sistema` → sin elección todavía. No trae tokens propios; sólo bajo
 *   `@media (prefers-color-scheme: dark)` toma los mismos valores que `dark`. Cero JS,
 *   cero cookie, cero parpadeo.
 *
 * El nombre `tema-sistema` se conserva aunque «sistema» ya no sea una opción: describe
 * bien lo que la clase HACE (delegar en el sistema) y renombrarla obligaría a tocar
 * `globals.css`, su guardia de contraste y la landing, sin cambiar ni un píxel.
 */
export function claseDeTema(tema: TemaElegido): string {
  switch (tema) {
    case "oscuro":
      return "dark";
    case "claro":
      return "tema-claro";
    case null:
      return "tema-sistema";
  }
}

/**
 * Textos de UI en un solo sitio: el día que haya i18n se traduce este mapa y estas dos
 * funciones, no se persiguen literales por los componentes.
 */
export const ETIQUETAS_TEMA: Record<Tema, string> = {
  claro: "Claro",
  oscuro: "Oscuro",
};

/**
 * Nombre accesible del control. Dice en cuál estás y a cuál vas, y empieza por la etiqueta
 * visible («Claro»/«Oscuro») para cumplir «Label in Name» (WCAG 2.5.3).
 */
export function etiquetaAccesibleTema(tema: Tema): string {
  return `Tema: ${ETIQUETAS_TEMA[tema]}. Cambiar a ${ETIQUETAS_TEMA[siguienteTema(tema)]}.`;
}

/**
 * Nombre accesible mientras no hay elección. Es el HTML que llega del servidor: no se sabe
 * qué está pintando el CSS, así que prometer un estado concreto sería mentir. Dura hasta
 * que el cliente monta y resuelve (`TemaProvider`), o sea ni un parpadeo de uso real.
 */
export const ETIQUETA_TEMA_SIN_RESOLVER = "Cambiar tema.";

/** Lo que anuncia la región viva cuando el tema YA cambió. */
export function anuncioTema(tema: Tema): string {
  return `Tema ${ETIQUETAS_TEMA[tema].toLowerCase()} activado.`;
}

/**
 * Resuelve «sin elegir» al tema que el navegador está pintando de verdad. Sólo cliente:
 * en el servidor `matchMedia` no existe y no hay nada que consultar.
 *
 * Se usa para que el CONTROL sepa dónde está, no para pintar: lo que se ve ya lo decidió
 * el CSS. Por eso el resultado tampoco se guarda en la cookie — quien no ha elegido sigue
 * sin haber elegido, y si mañana cambia el tema de su sistema, la app le sigue.
 */
export function resolverTemaDelSistema(): Tema {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "claro";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

/**
 * Avisa cuando la preferencia del sistema CAMBIA mientras la pestaña está abierta (macOS y
 * Windows la giran solos al anochecer). Devuelve la función de baja, como pide
 * `useSyncExternalStore`.
 *
 * Sólo afecta a quien no ha elegido: si hay cookie, manda la cookie y esto se ignora.
 */
export function suscribirTemaDelSistema(alCambiar: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  // `addEventListener` y no `addListener`: el segundo está obsoleto. Se comprueba que
  // exista porque algunos navegadores viejos —y varios dobles de test— sólo traen el otro.
  mql.addEventListener?.("change", alCambiar);
  return () => mql.removeEventListener?.("change", alCambiar);
}
