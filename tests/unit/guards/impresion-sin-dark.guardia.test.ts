import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { componer, contraste, paleta, token } from "../../fixtures/contraste";
// Feature 223 (R24/R32): el localizador POR CONTENIDO vive en el fixture compartido, para que las
// dos guardias que localizan el bloque de la 217 no tengan dos ideas distintas de dónde está.
import { atReglaQueContiene } from "../../fixtures/css-reglas";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 221 — GUARDIA de «al imprimir, el variant `dark:` no dispara».
 *
 * ── QUÉ VIGILA
 *  1. **La estructura**: que las DOS ramas de `@custom-variant dark` estén envueltas en
 *     `@media not print`. Es la única pieza que hace el trabajo, y se puede quitar sin que se
 *     rompa nada más: el CSS sigue compilando, la app se ve idéntica en pantalla y el síntoma sólo
 *     aparece en una hoja de papel, que ninguna pieza del gate imprime.
 *  2. **La contención**: que dentro de ese `@media not print` no se declare ningún token, porque el
 *     lector de tokens de pantalla (`quitarBloquesDeImpresion`) borra ese bloque antes de leer.
 *  3. **Los números**: lo que la regla compra y lo que NO, medido con la aritmética canónica y
 *     atado al comentario que va junto a la regla, para que la prosa no pueda separarse del dato.
 *
 * ── LO QUE NO AFIRMA
 * Nada de aquí dice «se imprime bien». No hay navegador ni impresora: se lee la estructura del CSS
 * y se mide la aritmética de los pares (tinta, fondo) que esa estructura selecciona. Lo que sí se
 * comprobó UNA vez, a mano y fuera del gate, es que Tailwind 4.3.2 compila este variant como se
 * espera: cada `.dark\:*` sale envuelta en `@media not print { … }` con las dos ramas dentro.
 */

const GLOBALS = "app/globals.css";
const RAIZ = path.resolve(__dirname, "../../..");

/** El CÓDIGO del CSS, con la prosa fuera (quitador compartido, feature 209). */
const css = codigoSinComentarios(GLOBALS);
/** El fuente TAL CUAL. Sólo para el caso que exige que el comentario diga los números medidos. */
const crudo = readFileSync(path.join(RAIZ, GLOBALS), "utf8");

/** El bloque `@custom-variant dark { … }` completo, con sus llaves. */
function bloqueDelVariant(fuente: string): string {
  const inicio = fuente.indexOf("@custom-variant dark");
  if (inicio < 0) {
    throw new Error(
      "no hay `@custom-variant dark` en el CÓDIGO de app/globals.css. O el variant se movió, o " +
        "este censo dejó de saber dónde mirar: fallar es lo correcto, no seguir en verde.",
    );
  }
  let hondura = 0;
  for (let i = fuente.indexOf("{", inicio); i < fuente.length; i += 1) {
    if (fuente[i] === "{") hondura += 1;
    else if (fuente[i] === "}") {
      hondura -= 1;
      if (hondura === 0) return fuente.slice(inicio, i + 1);
    }
  }
  throw new Error("el bloque `@custom-variant dark` no cierra en app/globals.css");
}

/**
 * Para cada `@slot` del bloque, la PILA de preludes que lo envuelve, de fuera a dentro.
 *
 * Se mira la pila y no una mención suelta A PROPÓSITO: un `@media not print` escrito en cualquier
 * otro punto del archivo —o envolviendo sólo una de las dos ramas— satisface a un `includes()` y
 * deja el bug vivo. Las dos mutaciones inocuas de esta ficha son exactamente ésas.
 */
function ancestrosDeCadaSlot(bloque: string): string[][] {
  const salida: string[][] = [];
  const pila: string[] = [];
  let marca = 0;
  for (let i = 0; i < bloque.length; i += 1) {
    const c = bloque[i];
    if (c === "{") {
      pila.push(bloque.slice(marca, i).trim().replace(/\s+/g, " "));
      marca = i + 1;
    } else if (c === "}") {
      pila.pop();
      marca = i + 1;
    } else if (c === ";") {
      if (bloque.slice(marca, i).trim() === "@slot") salida.push([...pila]);
      marca = i + 1;
    }
  }
  return salida;
}

/** Los cuerpos de todas las at-rules `@media not print { … }` del archivo. */
function cuerposDeNotPrint(fuente: string): string[] {
  const apertura = /@media\s+not\s+print\s*\{/g;
  const cuerpos: string[] = [];
  for (let m = apertura.exec(fuente); m; m = apertura.exec(fuente)) {
    const abre = m.index + m[0].length - 1;
    let hondura = 0;
    let i = abre;
    for (; i < fuente.length; i += 1) {
      if (fuente[i] === "{") hondura += 1;
      else if (fuente[i] === "}") {
        hondura -= 1;
        if (hondura === 0) break;
      }
    }
    cuerpos.push(fuente.slice(abre + 1, i));
    apertura.lastIndex = i + 1;
  }
  return cuerpos;
}

const variant = bloqueDelVariant(css);
const slots = ancestrosDeCadaSlot(variant);

const ES_NOT_PRINT = /^@media\s+not\s+print$/;

describe("feature 221 — el variant `dark:` no emite en papel", () => {
  /**
   * Autocomprobación del censo. Sin esto, una ruta mal resuelta o un parser que deje de encontrar
   * los `@slot` reportaría CERO infractores y pasaría en verde sin haber mirado nada.
   */
  it("el censo lee el CÓDIGO del variant, no su prosa, y encuentra sus dos ramas", () => {
    expect(css.length).toBeGreaterThan(5000);
    expect(variant).toContain("&:is(.dark *)");
    expect(variant).toContain("&:is(.tema-sistema *)");
    expect(variant.match(/@slot/g) ?? []).toHaveLength(2);
    expect(slots).toHaveLength(2);

    // Que lo que se está censando es CÓDIGO: el comentario que documenta esta regla vive dentro
    // del bloque y nombra `@media not print` en prosa. Si el quitador dejara de pasar, el caso de
    // abajo se satisfaría con la explicación en vez de con la regla.
    expect(crudo).toMatch(/Feature 221/);
    expect(variant, "el quitador de comentarios no está pasando: se está censando prosa").not.toMatch(
      /Feature 221/i,
    );
  });

  /**
   * EL caso. Lo que esta ficha compra cabe aquí: ninguna rama del variant puede emitir en papel.
   *
   * MUERDE, comprobado plantando las mutaciones (2026-08-13):
   *  · quitar el `@media not print` → rojo, los dos `@slot` sin envoltorio.
   *  · envolver SÓLO la rama de `prefers-color-scheme` → rojo por el `@slot` de la rama por clase,
   *    que es justo la que la ficha viene a apagar (`.dark` explícito).
   *  · añadir un `@media not print` vacío en otro punto del archivo y dejar el variant como estaba
   *    → rojo. Un censo que buscara la MENCIÓN habría dado verde; ésta mira la pila de ancestros
   *    de cada `@slot`, y una regla que no envuelve nada no envuelve nada.
   */
  it("las DOS ramas del variant viven dentro de `@media not print`", () => {
    slots.forEach((pila, n) => {
      expect(
        pila.some((prelude) => ES_NOT_PRINT.test(prelude)),
        `el @slot nº ${n + 1} del variant \`dark\` NO está dentro de un \`@media not print\` ` +
          `(sus ancestros son: ${pila.join(" › ") || "ninguno"}). Sin ese envoltorio, las ` +
          "utilidades `dark:` vuelven a emitir dentro de `@media print`: quien imprima desde tema " +
          "oscuro sacará insignias y botones con su tinte oscuro sobre papel blanco.",
      ).toBe(true);
    });
  });

  /**
   * La contención que hace inocuo al lector de tokens. `quitarBloquesDeImpresion()` borra TODA
   * at-rule que nombre `print` —incluida ésta, que en realidad sólo aplica en PANTALLA— antes de
   * leer los tokens. Mientras aquí dentro no se declare ningún token, ese borrado no cambia nada.
   * El día que se declare uno, desaparecería del lector y las medidas de tema oscuro pasarían a
   * medir otra cosa, en verde. Esto lo convierte en rojo.
   */
  it("dentro de `@media not print` no se declara NINGÚN token", () => {
    const cuerpos = cuerposDeNotPrint(css);
    expect(cuerpos.length, "no se encontró ningún `@media not print`: el censo mide una cadena vacía")
      .toBeGreaterThan(0);
    for (const cuerpo of cuerpos) {
      expect(
        cuerpo.match(/--[a-z0-9-]+\s*:/gi) ?? [],
        "un token declarado bajo `@media not print` se lo come `quitarBloquesDeImpresion()`: el " +
          "lector de tokens de pantalla dejaría de verlo y mediría el tema equivocado EN VERDE. " +
          "Si de verdad hace falta, primero hay que afinar esa pasada (`tests/fixtures/contraste.ts`).",
      ).toEqual([]);
    }
  });

  /**
   * Por qué la guardia de la 217 tuvo que dejar de anclar por POSICIÓN, dicho aquí y comprobable.
   *
   * La historia, en tres pasos, y cada uno costó un ancla:
   *
   *  1. La 217 localizaba su regla con «la primera at-rule que MENCIONE `print`». Con una sola en
   *     el archivo, era exacto.
   *  2. Esta ficha (221) añadió `@media not print` 200 líneas MÁS ARRIBA y aquel ancla pasó a
   *     enganchar este bloque: los casos de la 217 seguían verdes mirando lo que no era. Se afinó
   *     a «`print` pegado al `@media`» — que seguía siendo posicional.
   *  3. La 223 añade un SEGUNDO `@media print`. «El primero» vuelve a ser un ancla que mueve
   *     cualquiera con sólo escribir su bloque delante.
   *
   * Por eso el ancla es ahora de CONTENIDO: el bloque de la 217 es «el que contiene la regla que
   * declara los tokens de `.papel-al-imprimir`» (`tests/fixtures/css-reglas.ts`). Este caso
   * conserva su punto —las dos at-rules viejas siguen enganchando lo que no es— y lo mide contra
   * el bloque localizado de verdad, no contra el primero que aparezca.
   */
  it("el ancla vieja («cualquier at-rule con `print`») engancharía ESTE bloque, no el de la 217", () => {
    // Sin `^\s*`: ese prefijo hacía que el índice cayera en el salto de línea ANTERIOR al `@`,
    // así que cuando las dos anclas enganchaban el MISMO bloque `vieja` salía 1-2 caracteres por
    // delante de `precisa` y el caso pasaba en verde. Medido plantando la mutación (2026-08-14):
    // con el bloque de la 217 movido delante del `@media not print` —justo lo que este caso
    // existe para detectar— seguía verde. Los dos índices apuntan ahora a su `@`.
    const vieja = css.search(/@media\b[^{}]*\bprint\b[^{}]*\{/);
    // Feature 223 (R24): por CONTENIDO. Con `css.search(/@media print/)` este caso seguía verde
    // aunque el bloque de tokens de la 217 se fuera al final del archivo, porque desde la 223 hay
    // otro `@media print` antes que también satisface el patrón.
    const precisa = atReglaQueContiene(css, /^\s*\.papel-al-imprimir\s*\{/m).indice;
    expect(vieja, "no se encontró ninguna at-rule de medio con `print`").toBeGreaterThan(-1);
    expect(precisa, "no se encontró la regla `@media print` de la 217").toBeGreaterThan(-1);
    expect(
      vieja,
      "el ancla vieja ya no engancha este bloque: si los dos bloques cambiaron de orden, hay que " +
        "releer `tema-encendido.guardia.test.ts` — su ancla por contenido existe por esta razón.",
    ).toBeLessThan(precisa);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// LO QUE LA REGLA COMPRA, Y LO QUE NO  ·  medido con `tests/fixtures/contraste.ts`
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Escenario de todas las medidas de aquí abajo: **se imprime desde el tema oscuro elegido a mano**
 * (`.dark`). Antes de esta ficha, las utilidades `dark:` emitían también en papel; después, no.
 *
 * El papel de VERDAD no lleva fondos: los navegadores no imprimen superficies salvo que el usuario
 * marque «gráficos de fondo», que viene desmarcado (es la misma lección sobre la que se apoya la
 * 217). Por eso lo que decide la legibilidad en papel es LA TINTA, y por eso las filas se parten en
 * dos familias que se comportan al revés la una de la otra.
 */
interface FilaPapel {
  id: string;
  que: string;
  /** La tinta que emite el navegador ANTES de esta ficha (rama `dark:`). */
  tintaAntes: string;
  /** La tinta que emite DESPUÉS (rama base, porque el variant ya no dispara). */
  tintaDespues: string;
}

/** Redondeo a dos decimales, que es la precisión con la que se anotan los números en el CSS. */
function medir(tinta: string, fondo: string): number {
  return Number(contraste(tinta, fondo).toFixed(2));
}

const PAPEL = "#ffffff";

/**
 * FAMILIA 1 — la tinta es de PALETA FIJA (`--color-brand-light`, `--color-asfalto-7`, un
 * `color-mix` literal). No tiene variante por tema, así que apagar el variant CAMBIA la tinta y el
 * papel mejora de verdad. Esto es lo que la ficha compra.
 */
const TINTA_FIJA: (FilaPapel & { antes: number; despues: number })[] = [
  {
    id: "F1",
    que: "`Button` variant `brand-outline` (text-brand / dark:text-brand-light)",
    tintaAntes: paleta("brand-light"),
    tintaDespues: paleta("brand"),
    antes: 1.87,
    despues: 3.18,
  },
  {
    id: "F2",
    que: "`EstatusBadge` «en reparto» (text-brand-dark / dark:text-brand-light)",
    tintaAntes: paleta("brand-light"),
    tintaDespues: paleta("brand-dark"),
    antes: 1.87,
    despues: 4.16,
  },
  {
    id: "F3",
    que: "`Toast` success (color-mix 55 % negro / dark: 80 % blanco)",
    tintaAntes: componer(paleta("success"), "#ffffff", 0.8),
    tintaDespues: componer(paleta("success"), "#000000", 0.55),
    antes: 2.13,
    despues: 6.99,
  },
  {
    id: "F4",
    que: "`RankingPodio` tercer puesto (text-asfalto-7 / dark:text-foreground)",
    tintaAntes: token("oscuro", "foreground"),
    tintaDespues: paleta("asfalto-7"),
    antes: 1.19,
    despues: 11.39,
  },
];

describe("feature 221 — en papel, la tinta de PALETA FIJA mejora (y el CSS lo dice)", () => {
  it.each(TINTA_FIJA.map((f) => [f.id, f] as const))(
    "%s mejora sobre papel blanco, y el número sigue siendo el anotado",
    (_id, fila) => {
      const antes = medir(fila.tintaAntes, PAPEL);
      const despues = medir(fila.tintaDespues, PAPEL);

      expect(antes, `${fila.id} — ${fila.que}: la medida de ANTES se movió`).toBe(fila.antes);
      expect(despues, `${fila.id} — ${fila.que}: la medida de DESPUÉS se movió`).toBe(fila.despues);
      expect(
        despues,
        `${fila.id} dejó de ser una mejora en papel: si la paleta cambió, esta ficha ya no compra ` +
          "lo que su comentario dice que compra y hay que reescribirlo",
      ).toBeGreaterThan(antes);

      // La prosa no puede separarse del dato: el comentario que va JUNTO a la regla anota este
      // mismo par. Si alguien actualiza la tabla y no el comentario (o al revés), rojo.
      expect(
        crudo,
        `el comentario de la regla en ${GLOBALS} ya no anota «${fila.antes.toFixed(2)} → ` +
          `${fila.despues.toFixed(2)}» para ${fila.id}. Una explicación que describe números que ` +
          "ya no son manda a quien la lea a decidir sobre datos falsos.",
      ).toContain(`${fila.antes.toFixed(2)} → ${fila.despues.toFixed(2)}`);
    },
  );

  /**
   * FAMILIA 2 — EL LÍMITE, hecho ejecutable. La tinta sale de un TOKEN, y `.dark` no está acotado
   * a pantalla: al imprimir sigue valiendo el hex oscuro. Apagar el variant no toca esa tinta, así
   * que en papel NO cambia nada. Está aquí para que nadie lea la ficha como «el papel ya sale
   * claro»: fuera de `.papel-al-imprimir`, no sale.
   */
  it("LÍMITE: donde la tinta sale de un token, el papel NO cambia (`Badge` success sigue en 1.92)", () => {
    const tinta = token("oscuro", "success-strong");
    expect(medir(tinta, PAPEL)).toBe(1.92);
    expect(
      crudo,
      "el comentario de la regla dejó de declarar su límite con el número medido",
    ).toContain("1.92");
  });
});

/**
 * DENTRO de `.papel-al-imprimir` —las dos hojas del comprobante del cierre— los tokens YA son los
 * claros (feature 217). Ahí, y sólo ahí, apagar el variant COMPLETA el arreglo: lo impreso pasa a
 * ser exactamente el tema claro y deja de depender del tema con el que se mira la pantalla.
 *
 * COMPROBACIÓN CRUZADA, y no es adorno: los tres números de «después» son, a la centésima, los
 * suelos `claro` que dejó otra feature con otra medición en
 * `factura-contraste.guardia.test.ts` (P22 5.30 · P23 14.79 · P26 5.30). Que coincidan es la forma
 * ejecutable de decir «el papel es ahora el tema claro».
 *
 * P22 y P26 dan hoy el MISMO número, y no es una errata: desde la feature 222 el `Button` y el
 * `Badge` destructivos pintan el mismo par de `danger`. Dos filas para dos componentes que ahora
 * comparten par; el día que uno de los dos cambie, sólo se moverá su fila.
 */
const EN_LA_FACTURA = [
  {
    // Feature 222 — esta fila SE REESCRIBIÓ, no se borró. Medía las clases viejas de la variante
    // (`bg-destructive/10` / `dark:bg-destructive/20`, 2.90 → 3.29) y su aritmética es de tokens:
    // habría seguido en VERDE describiendo un componente que ya no existe, que es la forma más
    // silenciosa de mentir de una guardia. Hoy la variante usa el par de `danger`, y lo que esta
    // ficha compra sigue siendo lo mismo: al imprimir dentro de la hoja, manda la rama base.
    id: "P22",
    que: "`Button` variant `destructive` (bg-danger-soft / dark:bg-danger/15)",
    tinta: () => token("claro", "danger-strong"),
    fondoAntes: () => componer(paleta("danger"), token("claro", "card"), 0.15),
    fondoDespues: () => paleta("danger-soft"),
    antes: 5.32,
    despues: 5.3,
  },
  {
    id: "P23",
    que: "`Button` variant `outline` (bg-background / dark:bg-input/30)",
    tinta: () => token("claro", "card-foreground"),
    fondoAntes: () => componer(token("claro", "input"), token("claro", "card"), 0.3),
    fondoDespues: () => token("claro", "background"),
    antes: 14.78,
    despues: 14.79,
  },
  {
    id: "P26",
    que: "`Badge` variant `destructive` (bg-danger-soft / dark:bg-danger/15)",
    tinta: () => token("claro", "danger-strong"),
    fondoAntes: () => componer(paleta("danger"), token("claro", "card"), 0.15),
    fondoDespues: () => paleta("danger-soft"),
    antes: 5.32,
    despues: 5.3,
  },
] as const;

describe("feature 221 — dentro de la hoja del cierre, el papel pasa a ser el tema claro", () => {
  it.each(EN_LA_FACTURA.map((f) => [f.id, f] as const))(
    "%s imprime ya con el par del tema claro",
    (_id, fila) => {
      expect(medir(fila.tinta(), fila.fondoAntes()), `${fila.id} — ${fila.que}: ANTES se movió`).toBe(
        fila.antes,
      );
      expect(
        medir(fila.tinta(), fila.fondoDespues()),
        `${fila.id} — ${fila.que}: DESPUÉS se movió. Este número es además el suelo «claro» de ` +
          "`factura-contraste.guardia.test.ts`: si aquí y allí dejan de coincidir, una de las dos " +
          "mediciones está mintiendo.",
      ).toBe(fila.despues);
    },
  );

  /**
   * EL PRECIO, declarado y medido en vez de descubierto. Si el usuario marca «gráficos de fondo»
   * —desmarcado por defecto—, los cuatro `Badge` semánticos imprimen su fondo `-soft` CLARO bajo
   * una tinta que sigue siendo la OSCURA, y caen muy por debajo de AA. No se arregla aquí: el
   * arreglo es fijar los tokens claros al imprimir fuera de la hoja del cierre, que cambia el
   * papel de las quince rutas del portal y es decisión propia. Queda medido para que la próxima
   * ficha no tenga que redescubrirlo, y rojo si alguien lo mueve sin mirar.
   */
  it("PRECIO declarado: con «gráficos de fondo», los cuatro `Badge` semánticos caen", () => {
    const caidas = (["success", "warning", "danger", "info"] as const).map((familia) => {
      const tinta = token("oscuro", `${familia}-strong`);
      const antes = medir(tinta, componer(paleta(familia), token("oscuro", "card"), 0.15));
      const despues = medir(tinta, paleta(`${familia}-soft`));
      return `${antes.toFixed(2)} → ${despues.toFixed(2)}`;
    });

    expect(caidas).toEqual(["6.60 → 1.70", "7.59 → 1.50", "5.20 → 2.26", "6.97 → 1.91"]);
    for (const caida of caidas) {
      expect(
        crudo,
        `el comentario de la regla ya no declara la caída «${caida}». El precio de esta decisión ` +
          "va escrito junto a ella: un límite que sólo vive en un informe no lo lee nadie.",
      ).toContain(caida);
    }
  });
});
