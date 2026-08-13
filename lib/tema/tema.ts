/**
 * Feature 211 — el tema visual como dato, sin DOM y sin React.
 *
 * Tres estados y no dos (decisión humana): con `claro`/`oscuro` a secas, quien elige una
 * vez queda atrapado fuera de la preferencia de su sistema para siempre. `sistema` es el
 * valor por defecto y NO necesita almacenamiento: lo resuelve `globals.css` con
 * `@media (prefers-color-scheme: dark)` sobre la clase `tema-sistema`.
 *
 * Este archivo es puro a propósito: el ciclo, el mapa de clases y los textos son lo que
 * los tests muerden sin montar nada.
 */

export const TEMAS = ["sistema", "claro", "oscuro"] as const;

export type Tema = (typeof TEMAS)[number];

/** Sin elección previa se respeta el sistema operativo. */
export const TEMA_POR_DEFECTO: Tema = "sistema";

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

/** Un valor ausente, vacío o manipulado a mano cae en el por defecto, no rompe el layout. */
export function normalizarTema(valor: unknown): Tema {
  return esTema(valor) ? valor : TEMA_POR_DEFECTO;
}

/**
 * El ciclo del control: `sistema` → `claro` → `oscuro` → `sistema`. Vuelve a `sistema`
 * a propósito: si el ciclo se saltara el estado por defecto, quien lo pulsa una vez ya
 * no podría volver a delegar en su sistema operativo.
 */
export function siguienteTema(tema: Tema): Tema {
  const i = TEMAS.indexOf(tema);
  return TEMAS[(i + 1) % TEMAS.length]!;
}

/**
 * Clase que se estampa en el envoltorio del portal. Las tres existen en `globals.css`:
 *
 * - `dark` → activa los tokens oscuros y el variant `dark:` de Tailwind.
 * - `tema-claro` → fija los valores claros pase lo que pase (la misma clase que la
 *   feature 208 usa para la landing y las hojas de la factura).
 * - `tema-sistema` → sin tokens propios; sólo bajo `@media (prefers-color-scheme: dark)`
 *   toma los mismos valores que `dark`. Cero JS, cero cookie, cero parpadeo.
 */
export function claseDeTema(tema: Tema): string {
  switch (tema) {
    case "oscuro":
      return "dark";
    case "claro":
      return "tema-claro";
    case "sistema":
      return "tema-sistema";
  }
}

/**
 * Textos de UI en un solo sitio: el día que haya i18n se traduce este mapa y estas dos
 * funciones, no se persiguen literales por los componentes.
 */
export const ETIQUETAS_TEMA: Record<Tema, string> = {
  sistema: "Sistema",
  claro: "Claro",
  oscuro: "Oscuro",
};

/**
 * Nombre accesible del control. Un icono mudo que cicla no comunica NADA con tres
 * estados: hace falta decir en cuál estás y a cuál vas. Empieza por la etiqueta visible
 * («Sistema»/«Claro»/«Oscuro») para cumplir «Label in Name» (WCAG 2.5.3).
 */
export function etiquetaAccesibleTema(tema: Tema): string {
  return `Tema: ${ETIQUETAS_TEMA[tema]}. Cambiar a ${ETIQUETAS_TEMA[siguienteTema(tema)]}.`;
}

/** Lo que anuncia la región viva cuando el tema YA cambió. */
export function anuncioTema(tema: Tema): string {
  return `Tema ${ETIQUETAS_TEMA[tema].toLowerCase()} activado.`;
}
