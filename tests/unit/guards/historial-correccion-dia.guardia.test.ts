import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * ⭑ FEATURE 262 (B24-B29 / F7) — GUARDIA DE LA ENTRADA SIN TRANSICIÓN.
 *
 * **Por qué existe, y esto es lo primero que hay que leer.** `tasks.md` planteaba `B24` como una
 * ROTURA DELIBERADA DEL BUILD: al volver `OrdenHistorialEntradaDTO` una unión discriminada, el
 * componente dejaba de compilar y así la parte de UI «no se podía olvidar». Esa técnica no cabía
 * aquí —el trabajo va en dos tandas y una rama con el build roto no pasa el gate ni se puede
 * mergear—, así que el componente se arregló en la misma tanda. **Esta guardia es lo que ocupa el
 * lugar de aquella rotura**: la rotura impedía que la entrada de corrección NO LLEGARA a la
 * pantalla; esto impide que DESAPAREZCA de ella, que es el mismo agujero por el otro lado y el
 * único que sigue siendo posible.
 *
 * La lectura es ESTÁTICA, sobre el fuente real. Cubre lo que un render no puede afirmar:
 *
 *  - **(a)** el `switch` por `clase` existe y su `default` demuestra exhaustividad (**R42**);
 *  - **(b)** la rama de corrección NO llama a `estatusLabel` (**R39**) — con su anti-vacuidad:
 *    la rama de transición SÍ lo llama, así que el detector está mirando código de verdad;
 *  - **(c)** los dos textos del día salen de la FUENTE ÚNICA y no están copiados (**R18**);
 *  - **(d)** el componente NO ORDENA nada (**R41**, mutación M-aa);
 *  - **(e)** la `key` de la lista antepone la clase (design §14.4);
 *  - **(f)** la deuda de F6 sigue ANOTADA con su motivo, y quitarla es un acto consciente;
 *  - **(g)** los tests de pantalla de esa entrada siguen existiendo — borrar un componente o su
 *    test se lleva por delante la red de features ajenas, y en este repo ya costó una regresión.
 *
 * **Y el detector se auto-prueba (h).** En este repo una guardia estática pasó VERDE con su
 * detector roto: encontraba cero porque no encontraba NADA. Aquí el extractor de ramas se prueba
 * contra respuestas conocidas EN LAS DOS DIRECCIONES antes de creerle nada.
 */

const RAIZ = path.resolve(__dirname, "../../..");

const COMPONENTE = "app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx";
const TEST_DE_PANTALLA = "tests/components/HistorialOrdenTimeline.test.tsx";
const FUENTE_UNICA = "lib/utils/dia-reparto-textos.ts";

function leer(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!existsSync(ruta)) {
    throw new Error(
      `262: falta el archivo censado \`${rel}\`. Esta guardia se detiene en ROJO en vez de dar ` +
        `por buena una lectura vacía: si el código se movió, actualiza el censo — no borres la ` +
        `comprobación.`,
    );
  }
  return readFileSync(ruta, "utf8");
}

/**
 * El código SIN comentarios, conservando el texto en bruto aparte. Hace falta porque la cabecera
 * del propio componente NOMBRA a propósito lo que la rama de corrección tiene prohibido («NO
 * llama a `estatusLabel`»): un barrido sobre el texto crudo denunciaría la EXPLICACIÓN y
 * obligaría a borrarla para pasar la guardia, que es justo al revés de lo que se quiere.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * El cuerpo de una rama `case "<clase>":` del `switch`, hasta el siguiente `case` o el
 * `default`. Devuelve `null` si la rama no está — y que devuelva `null` es información: significa
 * que el `switch` perdió esa clase.
 */
function ramaDelSwitch(codigo: string, clase: string): string | null {
  const inicio = codigo.indexOf(`case "${clase}":`);
  if (inicio === -1) return null;
  const resto = codigo.slice(inicio + `case "${clase}":`.length);
  const corte = resto.search(/\bcase\s+"|\bdefault\s*:/);
  return corte === -1 ? resto : resto.slice(0, corte);
}

const CODIGO = soloCodigo(leer(COMPONENTE));
const CRUDO = leer(COMPONENTE);

/* ============================================================================================ */
/* (0) CONTROL DE NO-VACUIDAD                                                                    */
/* ============================================================================================ */

describe("262 — control de no-vacuidad: la guardia está leyendo el componente de verdad", () => {
  it("el componente existe, tiene contenido y conserva su ancla", () => {
    expect(CRUDO.length, `${COMPONENTE} está vacío`).toBeGreaterThan(1000);
    expect(CRUDO).toContain("export function HistorialOrdenTimeline");
    expect(CODIGO.trim().length, `${COMPONENTE} es todo comentarios`).toBeGreaterThan(500);
  });

  it("las DOS ramas del switch se extraen y no salen vacías", () => {
    for (const clase of ["transicion", "correccion_dia"]) {
      const rama = ramaDelSwitch(CODIGO, clase);
      expect(rama, `el switch perdió la rama \`${clase}\``).not.toBeNull();
      expect((rama ?? "").trim().length, `la rama \`${clase}\` está vacía`).toBeGreaterThan(100);
    }
  });
});

/* ============================================================================================ */
/* (a) R42 — el switch es exhaustivo y lo DEMUESTRA                                              */
/* ============================================================================================ */

describe("262/R42 — el build rompe si la línea de tiempo gana una clase sin rama", () => {
  it("el componente decide por `entrada.clase`, no por la presencia de un campo", () => {
    expect(CODIGO).toMatch(/switch\s*\(\s*entrada\.clase\s*\)/);
    // design §14.1, punto 2: `"fechaNuevaISO" in entrada` dejaría caer una tercera clase futura
    // en el `else` sin que nada se enterase.
    expect(CODIGO).not.toMatch(/\bin\s+entrada\b/);
  });

  it("el `default` fuerza el `never`: una clase sin rama NO compila", () => {
    const codigo = CODIGO;
    const defecto = codigo.slice(codigo.search(/\bdefault\s*:/));
    expect(defecto).toMatch(/:\s*never\s*=\s*entrada/);
  });
});

/* ============================================================================================ */
/* (b) R39 — la corrección no se pinta como una transición                                       */
/* ============================================================================================ */

describe("262/R39 — la rama de corrección no toca el catálogo de estados", () => {
  const CORRECCION = ramaDelSwitch(CODIGO, "correccion_dia") ?? "";
  const TRANSICION = ramaDelSwitch(CODIGO, "transicion") ?? "";

  it("no llama a `estatusLabel` ni pinta la flecha de estados", () => {
    // M-ac (pintar la corrección con `estatusLabel`) muere aquí y en el test de pantalla.
    expect(CORRECCION, "la corrección se está etiquetando con un estado").not.toContain(
      "estatusLabel",
    );
    expect(CORRECCION).not.toContain("→");
    expect(CORRECCION).not.toContain("Creación");
  });

  it("ANTI-VACUIDAD: la rama de TRANSICIÓN sí llama a `estatusLabel` y sí pinta la flecha", () => {
    // Sin esta mitad, lo de arriba estaría verde con un extractor que devolviera cadena vacía.
    expect(TRANSICION).toContain("estatusLabel");
    expect(TRANSICION).toContain("→");
  });

  it("la corrección no nombra ningún campo de estado del DTO", () => {
    for (const campo of ["estatusOrigenValue", "estatusDestinoValue", "origenTipo"]) {
      expect(CORRECCION, `la corrección lee \`${campo}\`, que no tiene`).not.toContain(campo);
    }
  });
});

/* ============================================================================================ */
/* (c) R18 — los dos textos del día salen de la fuente única                                     */
/* ============================================================================================ */

describe("262/R18 — el componente importa los textos del día, no los copia", () => {
  it("importa `ETIQUETA_CORRECCION_DIA` y `textoCorreccionDiaReparto` del módulo de textos", () => {
    expect(CODIGO).toMatch(/from\s+"@\/lib\/utils\/dia-reparto-textos"/);
    expect(CODIGO).toContain("ETIQUETA_CORRECCION_DIA");
    expect(CODIGO).toContain("textoCorreccionDiaReparto");
  });

  it("ANTI-VACUIDAD: los dos símbolos existen, exportados, en la fuente única", () => {
    const textos = leer(FUENTE_UNICA);
    expect(textos).toContain("export const ETIQUETA_CORRECCION_DIA");
    expect(textos).toContain("export function textoCorreccionDiaReparto");
  });

  it("no copia ningún literal de fecha ni el nombre de un mes", () => {
    // M-x en su forma fuerte: copiar el texto en el `.tsx` lo sacaría del módulo que la guardia
    // (2) de `dia-reparto-textos.test.ts` vigila —el que tiene prohibido `Date` e `Intl`—, y la
    // fecha del día volvería a depender del reloj del navegador (R41).
    for (const mes of ["enero", "agosto", "diciembre"]) {
      expect(CODIGO, `el componente copió el mes «${mes}»`).not.toContain(mes);
    }
    expect(CODIGO, "el componente lleva una fecha escrita a mano").not.toMatch(
      /\d{4}-\d{2}-\d{2}/,
    );
    expect(CODIGO).not.toContain("Día de reparto"); // el literal vive en la fuente única
  });
});

/* ============================================================================================ */
/* (d) R41 — el componente NO ordena                                                             */
/* ============================================================================================ */

describe("262/R41 — el orden lo pone el servidor; la pantalla sólo pinta", () => {
  it("el componente no ordena, ni compara instantes entre entradas", () => {
    // M-aa (ordenar en el componente en vez de en el servicio) muere aquí. Ordenar en el
    // navegador sería una SEGUNDA definición del orden — lo que la 246 y la 261 sacaron del
    // cliente a propósito.
    expect(CODIGO, "el componente ordena la línea de tiempo").not.toMatch(/\.sort\s*\(/);
    expect(CODIGO).not.toMatch(/\.reverse\s*\(/);
    expect(CODIGO).not.toMatch(/localeCompare/);
  });

  it("no construye ninguna fecha: sólo formatea el instante que recibe", () => {
    // `new Date(...)` en la pantalla es la puerta por la que entra el reloj del navegador. El
    // `Intl` fijo a `America/Costa_Rica` que formatea el sello SÍ está permitido y es
    // preexistente: un INSTANTE y una FECHA CALENDARIO son cosas distintas (design §14.4).
    expect(CODIGO, "el componente construye fechas").not.toMatch(/new\s+Date\s*\(/);
    expect(CODIGO).not.toMatch(/Date\.now\s*\(/);
    expect(CODIGO).toContain('timeZone: "America/Costa_Rica"');
  });

  it("la `key` de la lista antepone la CLASE (design §14.4)", () => {
    // Con dos fuentes, dos entradas del mismo instante producirían `key` iguales y React
    // remonta en silencio.
    expect(CODIGO).toMatch(/key\s*=\s*\{?\s*`\$\{entrada\.clase\}/);
  });
});

/* ============================================================================================ */
/* (f) LA DEUDA DE F6, ANOTADA — lo que ocupa el lugar de la rotura deliberada                    */
/* ============================================================================================ */

/** La anotación de deuda, con su motivo obligatorio en la MISMA línea. */
// El `(?!\*\/)` del principio NO es cosmético: sin él, `/** @pendiente-262-f6 */` «captura» el
// cierre del comentario como si fuera el motivo, y una anotación VACÍA pasaría la guardia. La
// autocomprobación (h) lo caza en las dos direcciones.
const PENDIENTE = /@pendiente-262-f6[ \t]+(?!\*\/)(\S[^\n]*)/;
const MOTIVO_MINIMO = 40;

describe("262 — la deuda que esta tanda NO cierra sigue escrita junto al código", () => {
  it("el componente lleva la anotación `@pendiente-262-f6` con su motivo", () => {
    // Es la convención de este repo («el motivo junto al código», como `@sin-superficie`) y
    // sirve para lo mismo: INVERTIR LA CARGA DE LA PRUEBA. Quien dé por cerrada la ficha se
    // encuentra esta guardia, lee qué falta y tiene que borrar la anotación A PROPÓSITO —con lo
    // que borrar esta comprobación deja de ser un descuido y pasa a ser una decisión firmada.
    //
    // Lo que esto NO es, dicho sin rodeos: no es una forcing function. Ninguna comprobación
    // automática puede hacer que alguien abra la app y mire la pantalla. Lo que hace es que
    // nadie pueda decir que no lo sabía.
    const anotacion = PENDIENTE.exec(CRUDO);
    expect(
      anotacion,
      "se retiró `@pendiente-262-f6` del componente. Si F6 (ver la app) ya se hizo, borra " +
        "TAMBIÉN este bloque de la guardia y escribe la evidencia en `progress/`. Si no se " +
        "hizo, vuelve a poner la anotación.",
    ).not.toBeNull();

    const motivo = (anotacion?.[1] ?? "").trim();
    expect(motivo.length, "la anotación no dice QUÉ falta").toBeGreaterThanOrEqual(
      MOTIVO_MINIMO,
    );
    expect(motivo, "la anotación no nombra la tarea que queda").toMatch(/F6|ver la app/i);
  });
});

/* ============================================================================================ */
/* (g) Los tests de pantalla de esa entrada siguen existiendo                                     */
/* ============================================================================================ */

describe("262/R38-R39 — la entrada de corrección conserva sus tests de pantalla", () => {
  it("el test de componente sigue montando una entrada `correccion_dia` y afirmando sobre ella", () => {
    // «El test que vive dentro de lo que borras»: en este repo, borrar un componente se llevó
    // por delante los tests de features ajenas y costó una regresión en producción. Aquí el
    // riesgo es el mismo por la otra puerta — un refactor del fixture que se lleve la clase.
    const test = leer(TEST_DE_PANTALLA);
    expect(test, "el test de pantalla ya no monta una corrección").toContain(
      'clase: "correccion_dia"',
    );
    expect(test).toContain("ETIQUETA_CORRECCION_DIA");
    expect(test, "desapareció la aserción de las dos fechas en palabras").toContain(
      "Del 21 de agosto al 22 de agosto",
    );
  });
});

/* ============================================================================================ */
/* (h) AUTOCOMPROBACIÓN DEL DETECTOR                                                             */
/* ============================================================================================ */

describe("262 — autocomprobación: el detector caza sus violaciones inyectadas", () => {
  const SWITCH_DE_JUGUETE = [
    'switch (entrada.clase) {',
    '  case "transicion": {',
    "    return estatusLabel(entrada.estatusDestinoValue);",
    "  }",
    '  case "correccion_dia": {',
    "    return ETIQUETA_CORRECCION_DIA;",
    "  }",
    "  default: {",
    "    const _exhaustivo: never = entrada;",
    "    return _exhaustivo;",
    "  }",
    "}",
  ].join("\n");

  it("`ramaDelSwitch` devuelve CADA rama y no se pasa a la siguiente", () => {
    expect(ramaDelSwitch(SWITCH_DE_JUGUETE, "transicion")).toContain("estatusLabel");
    expect(ramaDelSwitch(SWITCH_DE_JUGUETE, "correccion_dia")).toContain(
      "ETIQUETA_CORRECCION_DIA",
    );
    // La clave: la rama de corrección NO arrastra el `estatusLabel` de la anterior ni el
    // `never` del `default`.
    expect(ramaDelSwitch(SWITCH_DE_JUGUETE, "correccion_dia")).not.toContain("estatusLabel");
    expect(ramaDelSwitch(SWITCH_DE_JUGUETE, "correccion_dia")).not.toContain("never");
  });

  it("`ramaDelSwitch` devuelve null cuando la rama NO está (y por eso (0) se pondría rojo)", () => {
    expect(ramaDelSwitch(SWITCH_DE_JUGUETE, "clase_que_no_existe")).toBeNull();
  });

  it("el detector de `estatusLabel` caza la mutación M-ac inyectada en la rama de corrección", () => {
    const mutado = SWITCH_DE_JUGUETE.replace(
      "    return ETIQUETA_CORRECCION_DIA;",
      "    return estatusLabel(entrada.fechaNuevaISO);",
    );
    expect(ramaDelSwitch(SWITCH_DE_JUGUETE, "correccion_dia")).not.toContain("estatusLabel");
    expect(ramaDelSwitch(mutado, "correccion_dia")).toContain("estatusLabel");
  });

  it("`soloCodigo` borra el comentario que NOMBRA lo prohibido y conserva el código", () => {
    expect(soloCodigo("// aquí no se llama a estatusLabel\nconst a = 1;")).not.toContain(
      "estatusLabel",
    );
    expect(soloCodigo("/* ni new Date() */\nconst a = 1;")).not.toContain("new Date");
    expect(soloCodigo("const x = estatusLabel(v);")).toContain("estatusLabel");
    // Y no se come una URL (`https://`), que es el falso positivo clásico del stripper de `//`.
    expect(soloCodigo('const u = "https://ordenex.cr";')).toContain("https://ordenex.cr");
  });

  it("el detector de la anotación exige un motivo de verdad, no un `TODO`", () => {
    expect(PENDIENTE.exec("/** @pendiente-262-f6 */")).toBeNull();
    const flojo = PENDIENTE.exec("/** @pendiente-262-f6 TODO */");
    expect((flojo?.[1] ?? "").trim().length).toBeLessThan(MOTIVO_MINIMO);
    const bueno = PENDIENTE.exec(
      "/** @pendiente-262-f6 F6: falta ver la app con las tres cuentas y dejar la evidencia. */",
    );
    expect((bueno?.[1] ?? "").trim().length).toBeGreaterThanOrEqual(MOTIVO_MINIMO);
  });
});
