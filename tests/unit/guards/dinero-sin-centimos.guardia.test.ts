import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatearValor } from "@/components/private/analytics/formato";
import { PriceLabel } from "@/components/shared/PriceLabel";
import { formatMonto, formatMontoString, monedaConfig, money } from "@/lib/config/moneda";
import { lineasSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 230 — GUARDIA: el dinero se pinta SIN CENTIMOS, y sigue sin pintarlos.
 *
 * POR QUE EXISTE. La 230 no añade una pantalla: cambia el aspecto de TODAS a la
 * vez desde un unico punto de paso (`lib/config/moneda.ts`). Un cambio asi se
 * deshace solo: basta con que la proxima feature meta un `toFixed(2)` en una
 * celda nueva, o con que alguien "arregle" el redondeo del formateador, para que
 * los centimos vuelvan a una esquina de la app sin que nadie se entere. Sin esta
 * guardia, el rojo llegaria meses despues y en forma de queja del humano.
 *
 * CINCO DIENTES, y cada uno con su contraprueba dentro del propio archivo:
 *
 *   1. COMPORTAMIENTO — ningun camino de dinero emite el separador decimal
 *      seguido de un digito. Corpus determinista de >100 importes por los cinco
 *      caminos publicos (R1, R12, R19a).
 *   2. ESTRUCTURA — nadie en `app/**` ni `components/**` serializa un importe
 *      saltandose el formateador compartido (R19b).
 *   3. FRONTERA — los modulos de descarga XLSX/CSV NO pasan por el formateador:
 *      la contabilidad conserva los centimos (R16).
 *   4. NO-OBJETIVO — porcentaje, duracion y conteo de analitica NO se tocan
 *      (R15, D2), y la rama verbatim queda declarada como excepcion (C2).
 *   5. PROSA — ningun docstring de la superficie de dinero sigue prometiendo
 *      decimales (R18, C4).
 *
 * El separador decimal se lee de `monedaConfig`, NO se escribe a mano: es la
 * decision Q1(b) del spec. El campo dejo de gobernar la salida y su oficio nuevo
 * es exactamente este — ser el punto unico donde se declara el caracter que esta
 * guardia persigue. Escribir la coma aqui seria el hardcode de contexto que
 * `docs/architecture.md` prohibe.
 *
 * LIMITACION CONOCIDA Y DECLARADA: el diente 1 distingue el separador decimal
 * del de miles por el caracter configurado. Si alguien configurara el MISMO para
 * los dos, esta guardia no podria separarlos — pero esa configuracion ya rompe
 * el formato hoy, antes de esta feature.
 */

const RAIZ = path.resolve(__dirname, "../../..");

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** El separador decimal CONFIGURADO, seguido de un digito. Lo prohibido. */
const CON_DECIMAL = new RegExp(`${escaparRegex(monedaConfig.separadorDecimal)}\\d`);
/** El sub-caso literal que pidio el humano: «esos dos decimales despues de la coma». */
const CON_DOS_DECIMALES = new RegExp(`${escaparRegex(monedaConfig.separadorDecimal)}\\d\\d`);

function codigo(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
}

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function relativa(absoluta: string): string {
  return path.relative(RAIZ, absoluta).split(path.sep).join("/");
}

// ───────────────────────────────────────────────────────────────────────────
// El corpus. Determinista y generado, no una lista escrita a mano: lo que se
// persigue es un fallo de ACARREO o de AGRUPACION, y esos aparecen en bordes
// (999, 9999, todos los primeros decimales) que una lista a mano no cubre.
// ───────────────────────────────────────────────────────────────────────────

/** La tabla de contrato de `design.md` §2.4, entera. */
const TABLA_DE_CONTRATO: readonly string[] = [
  "13331832.72",
  "1234.49",
  "1234.50",
  "-4500.50",
  "999.50",
  "9.99",
  "999999.99",
  "-0.49",
  "-0.00",
  "320",
  "1234567",
  "10.4999",
  "10.5001",
  "12345678901.99",
  "99999999999.51",
];

/** 1 a 12 digitos de parte entera, con los bordes de la agrupacion incluidos. */
const PARTES_ENTERAS: readonly string[] = [
  "0",
  "7",
  "99",
  "320",
  "999",
  "1000",
  "9999",
  "99999",
  "999999",
  "1234567",
  "99999999",
  "999999999",
  "9999999999",
  "99999999999",
  "123456789012",
];

/** 0, 1, 2 y 3 decimales, y TODOS los primeros decimales de `0` a `9`. */
const COLAS: readonly string[] = (() => {
  const colas = [""];
  for (const primero of "0123456789") {
    colas.push(`.${primero}`, `.${primero}9`, `.${primero}49`);
  }
  return colas;
})();

const CORPUS_STRING: readonly string[] = (() => {
  const casos = new Set<string>(TABLA_DE_CONTRATO);
  for (const signo of ["", "-"]) {
    for (const enteros of PARTES_ENTERAS) {
      for (const cola of COLAS) casos.add(`${signo}${enteros}${cola}`);
    }
  }
  return [...casos];
})();

/**
 * El corpus NUMERICO va aparte, y se construye con aritmetica en vez de
 * convirtiendo los strings de arriba: los tres caminos que reciben `number`
 * (`formatMonto`, `PriceLabel`, `formatearValor`) lo reciben POR CONTRATO
 * (feature 32/R5), y meter un `Number(` aqui seria pedirle a la guardia
 * justo lo que la guardia vigila.
 */
const CORPUS_NUMERO: readonly number[] = (() => {
  const enteros = [0, 7, 99, 320, 999, 1000, 9999, 999999, 1234567, 99999999, 9999999999];
  const centimos = [0, 1, 4, 5, 9, 10, 49, 50, 51, 99];
  const casos: number[] = [];
  for (const entero of enteros) {
    for (const centimo of centimos) {
      casos.push(entero + centimo / 100, -(entero + centimo / 100));
    }
  }
  return casos;
})();

/** El texto que PriceLabel pinta, sin las etiquetas del marcado. */
function textoDePriceLabel(valor: number): string {
  return renderToStaticMarkup(createElement(PriceLabel, { value: valor })).replace(/<[^>]*>/g, "");
}

/** Los cinco caminos publicos de presentacion de dinero, cada uno con su nombre. */
const CAMINOS_STRING: readonly { nombre: string; formatear: (v: string) => string }[] = [
  { nombre: "formatMontoString", formatear: (v) => formatMontoString(v) },
  { nombre: "money", formatear: (v) => money(v) },
];

const CAMINOS_NUMERO: readonly { nombre: string; formatear: (v: number) => string }[] = [
  { nombre: "formatMonto", formatear: (v) => formatMonto(v) },
  { nombre: "PriceLabel", formatear: (v) => textoDePriceLabel(v) },
  { nombre: "formatearValor(·, moneda)", formatear: (v) => formatearValor(v, "moneda") },
];

/** Recorre los cinco caminos con los dos corpus y devuelve lo que casa el patron. */
function salidasQueCasan(patron: RegExp): string[] {
  const hallazgos: string[] = [];
  for (const camino of CAMINOS_STRING) {
    for (const entrada of CORPUS_STRING) {
      const salida = camino.formatear(entrada);
      if (patron.test(salida)) hallazgos.push(`${camino.nombre}("${entrada}") -> ${salida}`);
    }
  }
  for (const camino of CAMINOS_NUMERO) {
    for (const entrada of CORPUS_NUMERO) {
      const salida = camino.formatear(entrada);
      if (patron.test(salida)) hallazgos.push(`${camino.nombre}(${entrada}) -> ${salida}`);
    }
  }
  return hallazgos;
}

describe("guardia 230 · diente 1 — ningun camino de dinero emite centimos", () => {
  it("el corpus mira algo: mas de 100 casos por cada tipo de camino", () => {
    // Sin esto, un corpus que se quedara vacio dejaria los tres tests de abajo
    // pasando por no mirar nada — el modo de fallo silencioso de este repo.
    expect(CORPUS_STRING.length).toBeGreaterThan(100);
    expect(CORPUS_NUMERO.length).toBeGreaterThan(100);
    expect(CAMINOS_STRING.length + CAMINOS_NUMERO.length).toBe(5);
    // Y los patrones distinguen lo que dicen distinguir.
    expect(CON_DECIMAL.test(`1.234${monedaConfig.separadorDecimal}5`)).toBe(true);
    expect(CON_DECIMAL.test("1.234")).toBe(false);
    expect(CON_DOS_DECIMALES.test(`1.234${monedaConfig.separadorDecimal}56`)).toBe(true);
    expect(CON_DOS_DECIMALES.test(`1.234${monedaConfig.separadorDecimal}5`)).toBe(false);
  });

  it("ninguna salida lleva el separador decimal seguido de un digito (R1, R12)", () => {
    // La afirmacion FUERTE: ni un solo digito decimal, no solo los dos que
    // molestaban. Un `₡1.234,5` tambien seria un fallo de esta feature.
    expect(salidasQueCasan(CON_DECIMAL), "un camino de dinero emitio parte decimal").toEqual([]);
  });

  it("y en particular ninguna lleva los DOS decimales que pidio quitar el humano", () => {
    expect(salidasQueCasan(CON_DOS_DECIMALES)).toEqual([]);
  });

  it("los cinco caminos dan la MISMA cadena para el mismo importe (R12)", () => {
    // Que ninguno pinte decimales no basta: podrian estar dando cinco aspectos
    // distintos. Los consumidores no cambian precisamente porque no lo hacen.
    const discrepancias: string[] = [];
    for (const numero of CORPUS_NUMERO) {
      const desdeString = formatMontoString(numero.toFixed(2));
      const salidas = [
        formatMonto(numero),
        textoDePriceLabel(numero),
        formatearValor(numero, "moneda"),
        money(numero.toFixed(2)),
      ];
      for (const salida of salidas) {
        if (salida !== desdeString) discrepancias.push(`${numero}: ${salida} != ${desdeString}`);
      }
    }
    expect(discrepancias).toEqual([]);
  });

  it("CONTRAPRUEBA: un formateador que conserve los centimos SI es cazado", () => {
    // Es la mutacion del diente 1 escrita dentro del test, para que el barrido
    // no pueda estar pasando por no mirar nada. La mutacion REAL —revertir el
    // paso 5 de `design.md` §2.3 en el modulo— se ejecuto aparte y su salida
    // roja esta pegada en `progress/impl_230_backend.md`.
    const formateadorDeMentira = (valor: string): string => {
      const punto = valor.indexOf(".");
      if (punto === -1) return `${monedaConfig.simbolo}${valor}`;
      const enteros = valor.slice(0, punto);
      const decimales = valor.slice(punto + 1);
      return `${monedaConfig.simbolo}${enteros}${monedaConfig.separadorDecimal}${decimales}`;
    };

    const cazados = CORPUS_STRING.filter((entrada) =>
      CON_DECIMAL.test(formateadorDeMentira(entrada)),
    );
    expect(cazados.length).toBeGreaterThan(100);
    // Y el bueno, sobre exactamente el mismo corpus, no cae ni una vez.
    expect(CORPUS_STRING.filter((entrada) => CON_DECIMAL.test(formatMontoString(entrada)))).toEqual(
      [],
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diente 2 — estructura: nadie se salta el formateador compartido.
// ───────────────────────────────────────────────────────────────────────────

const ARBOLES_DE_PANTALLA: readonly string[] = ["app", "components"];

/**
 * Usos de `.toFixed(` que NO son dinero, censados uno a uno. La lista es corta a
 * proposito: cualquier `.toFixed(` nuevo en estos dos arboles pone la guardia
 * roja hasta que alguien lo justifique aqui, y ese tramite ES el punto.
 */
const LISTA_BLANCA_TO_FIXED: readonly { ruta: string; porque: string }[] = [
  {
    ruta: "components/shared/BulkUpload.tsx",
    porque: "tamaño de archivo en MB, no un importe",
  },
];

const SERIALIZA_CRUDO = /\.toFixed\s*\(/;

/** `ruta:linea` de cada `.toFixed(` que sobreviva a quitar los comentarios. */
function usosDeToFixed(fuente: string, ruta: string): string[] {
  return lineasSinComentarios(fuente)
    .map((linea, indice) => (SERIALIZA_CRUDO.test(linea) ? `${ruta}:${indice + 1}` : null))
    .filter((hallazgo): hallazgo is string => hallazgo !== null);
}

describe("guardia 230 · diente 2 — nadie serializa un importe a mano", () => {
  it("el barrido recorre los dos arboles enteros (mas de 100 fuentes)", () => {
    const total = ARBOLES_DE_PANTALLA.reduce(
      (acc, dir) => acc + listarFuentes(path.join(RAIZ, dir)).length,
      0,
    );
    expect(total).toBeGreaterThan(100);
  });

  it("ningun fuente de `app/**` ni `components/**` llama a `.toFixed(` sobre un importe (R19b)", () => {
    const permitidos = new Set(LISTA_BLANCA_TO_FIXED.map((entrada) => entrada.ruta));
    const hallazgos: string[] = [];
    for (const dir of ARBOLES_DE_PANTALLA) {
      for (const absoluta of listarFuentes(path.join(RAIZ, dir))) {
        const ruta = relativa(absoluta);
        if (permitidos.has(ruta)) continue;
        hallazgos.push(...usosDeToFixed(readFileSync(absoluta, "utf8"), ruta));
      }
    }
    expect(
      hallazgos,
      "un importe serializado sin pasar por el formateador compartido (`@/lib/config/moneda`)",
    ).toEqual([]);
  });

  it("la lista blanca no se pudre: cada excepcion existe y sigue usando `.toFixed(`", () => {
    // Una lista blanca que nombra archivos que ya no llaman a `.toFixed(` deja
    // la puerta abierta sin que nadie lo note.
    for (const { ruta } of LISTA_BLANCA_TO_FIXED) {
      expect(existsSync(path.join(RAIZ, ruta)), `${ruta} no existe`).toBe(true);
      expect(
        usosDeToFixed(readFileSync(path.join(RAIZ, ruta), "utf8"), ruta).length,
        `${ruta} ya no necesita estar en la lista blanca`,
      ).toBeGreaterThan(0);
    }
  });

  it("CONTRAPRUEBA: el codigo VIEJO de la celda del resumen de carga es cazado, y el bueno no", () => {
    // El codigo real que vivia en `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx`
    // hasta la 230: pintaba el monto crudo, sin simbolo, sin agrupar y sin pasar
    // por el formateador. Era la unica fuga medida en los dos arboles.
    const celdaVieja = `render: (row) => (row.montoCobrar != null ? row.montoCobrar.toFixed(2) : "-"),`;
    const celdaBuena = `render: (row) => formatMonto(row.montoCobrar),`;

    expect(usosDeToFixed(celdaVieja, "celda")).toEqual(["celda:1"]);
    expect(usosDeToFixed(celdaBuena, "celda")).toEqual([]);
  });

  it("un `.toFixed(2)` que vive en un COMENTARIO no pone la guardia roja", () => {
    // La prosa de este arbol nombra a proposito lo prohibido —`ordenes-columns.tsx`
    // explica en su docstring que `toFixed(2)` bajaba un centimo—, y un barrido
    // sobre el texto crudo denunciaria la explicacion y obligaria a borrarla.
    const soloComentario = [
      "/** Antes esto hacia row.montoCobrar.toFixed(2) y perdia el simbolo. */",
      "// ni un .toFixed(2) en una nota de linea se salva de la cita",
      "const x = formatMonto(row.montoCobrar);",
    ].join("\n");
    expect(usosDeToFixed(soloComentario, "citado")).toEqual([]);

    // Y sobre el archivo REAL que motiva esta excepcion, no sobre uno inventado:
    // sin este ancla, el test de arriba podria estar verde porque el quitador de
    // comentarios se lleva de mas y nadie se enteraria.
    const ordenesColumns = "app/(app)/ordenes/_components/ordenes-columns.tsx";
    const fuente = readFileSync(path.join(RAIZ, ordenesColumns), "utf8");
    expect(
      fuente,
      `${ordenesColumns} ya no cita \`.toFixed(2)\` en su prosa: elige otro fuente citado como ancla o retira esta comprobacion`,
    ).toContain(".toFixed(2)");
    expect(usosDeToFixed(fuente, ordenesColumns)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diente 3 — la frontera de las descargas: la contabilidad conserva los centimos.
// ───────────────────────────────────────────────────────────────────────────

const MODULOS_DE_DESCARGA: readonly string[] = [
  "lib/utils/descarga-dataset.ts",
  "lib/utils/manifiesto-xlsx.ts",
];

const IMPORTA_MONEDA = /from\s+["']@\/lib\/config\/moneda["']/;
const NOMBRA_FORMATEADOR = /\b(money|formatMonto|formatMontoString)\s*\(/;

describe("guardia 230 · diente 3 — las descargas NO pasan por el formateador (R16)", () => {
  it("los modulos de descarga existen y no importan el modulo de moneda", () => {
    const hallazgos: string[] = [];
    for (const ruta of MODULOS_DE_DESCARGA) {
      expect(existsSync(path.join(RAIZ, ruta)), `${ruta} no existe`).toBe(true);
      const fuente = codigo(ruta);
      if (IMPORTA_MONEDA.test(fuente)) hallazgos.push(`${ruta}: importa @/lib/config/moneda`);
      const nombrado = NOMBRA_FORMATEADOR.exec(fuente);
      if (nombrado) hallazgos.push(`${ruta}: llama a ${nombrado[0]}`);
    }
    expect(
      hallazgos,
      "una descarga paso por el formateador de presentacion y perdio los centimos",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: un fuente que SI lo importa es cazado", () => {
    const ficticio = `
      import { formatMonto } from "@/lib/config/moneda";
      export function fila(monto: number) { return formatMonto(monto); }
    `;
    expect(IMPORTA_MONEDA.test(quitarComentarios(ficticio))).toBe(true);
    expect(NOMBRA_FORMATEADOR.test(quitarComentarios(ficticio))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diente 4 — el no-objetivo (D2/R15) y la excepcion verbatim (C2).
// ───────────────────────────────────────────────────────────────────────────

describe("guardia 230 · diente 4 — lo que NO se toca", () => {
  it("el porcentaje conserva su decimal (R15, D2)", () => {
    // Comparado contra el MISMO `Intl` que lo produce hoy, no contra un literal
    // inventado: si alguien "sanea" tambien los porcentajes, esto se pone rojo.
    const esperado = new Intl.NumberFormat(monedaConfig.locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(0.842);
    expect(formatearValor(0.842, "porcentaje")).toBe(esperado);
    expect(formatearValor(0.842, "porcentaje")).toMatch(CON_DECIMAL);
  });

  it("la duracion conserva su decimal (R15, D2)", () => {
    const esperado = new Intl.NumberFormat(monedaConfig.locale, {
      style: "unit",
      unit: "hour",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    }).format(1.5);
    expect(formatearValor(5400, "segundos")).toBe(esperado);
    expect(formatearValor(5400, "segundos")).toMatch(CON_DECIMAL);
  });

  it("el conteo sigue sin decimales, como siempre (R15)", () => {
    const esperado = new Intl.NumberFormat(monedaConfig.locale, {
      maximumFractionDigits: 0,
    }).format(1234);
    expect(formatearValor(1234, "conteo")).toBe(esperado);
  });

  it("la rama VERBATIM queda FUERA del diente 1, y se dice por que (C2)", () => {
    // Si el servidor mandara un importe que no tiene forma de decimal —p. ej. ya
    // formateado con coma—, el modulo lo pinta tal cual: es la rama que existe
    // para que un dato ilegible se VEA en vez de esconderse tras el marcador de
    // ausencia. Puede producir justo lo que el diente 1 prohibe, y por eso el
    // corpus del diente 1 solo lleva importes CON forma decimal.
    const conComa = `1${monedaConfig.separadorDecimal}50`;
    expect(formatMontoString(conComa)).toBe(`${monedaConfig.simbolo}${conComa}`);
    expect(formatMontoString(conComa)).toMatch(CON_DOS_DECIMALES);
    // Y no se confunde con ausencia de importe: pintar "sin monto" cuando si lo
    // hay seria mentir.
    expect(formatMontoString("1.2.3")).toBe(`${monedaConfig.simbolo}1.2.3`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diente 5 — la prosa: ningun docstring sigue prometiendo decimales (R18, C4).
// ───────────────────────────────────────────────────────────────────────────

/**
 * La superficie de dinero cuya DOCUMENTACION describe el formato. Censo
 * explicito: si un archivo se mueve, el test cae en vez de salirse del alcance
 * en silencio.
 *
 * `components/private/analytics/formato.ts` esta EXCLUIDO a proposito y no por
 * olvido: su docstring escribe `0,842` para explicar que un porcentaje llega
 * como fraccion, y el porcentaje CONSERVA su decimal (D2/R15). Meterlo aqui
 * pondria la guardia roja por documentar bien justo el no-objetivo.
 */
const SUPERFICIE_DOCUMENTADA: readonly string[] = [
  "lib/config/moneda.ts",
  "components/shared/PriceLabel.tsx",
  "components/shared/KpiValorAnimado.tsx",
];

const PROMESAS_DE_DECIMALES: readonly RegExp[] = [
  // Un ejemplo de importe con dos digitos tras el separador decimal.
  CON_DOS_DECIMALES,
  // Y la frase, por si el ejemplo se quita y la promesa se queda.
  /siempre\s+(?:los\s+)?dos\s+decimales/i,
];

/**
 * Promesas que viven en la PROSA y no en el codigo. Una linea cuenta solo si el
 * patron casa en el fuente original y NO casa ya sin comentarios: asi el
 * hallazgo es siempre del comentario, nunca de un literal del codigo.
 */
function promesasEnProsa(fuente: string, ruta: string): string[] {
  const original = fuente.split("\n");
  const sinProsa = lineasSinComentarios(fuente);
  const hallazgos = new Set<string>();
  original.forEach((linea, indice) => {
    for (const patron of PROMESAS_DE_DECIMALES) {
      if (patron.test(linea) && !patron.test(sinProsa[indice] ?? "")) {
        hallazgos.add(`${ruta}:${indice + 1}: ${linea.trim()}`);
      }
    }
  });
  return [...hallazgos];
}

describe("guardia 230 · diente 5 — ningun docstring promete decimales (R18)", () => {
  it("los fuentes censados existen y TIENEN prosa que barrer", () => {
    // Un archivo sin comentarios dejaria el test de abajo pasando por no mirar
    // nada, que es justo el modo de fallo que estas guardias existen para cerrar.
    for (const ruta of SUPERFICIE_DOCUMENTADA) {
      const completa = path.join(RAIZ, ruta);
      expect(existsSync(completa), `${ruta} no existe`).toBe(true);
      const fuente = readFileSync(completa, "utf8");
      const lineasDeProsa = fuente
        .split("\n")
        .filter((linea, indice) => linea !== (lineasSinComentarios(fuente)[indice] ?? linea));
      expect(lineasDeProsa.length, `${ruta} no tiene comentarios que barrer`).toBeGreaterThan(5);
    }
  });

  it("ningun fuente de la superficie de dinero promete decimales en su prosa", () => {
    const hallazgos: string[] = [];
    for (const ruta of SUPERFICIE_DOCUMENTADA) {
      hallazgos.push(...promesasEnProsa(readFileSync(path.join(RAIZ, ruta), "utf8"), ruta));
    }
    expect(
      hallazgos,
      "un docstring de la superficie de dinero sigue describiendo el formato con centimos",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: un docstring que promete decimales SI es cazado", () => {
    const mentiroso = [
      "/**",
      ` * Etiqueta de precio: el valor con separador de miles y SIEMPRE dos decimales`,
      ` * (\`${monedaConfig.simbolo}1.234${monedaConfig.separadorDecimal}50\`).`,
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(promesasEnProsa(mentiroso, "mentiroso").length).toBeGreaterThan(0);

    // Y el que describe el formato vigente NO cae: la guardia mira la promesa,
    // no la palabra "decimales".
    const honesto = [
      "/**",
      " * Etiqueta de precio: el valor con separador de miles y sin parte decimal",
      ` * (\`${monedaConfig.simbolo}1.234\`).`,
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(promesasEnProsa(honesto, "honesto")).toEqual([]);
  });
});
