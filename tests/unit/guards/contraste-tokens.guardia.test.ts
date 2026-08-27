import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  componer,
  contraste,
  paleta,
  token,
} from "../../fixtures/contraste";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 210 — GUARDIA de contraste de los tokens semánticos.
 *
 * ── POR QUÉ EXISTE
 * La ficha 210 nació de dos variantes de `Badge` por debajo del umbral AA, y su nota decía «los
 * tests NO ven un color: hay que leerlo en el navegador». Es cierto para el color COMPUESTO en
 * ejecución, y no lo es para los TOKENS: sus valores son literales en `app/globals.css` y el
 * contraste entre dos de ellos es aritmética. Esta guardia convierte en invariante ejecutable lo
 * que hasta hoy vivía en un comentario al lado de cada token — es decir, en nada que falle.
 *
 * Lo que cubre: que ningún par declarado baje del umbral. Lo que NO cubre, y conviene no
 * olvidarlo: si un componente estrena una pareja de clases que nadie listó aquí, esta guardia no
 * se entera. Cubre los tokens, no los usos.
 *
 * ── DOS TRAMPAS DEL MÉTODO, LAS DOS YA PAGADAS EN ESTE REPO
 * 1. Los comentarios de `globals.css` CONTIENEN hexes (`#b45309`, y los números medidos). Un
 *    parser que no los quite lee valores que no están vigentes. Por eso se usa el quitador
 *    COMPARTIDO (`quitarComentarios`), no uno propio: es la ficha 209.
 * 2. Una fórmula de contraste mal escrita da una tabla entera de números plausibles e
 *    inventados; pasó el 2026-08-12 con `lab()` parseado como `rgb`. Por eso el primer bloque de
 *    este archivo NO mide tokens: reproduce tres contrastes PUBLICADOS por WCAG, y si falla, todo
 *    lo que viene después no vale nada.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Umbral AA para texto normal (WCAG 2.1, criterio 1.4.3). */
const AA_TEXTO = 4.5;

/**
 * SUELO POR PAR: el contraste MEDIDO hoy, que ningún cambio de token puede empeorar.
 *
 * ── Por qué no basta con AA
 * `--warning-strong` valía `#b45309` y daba exactamente **4.51** sobre su `-soft`. Eso PASA el
 * umbral —por una centésima— así que una guardia que solo comprobara `>= 4.5` habría dejado
 * revertir esta ficha sin poner nada en rojo. La 210 existe precisamente porque aprobar por una
 * centésima no es aprobar.
 *
 * ── Cómo se mantiene
 * Si cambias un token a mejor, este suelo FALLA y hay que subirlo a mano. Es deliberado: obliga a
 * mirar el número nuevo en vez de confiar en que «se ve bien». Si falla a peor, es una regresión.
 *
 * `success` se queda con su 4.84 como suelo y NO se toca en esta ficha: no está en su alcance,
 * pero tampoco puede caer en silencio.
 */
const SUELO: Record<string, number> = {
  "claro:success": 4.84,
  "claro:warning": 6.37,
  "claro:danger": 5.3,
  "claro:info": 6.16,
  "oscuro:success": 6.6,
  "oscuro:warning": 7.59,
  "oscuro:danger": 5.2,
  "oscuro:info": 6.97,
  // Feature 292 — los cuatro pares de `--chart-*`, medidos al crearlos.
  "claro:chart-6": 5.98,
  "claro:chart-11": 6.38,
  "claro:chart-12": 9.45,
  "claro:chart-13": 8.49,
  "oscuro:chart-6": 6.91,
  "oscuro:chart-11": 7.02,
  "oscuro:chart-12": 8.45,
  "oscuro:chart-13": 6.48,
};

/** Tolerancia del suelo: absorbe el redondeo a dos decimales, nada más. */
const EPSILON = 0.01;

// ─────────────────────────────────────────────────────────────────────────────────────────

describe("Feature 210 — contraste de los tokens semánticos (guardia)", () => {
  // ── El bloque que valida la HERRAMIENTA. Si esto falla, lo de abajo no significa nada. ──
  it("la fórmula de contraste reproduce tres razones publicadas por WCAG", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contraste("#ffffff", "#ffffff")).toBeCloseTo(1, 2);
    // El gris límite clásico de AA sobre blanco.
    expect(contraste("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("la composición alfa reproduce los dos extremos conocidos", () => {
    expect(componer("#ff0000", "#ffffff", 1)).toBe("#ff0000");
    expect(componer("#ff0000", "#ffffff", 0)).toBe("#ffffff");
  });

  it("el parser lee el token vigente y NO un hex que viva en un comentario", () => {
    // El comentario de la 210 nombra `#b45309`, el valor ANTERIOR. Si el quitador de comentarios
    // fallara, este test cazaría exactamente ese falso positivo.
    expect(token("claro", "warning-strong")).not.toBe("#b45309");
    expect(token("claro", "warning-strong")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  // ── TEMA CLARO: el par es token contra token (`-strong` sobre `-soft`). ──
  const PARES_CLARO = ["success", "warning", "danger", "info"] as const;

  it.each(PARES_CLARO)(
    "tema claro: --%s-strong sobre --color-%s-soft cumple AA para texto",
    (familia) => {
      const fg = token("claro", `${familia}-strong`);
      const bg = paleta(`${familia}-soft`);
      const medido = contraste(fg, bg);
      expect(medido).toBeGreaterThanOrEqual(AA_TEXTO);
      // El suelo: ningún cambio de token puede EMPEORAR lo que ya está medido.
      expect(medido).toBeGreaterThanOrEqual(SUELO[`claro:${familia}`] - EPSILON);
    },
  );

  // ── TEMA OSCURO: no hay `-soft`; el fondo es `<familia>/15` compuesto sobre la tarjeta. ──
  const ALPHA_SOFT_BADGE_OSCURO = 0.15;

  it.each(PARES_CLARO)(
    "tema oscuro: --%s-strong sobre %s/15 compuesto en la tarjeta cumple AA para texto",
    (familia) => {
      const fg = token("oscuro", `${familia}-strong`);
      const base = paleta(familia); // --color-success/--color-warning/...: sin variante por tema
      const card = token("oscuro", "card");
      const medido = contraste(fg, componer(base, card, ALPHA_SOFT_BADGE_OSCURO));
      expect(medido).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(medido).toBeGreaterThanOrEqual(SUELO[`oscuro:${familia}`] - EPSILON);
    },
  );

  /**
   * La regresión que esta ficha cierra, atornillada: la variante `destructive` del `Badge` pintaba
   * `text-destructive` sobre `bg-destructive/10`, el mismo color como texto y como fondo al 10%.
   * Medido: 3.29:1 en claro y 4.43:1 en oscuro. No se arregla con un token porque `--destructive`
   * no tiene `-strong`, así que la variante pasa a usar el par de `danger`.
   *
   * Lo que este caso vigila es que NO VUELVA a colgarse de `--destructive`. Copiar la variante de
   * shadcn otra vez —el gesto más natural del mundo al actualizar un componente— reintroduce
   * exactamente el 3.29:1.
   *
   * ⚠️ Se comprueba el par de CLASES, no la ausencia del nombre. La primera versión de esta
   * guardia exigía que la clave `destructive:` no existiera, y con ella se retiró la variante:
   * `typecheck` destapó NUEVE consumidores más que no escriben el literal en el JSX, sino que lo
   * calculan desde un mapa de estados. El censo textual no podía verlos.
   */
  it("la variante `destructive` del Badge NO usa el token sin par, sino el de `danger`", () => {
    const badge = quitarComentarios(
      readFileSync(path.join(RAIZ, "components", "ui", "badge.tsx"), "utf8"),
    );
    const linea = badge.match(/destructive:\s*"([^"]*)"/);
    expect(linea, "la variante `destructive` desapareció del Badge").not.toBeNull();
    const clases = linea?.[1] ?? "";
    expect(clases).toContain("text-danger-strong");
    expect(clases).toContain("bg-danger-soft");
    // Ni el texto ni el fondo pueden volver a salir de `--destructive`.
    expect(clases).not.toMatch(/text-destructive|bg-destructive/);
  });

  it("el par que sustituye a `destructive` cumple AA en los DOS temas", () => {
    const claro = contraste(token("claro", "danger-strong"), paleta("danger-soft"));
    const oscuro = contraste(
      token("oscuro", "danger-strong"),
      componer(paleta("danger"), token("oscuro", "card"), ALPHA_SOFT_BADGE_OSCURO),
    );
    expect(claro).toBeGreaterThanOrEqual(AA_TEXTO);
    expect(oscuro).toBeGreaterThanOrEqual(AA_TEXTO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Feature 292 — los cuatro pares de `--chart-*`
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Feature 292 — LOS PARES QUE NACEN DE UN COLOR PLANO.
 *
 * Cuatro contadores del tablero del día se pintan en la barra apilada con un `--chart-*`, y su
 * tarjeta iba de otro color: la barra no se podía leer desde las tarjetas. Para que la tarjeta
 * tome el color de SU segmento, esos cuatro `--chart-*` —que eran colores PLANOS— estrenan el par
 * `-soft`/`-strong` que una variante de `Badge` necesita.
 *
 * ── POR QUÉ NO ENTRAN EN EL `it.each` DE ARRIBA, aunque midan lo mismo
 * En tema oscuro, el fondo del `Badge` es `<base>/15` compuesto sobre la tarjeta, y ahí está la
 * diferencia: la base de los semánticos (`--color-success`) es un hex FIJO —vive en `@theme
 * inline` y no gira—, mientras que un `--chart-N` SÍ gira con el tema (`#8b5cf6` claro,
 * `#a78bfa` oscuro). Medir estos cuatro con `paleta()` sería medir el violeta claro sobre el
 * fondo oscuro: números plausibles del par equivocado. Se leen con `token(tema, …)`, que es lo
 * que respeta esa vuelta.
 *
 * El par es AA por decisión, no por suerte: donde el propio color del segmento no llegaba sobre
 * su `-soft` —`chart-6` daba 3.57 y `chart-12` 4.34— la tinta baja dos escalones de LA MISMA
 * rampa en vez de estrenar un tono nuevo.
 */
describe("Feature 292 — contraste de los cuatro pares de `--chart-*` (guardia)", () => {
  const PARES_CHART = ["chart-6", "chart-11", "chart-12", "chart-13"] as const;
  const ALPHA_SOFT_BADGE_OSCURO = 0.15;

  it.each(PARES_CHART)(
    "tema claro: --%s-strong sobre --color-%s-soft cumple AA para texto",
    (familia) => {
      const medido = contraste(token("claro", `${familia}-strong`), paleta(`${familia}-soft`));
      expect(medido).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(medido).toBeGreaterThanOrEqual(SUELO[`claro:${familia}`] - EPSILON);
    },
  );

  it.each(PARES_CHART)(
    "tema oscuro: --%s-strong sobre %s/15 compuesto en la tarjeta cumple AA para texto",
    (familia) => {
      // La base GIRA con el tema: se lee con `token`, no con `paleta` (ver la cabecera).
      const base = token("oscuro", familia);
      const medido = contraste(
        token("oscuro", `${familia}-strong`),
        componer(base, token("oscuro", "card"), ALPHA_SOFT_BADGE_OSCURO),
      );
      expect(medido).toBeGreaterThanOrEqual(AA_TEXTO);
      expect(medido).toBeGreaterThanOrEqual(SUELO[`oscuro:${familia}`] - EPSILON);
    },
  );

  /**
   * La mitad que hace que lo de arriba signifique algo: que sea el `Badge` quien use ESE par.
   * Cuatro tokens con un contraste impecable que nadie monta no arreglan ninguna pantalla, y un
   * `dark:` que se quedara fuera es el bug de tema oscuro más repetido del repo.
   */
  it.each(PARES_CHART)("la variante `%s` del Badge monta el par completo, con su `dark:`", (familia) => {
    const badge = quitarComentarios(
      readFileSync(path.join(RAIZ, "components", "ui", "badge.tsx"), "utf8"),
    );
    const variante = familia.replace("-", ""); // `chart-6` -> `chart6`
    const linea = badge.match(new RegExp(`\\b${variante}:\\s*"([^"]*)"`));
    expect(linea, `la variante \`${variante}\` no existe en el Badge`).not.toBeNull();

    const clases = linea?.[1] ?? "";
    expect(clases).toContain(`bg-${familia}-soft`);
    expect(clases).toContain(`text-${familia}-strong`);
    expect(
      clases,
      "sin `dark:bg-<base>/15` la tarjeta se queda con el `-soft` CLARO en tema oscuro: tinta " +
        "clara sobre fondo clarísimo",
    ).toContain(`dark:bg-${familia}/15`);
  });

  it("los cuatro `-soft` existen como token propio y NO son el color plano de su serie", () => {
    for (const familia of PARES_CHART) {
      const soft = paleta(`${familia}-soft`);
      expect(soft).toMatch(/^#[0-9a-f]{6}$/i);
      // Si el `-soft` fuera el mismo hex que el acento, el par sería el color sobre sí mismo:
      // exactamente el 3.29:1 de la 210.
      expect(soft).not.toBe(token("claro", familia));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Feature 222 — la variante `destructive` del BOTÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * La 210 arregló el `Badge` y dejó el `Button` fuera de su alcance, con el defecto medido y
 * escrito: `text-destructive` sobre `bg-destructive/10` — el mismo color como tinta y como fondo
 * al 10 % — daba 3.29 en claro y 4.43 en oscuro, bajo el 4.5 de AA en los DOS temas. Y con el
 * cursor encima bajaba a 2.90 y 3.68, porque el fondo se hunde hacia la propia tinta.
 *
 * Esta guardia ata el par nuevo. Tres cosas la separan de un test que sólo mira clases:
 *
 *  1. **Mide los CUATRO estados**: reposo y hover, en los dos temas. Un par que cumple quieto y
 *     falla al pasar el ratón sigue siendo un fallo, y es exactamente cómo se le escapó a la 208.
 *  2. **Mide sobre VARIAS superficies.** El `Button` es una primitiva: no sabe dónde lo montan. Un
 *     fondo con alfa (`bg-danger/15`) vale lo que valga lo que tenga debajo — medido, el mismo
 *     `danger/20` da 4.99 sobre la tarjeta y 4.44 sobre `secondary`. Medir sólo sobre `card` es
 *     suponer el resto.
 *  3. **Lee las clases REALES del componente** y resuelve cada utilidad contra los tokens de
 *     `app/globals.css`. No hay una copia de las clases aquí: si alguien cambia el alfa o vuelve a
 *     `--destructive`, esta guardia mide lo nuevo y se pone roja sola.
 */

const BOTON = path.join(RAIZ, "components", "ui", "button.tsx");
/** El fuente TAL CUAL. Sólo para las autocomprobaciones del censo. */
const botonCrudo = readFileSync(BOTON, "utf8");
/**
 * El CÓDIGO del botón, con la prosa fuera (quitador COMPARTIDO, feature 209). No es un adorno:
 * el comentario de esa variante NOMBRA `text-destructive` y `bg-destructive/10` para explicar qué
 * se arregló. Un censo sobre el texto crudo denunciaría la explicación y obligaría a borrarla.
 */
const boton = quitarComentarios(botonCrudo);

/** Las clases de una variante de `cva`, tal como se escriben en el componente. */
function clasesDeVariante(fuente: string, variante: string): string {
  // El lookbehind evita enganchar un `…-destructive:` de otra utilidad; se exige el nombre suelto
  // como clave del objeto de variantes.
  const m = fuente.match(new RegExp(`(?<![\\w:-])${variante}:\\s*"([^"]*)"`));
  if (!m) {
    throw new Error(
      `la variante \`${variante}\` desapareció del componente, o dejó de escribirse como una ` +
        "cadena literal. Fallar es lo correcto: sin sus clases, esta guardia no mide nada y " +
        "pasaría en verde sin haber mirado.",
    );
  }
  return m[1];
}

const CLASES_DESTRUCTIVE = clasesDeVariante(boton, "destructive");

/**
 * Las superficies sobre las que el portal monta un botón. Se declaran con nombre porque son EL
 * supuesto de toda medición con alfa: cambiar esta lista cambia los números.
 */
function superficiesDe(tema: "claro" | "oscuro"): { nombre: string; hex: string }[] {
  return [
    { nombre: "card", hex: token(tema, "card") },
    { nombre: "popover (diálogos)", hex: token(tema, "popover") },
    { nombre: "background (la página)", hex: token(tema, "background") },
    { nombre: "muted (paneles apagados)", hex: token(tema, "muted") },
    { nombre: "secondary", hex: token(tema, "secondary") },
    {
      nombre: "muted/50 sobre card (fila de tabla en hover)",
      hex: componer(token(tema, "muted"), token(tema, "card"), 0.5),
    },
  ];
}

/**
 * El hex de una utilidad (`bg-danger-soft`, `text-card`, `dark:bg-danger/15`) en un tema y sobre
 * una superficie. `token()` primero y `paleta()` después, que es el orden real: los tokens con
 * variante por tema viven en `:root`/`.dark` y los de paleta, una sola vez, en `@theme inline`.
 */
function hexDeUtilidad(utilidad: string, tema: "claro" | "oscuro", superficie: string): string {
  const sinVariantes = utilidad.replace(/^(?:[a-z-]+:)*/, "");
  const m = sinVariantes.match(/^(?:bg|text)-([a-z][a-z0-9-]*)(?:\/(\d+))?$/);
  if (!m) {
    throw new Error(
      `\`${utilidad}\` no es una utilidad de color que esta guardia sepa resolver. Fallar es lo ` +
        "correcto: adivinar el hex es cómo se producen tablas de números plausibles y falsos.",
    );
  }
  const [, nombre, porcentaje] = m;
  let base: string;
  try {
    base = token(tema, nombre);
  } catch {
    base = paleta(nombre); // lanza con su propio mensaje si tampoco existe
  }
  return porcentaje ? componer(base, superficie, Number(porcentaje) / 100) : base;
}

/**
 * Qué clase gana en cada estado, por ESPECIFICIDAD, que es como lo resuelve el navegador:
 * `dark:hover:` (tres clases) > `dark:` = `hover:` (dos) > la base (una).
 *
 * El empate NO se resuelve adivinando: si hay `hover:bg-*` y `dark:bg-*` pero no `dark:hover:bg-*`,
 * en tema oscuro las dos reglas empatan y decide el orden del CSS compilado — que esta guardia no
 * ve. Ahí lanza en vez de elegir una. Es un defecto real del componente, no de la medición.
 */
function utilidadQueGana(
  clases: string[],
  propiedad: "bg" | "text",
  tema: "claro" | "oscuro",
  estado: "reposo" | "hover",
): string {
  const con = (prefijo: string) =>
    clases.find((c) => c.startsWith(prefijo) && c.slice(prefijo.length).startsWith(`${propiedad}-`));
  const base = con("");
  const hover = con("hover:");
  const oscuroBase = con("dark:");
  const oscuroHover = con("dark:hover:");

  if (tema === "claro") {
    const ganadora = estado === "hover" ? (hover ?? base) : base;
    if (!ganadora) throw new Error(`la variante no declara ningún \`${propiedad}-\` en claro`);
    return ganadora;
  }
  if (estado === "reposo") {
    const ganadora = oscuroBase ?? base;
    if (!ganadora) throw new Error(`la variante no declara ningún \`${propiedad}-\` en oscuro`);
    return ganadora;
  }
  if (oscuroHover) return oscuroHover;
  if (hover && oscuroBase) {
    throw new Error(
      `EMPATE DE ESPECIFICIDAD en tema oscuro: \`${hover}\` y \`${oscuroBase}\` valen lo mismo ` +
        "(dos clases cada una) y el desempate sería el orden del CSS compilado. Escribí también " +
        `la variante \`dark:hover:\` de \`${propiedad}-\` y el hover gana siempre.`,
    );
  }
  return hover ?? oscuroBase ?? utilidadQueGana(clases, propiedad, "oscuro", "reposo");
}

/**
 * SUELO por (tema, estado): el PEOR de los medidos sobre las superficies declaradas, el
 * 2026-08-13, con la aritmética de `tests/fixtures/contraste.ts`.
 *
 *   claro  · reposo #b91c1c sobre #fee2e2 (opaco)                 5.30 en las seis superficies
 *   claro  · hover  #ffffff sobre #b91c1c (opaco)                 6.47 en las seis
 *   oscuro · reposo #f87171 sobre danger/15 compuesto             4.65 (muted/secondary) … 5.82
 *   oscuro · hover  #10203a sobre #f87171 (opaco)                 5.89 en las seis
 *
 * Tres de los cuatro estados son OPACOS y por eso no dependen de la superficie. El único que sí
 * es el reposo oscuro, que es el par que la 210 ya midió para el `Badge` (5.20 sobre la tarjeta).
 */
const SUELO_BOTON: Record<string, number> = {
  "claro:reposo": 5.3,
  "claro:hover": 6.47,
  "oscuro:reposo": 4.65,
  "oscuro:hover": 5.89,
};

describe("Feature 222 — el botón `destructive` cumple AA en reposo y en hover (guardia)", () => {
  /**
   * Autocomprobación del censo. Sin esto, una ruta mal resuelta o una variante renombrada dejaría
   * a los casos de abajo midiendo una cadena vacía, en verde y sin haber mirado nada.
   */
  it("el censo lee el CÓDIGO del botón —no su prosa— y encuentra la variante", () => {
    expect(boton.length).toBeGreaterThan(1000);
    expect(boton).toContain("const buttonVariants = cva(");
    expect(CLASES_DESTRUCTIVE.length).toBeGreaterThan(40);

    // Que lo censado es CÓDIGO: el comentario de esa variante nombra a propósito las clases
    // viejas para explicar qué se arregló. Si el quitador dejara de pasar, el caso de abajo se
    // pondría rojo por la EXPLICACIÓN y habría que borrarla para pasar (feature 209).
    expect(botonCrudo).toMatch(/Feature 222/);
    expect(botonCrudo, "el comentario dejó de nombrar el defecto que arregla").toMatch(
      /bg-destructive\/10/,
    );
    expect(boton, "el quitador de comentarios no está pasando: se está censando prosa").not.toMatch(
      /Feature 222/,
    );
  });

  /**
   * El mismo caso que la 210 dejó para el `Badge`, ahora para el `Button`: lo que no puede volver
   * es el par colgado de `--destructive`. Copiar la variante de shadcn al actualizar el componente
   * —el gesto más natural del mundo— reintroduce exactamente el 3.29.
   *
   * ⚠️ Se prohíben `bg-` y `text-`, NO el nombre del token. El borde y el anillo de foco siguen
   * en `--destructive` a propósito: son indicadores no textuales (WCAG 1.4.11), no caen bajo el
   * 1.4.3 que esta ficha cumple, y son los mismos que la clase base usa para `aria-invalid`.
   */
  it("la variante `destructive` del Button NO usa el token sin par, sino el de `danger`", () => {
    expect(CLASES_DESTRUCTIVE).toContain("bg-danger-soft");
    expect(CLASES_DESTRUCTIVE).toContain("text-danger-strong");
    expect(
      CLASES_DESTRUCTIVE,
      "el fondo o la tinta volvieron a `--destructive`, que no tiene `-strong`: es el mismo color " +
        "como texto y como fondo, y mide 3.29 en claro y 4.43 en oscuro",
    ).not.toMatch(/(?:^|\s)(?:[a-z-]+:)*(?:bg|text)-destructive\b/);
  });

  /** «No midas sólo el reposo»: si el hover desaparece, el estado deja de estar vigilado. */
  it("la variante declara un hover propio: el fondo cambia con el cursor y hay que medirlo", () => {
    const clases = CLASES_DESTRUCTIVE.split(/\s+/);
    expect(
      clases.filter((c) => /^hover:bg-/.test(c)),
      "sin `hover:bg-*` no hay estado hover que medir. Si el hover se retira de verdad, este caso " +
        "y los suelos de hover se actualizan A MANO; lo que no puede es desaparecer en silencio.",
    ).not.toEqual([]);
    expect(clases.filter((c) => /^dark:hover:bg-/.test(c))).not.toEqual([]);
  });

  const ESTADOS = [
    ["claro", "reposo"],
    ["claro", "hover"],
    ["oscuro", "reposo"],
    ["oscuro", "hover"],
  ] as const;

  /**
   * QUÉ PAR SE ESTÁ MIDIENDO, escrito. Los números de abajo son correctos sólo si el resolutor
   * eligió las clases que de verdad ganan en cada estado; un resolutor que se equivoque —que mida
   * el reposo creyendo que mide el hover— devuelve un número plausible y falso, en verde. Aquí
   * queda fijado y a la vista.
   */
  it("el resolutor elige, en cada estado, la clase que gana por especificidad", () => {
    const clases = CLASES_DESTRUCTIVE.split(/\s+/);
    expect(
      ESTADOS.map(
        ([tema, estado]) =>
          `${tema}/${estado}: ${utilidadQueGana(clases, "text", tema, estado)} sobre ` +
          `${utilidadQueGana(clases, "bg", tema, estado)}`,
      ),
    ).toEqual([
      "claro/reposo: text-danger-strong sobre bg-danger-soft",
      "claro/hover: hover:text-card sobre hover:bg-danger-strong",
      "oscuro/reposo: text-danger-strong sobre dark:bg-danger/15",
      "oscuro/hover: hover:text-card sobre dark:hover:bg-danger-strong",
    ]);
  });

  it.each(ESTADOS)(
    "tema %s, estado %s: cumple AA en TODAS las superficies declaradas, y no baja del suelo",
    (tema, estado) => {
      const clases = CLASES_DESTRUCTIVE.split(/\s+/);
      const utilFondo = utilidadQueGana(clases, "bg", tema, estado);
      const utilTinta = utilidadQueGana(clases, "text", tema, estado);

      const medidos = superficiesDe(tema).map((superficie) => {
        const fondo = hexDeUtilidad(utilFondo, tema, superficie.hex);
        const tinta = hexDeUtilidad(utilTinta, tema, superficie.hex);
        return { superficie, tinta, fondo, medido: contraste(tinta, fondo) };
      });

      for (const { superficie, tinta, fondo, medido } of medidos) {
        expect(
          medido,
          `${tema}/${estado} sobre ${superficie.nombre}: \`${utilTinta}\` (${tinta}) sobre ` +
            `\`${utilFondo}\` (${fondo}) mide ${medido.toFixed(2)}, y AA para texto normal pide ` +
            `${AA_TEXTO}. Es el defecto que la feature 222 vino a cerrar.`,
        ).toBeGreaterThanOrEqual(AA_TEXTO);
      }

      const peor = Math.min(...medidos.map((m) => m.medido));
      expect(
        peor,
        `${tema}/${estado} EMPEORÓ: el peor de las seis superficies medía ` +
          `${SUELO_BOTON[`${tema}:${estado}`]} al cerrar la 222. Aprobar por una centésima no es ` +
          "aprobar (lección de la 210): si el cambio es a mejor, sube el suelo A MANO.",
      ).toBeGreaterThanOrEqual(SUELO_BOTON[`${tema}:${estado}`] - EPSILON);
    },
  );

  /**
   * POR QUÉ EL HOVER ES OPACO, con el número de la alternativa descartada en vez de en prosa.
   *
   * Lo natural era hundir el tinte —`hover:bg-danger/20`, que es lo que hacía la variante vieja
   * con `--destructive`—. Sobre la tarjeta mide 4.99 y habría pasado; sobre `secondary` mide 4.44
   * y sobre el `muted` oscuro, 4.44. Un fondo con alfa vale lo que valga lo que tenga debajo, y
   * una primitiva no sabe dónde la montan.
   *
   * Si algún día la paleta cambia y esa alternativa pasa a cumplir en todas partes, este caso se
   * pone rojo: el motivo por el que el hover es opaco habría dejado de ser cierto y la decisión
   * hay que releerla, no heredarla.
   */
  it("la alternativa descartada (hover con capa `danger/20`) sigue sin cumplir: por eso es opaco", () => {
    const caidas = (["claro", "oscuro"] as const).flatMap((tema) =>
      superficiesDe(tema)
        .map((superficie) => ({
          donde: `${tema}/${superficie.nombre}`,
          medido: contraste(token(tema, "danger-strong"), componer(paleta("danger"), superficie.hex, 0.2)),
        }))
        .filter((m) => m.medido < AA_TEXTO),
    );

    expect(
      caidas.map((c) => c.donde),
      "ninguna superficie hace caer ya a `danger/20`: el argumento por el que el hover se pintó " +
        "opaco caducó y hay que releer la decisión con los números nuevos.",
    ).toEqual([
      "claro/secondary",
      "oscuro/muted (paneles apagados)",
      "oscuro/secondary",
    ]);
  });
});
