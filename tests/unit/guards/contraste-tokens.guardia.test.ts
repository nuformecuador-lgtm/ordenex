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
