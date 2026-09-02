import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatearValor } from "@/components/private/analytics/formato";
import { PriceLabel } from "@/components/shared/PriceLabel";
import {
  ESCALA_PRESENTACION,
  formatMonto,
  formatMontoString,
  formatMontoTope,
  monedaConfig,
  money,
  moneyTope,
  montoExacto,
} from "@/lib/config/moneda";
import { serializarMontoCotizacion } from "@/lib/utils/monto-cotizacion";
import { lineasSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * FICHA 359 — GUARDIA: el dinero pinta la cola SOLO CUANDO EXISTE, y todos los
 * caminos siguen dando la MISMA cadena.
 *
 * ES LA GUARDIA DE LA 230, CON LA REGLA CAMBIADA. Nació como
 * `dinero-sin-centimos.guardia.test.ts` y afirmaba lo contrario: que ningún
 * camino emitiera parte decimal. Se conserva entera —el corpus, los seis
 * dientes, las contrapruebas— porque su valor nunca estuvo en QUÉ regla afirmaba
 * sino en que la afirma para TODOS los caminos a la vez: es lo único que impide
 * que nazca un séptimo formateador divergente. Lo que cambia es la regla; el
 * nombre del archivo se cambió con ella para que no mienta.
 *
 * POR QUE EXISTE. Ni la 230 ni la 359 añaden una pantalla: cambian el aspecto de
 * TODAS a la vez desde un único punto de paso (`lib/config/moneda.ts`). Un
 * cambio así se deshace solo: basta con que la próxima feature meta un
 * `toFixed(2)` en una celda nueva, o con que alguien "arregle" el cuadre del
 * formateador, para que una esquina de la app se desalinee del resto sin que
 * nadie se entere. Sin esta guardia, el rojo llegaría meses después y en forma
 * de queja del humano.
 *
 * LA REGLA VIGENTE, en una línea: la salida lleva `separadorDecimal` + dos
 * dígitos SI Y SOLO SI el importe, cuadrado a la escala de presentación, tiene
 * cola distinta de cero. `₡11.899` cuando es redondo; `₡11.898,81` cuando no.
 * Se afirma en las DOS direcciones —el «solo si» es el que impide que vuelvan
 * los `₡3.500,00` que la 230 quitó— y contra un oráculo INDEPENDIENTE
 * (`Prisma.Decimal`), no contra el propio formateador.
 *
 * SEIS DIENTES, y cada uno con su contraprueba dentro del propio archivo:
 *
 *   1. COMPORTAMIENTO — los caminos públicos de dinero pintan la cola cuando
 *      existe, y solo entonces, y todos dan la misma cadena. Corpus determinista
 *      de >100 importes (R1, R12, R19a).
 *   2. ESTRUCTURA — nadie en `app/**` ni `components/**` serializa un importe
 *      saltandose el formateador compartido (R19b).
 *   3. FRONTERA — los modulos de descarga XLSX/CSV NO pasan por el formateador:
 *      la contabilidad conserva su escala (R16). Es la PRIMERA de las dos
 *      excepciones declaradas de esta guardia —descargas XLSX/CSV Y SALIDAS DE
 *      MAQUINA—; la segunda la vigila el diente 6.
 *   4. NO-OBJETIVO — porcentaje, duracion y conteo de analitica NO se tocan
 *      (R15, D2), y la rama verbatim queda declarada como excepcion (C2).
 *   5. PROSA — ningun docstring de la superficie de dinero describe una regla de
 *      formato que ya no rige (R18, C4).
 *   6. SALIDAS DE MAQUINA — hermano explicito del diente 3, añadido por la
 *      feature 255: el serializador de la cotizacion por API key
 *      (`lib/utils/monto-cotizacion.ts`) NO es ninguno de los caminos publicos,
 *      ninguna pantalla lo importa, y SI emite exactamente dos decimales a
 *      proposito porque su salida es un contrato JSON de maquina (255/R40, R41,
 *      R42) — tambien cuando la cola es `.00`, que es donde se sigue
 *      distinguiendo de las pantallas.
 *
 *      ENMIENDA DEL 2026-08-28 (ficha 319): ese modulo dejo de FORMATEAR y pasa
 *      a servir el importe CRUDO (`1578.00`). Lo que este diente vigila NO
 *      cambia —los dos decimales siguen ahi, que es lo que impide que la
 *      cotizacion pierda centimos— pero el separador ya no sale de
 *      `monedaConfig`: es el punto canonico del formato money-safe. Por eso el
 *      regex de abajo dejo de componerse desde la configuracion, y en su lugar
 *      se afirma explicitamente que la salida NO depende de ella.
 *
 * El separador decimal se lee de `monedaConfig`, NO se escribe a mano: es la
 * decision Q1(b) del spec de la 230, y desde la 359 ese campo ademas GOBIERNA la
 * salida otra vez. Vale para los dientes 1 a 5, que vigilan lo que se PINTA. El
 * diente 6 es la excepcion desde la ficha 319 y explica su porque en el sitio:
 * lo que vigila no es presentacion configurable. Escribir la coma aqui seria el
 * hardcode de contexto que `docs/architecture.md` prohibe.
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

const SEPARADOR = escaparRegex(monedaConfig.separadorDecimal);

/** El separador decimal CONFIGURADO, seguido de un digito: hay cola pintada. */
const CON_DECIMAL = new RegExp(`${SEPARADOR}\\d`);
/** La cola BIEN FORMADA: el separador y EXACTAMENTE los digitos de la escala, al final. */
const COLA_COMPLETA = new RegExp(`${SEPARADOR}\\d{${ESCALA_PRESENTACION}}$`);
/** El sub-caso literal que pidio el humano en la 230: dos decimales tras la coma. */
const CON_DOS_DECIMALES = new RegExp(`${SEPARADOR}\\d\\d`);

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

/**
 * Los SEIS caminos publicos de presentacion de dinero, cada uno con su nombre.
 *
 * `montoExacto` entro en el censo con la ficha 359. Era el sexto formateador —lo
 * escribio la feature 300 para UNA pantalla, porque el de entonces cuadraba al
 * colon y ahi esconder la cola bloqueaba al mensajero— y vivia FUERA de esta
 * guardia, que es exactamente como dos formateadores divergen sin que nadie lo
 * note. Desde la 359 no tiene cuerpo propio (es un alias), pero se le pasa el
 * corpus entero igual: lo que garantiza que siga siendo un alias es esto, no su
 * docstring.
 */
const CAMINOS_STRING: readonly { nombre: string; formatear: (v: string) => string }[] = [
  { nombre: "formatMontoString", formatear: (v) => formatMontoString(v) },
  { nombre: "money", formatear: (v) => money(v) },
];

const CAMINOS_NUMERO: readonly { nombre: string; formatear: (v: number) => string }[] = [
  { nombre: "formatMonto", formatear: (v) => formatMonto(v) },
  { nombre: "PriceLabel", formatear: (v) => textoDePriceLabel(v) },
  { nombre: "formatearValor(·, moneda)", formatear: (v) => formatearValor(v, "moneda") },
  { nombre: "montoExacto", formatear: (v) => montoExacto(v) },
];

const CAMINOS_PUBLICOS = CAMINOS_STRING.length + CAMINOS_NUMERO.length;

/** Recorre los seis caminos con los dos corpus y devuelve lo que casa el patron. */
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

// ───────────────────────────────────────────────────────────────────────────
// EL ORACULO. La regla nueva no se comprueba contra el propio formateador —eso
// seria una asercion contra su propia fuente, siempre verde— sino contra
// `Prisma.Decimal`, que es el tipo con el que el servidor calcula estas mismas
// cifras y cuyo redondeo por defecto (ROUND_HALF_UP: el medio se aleja del cero)
// es el mismo que declara el modulo.
// ───────────────────────────────────────────────────────────────────────────

/** El importe cuadrado a la escala de presentacion, segun el oraculo. */
function aEscala(importe: Prisma.Decimal): Prisma.Decimal {
  return importe.toDecimalPlaces(ESCALA_PRESENTACION);
}

/** ¿Este importe TIENE cola a la escala de presentacion? Lo decide el oraculo. */
function tieneCola(importe: Prisma.Decimal): boolean {
  return !aEscala(importe).mod(1).isZero();
}

/** Los dos digitos de la cola, segun el oraculo (`"81"`, `"00"`). */
function colaDelOraculo(importe: Prisma.Decimal): string {
  return aEscala(importe).abs().toFixed(ESCALA_PRESENTACION).slice(-ESCALA_PRESENTACION);
}

/** Los digitos de la parte entera, segun el oraculo y sin agrupar (`"11898"`). */
function enterosDelOraculo(importe: Prisma.Decimal): string {
  return aEscala(importe).abs().truncated().toFixed(0);
}

/** Todo lo que la guardia le reprocha a UNA salida, o lista vacia si esta bien. */
function reprochesA(salida: string, origen: Prisma.Decimal, quien: string): string[] {
  const fallos: string[] = [];
  const debeLlevarCola = tieneCola(origen);
  const llevaCola = CON_DECIMAL.test(salida);

  if (llevaCola !== debeLlevarCola) {
    fallos.push(
      `${quien} -> ${salida}: ${llevaCola ? "pinta" : "esconde"} una cola que ${
        debeLlevarCola ? "existe" : "no existe"
      }`,
    );
    return fallos;
  }
  if (debeLlevarCola) {
    // La cola, cuando esta, es la del oraculo y esta COMPLETA: ni `₡1.234,5` ni
    // `₡1.234,817`. La longitud es la que fija la escala de presentacion.
    if (!COLA_COMPLETA.test(salida)) {
      fallos.push(`${quien} -> ${salida}: la cola no tiene ${ESCALA_PRESENTACION} digitos`);
    }
    if (!salida.endsWith(`${monedaConfig.separadorDecimal}${colaDelOraculo(origen)}`)) {
      fallos.push(`${quien} -> ${salida}: la cola no es la del oraculo (${colaDelOraculo(origen)})`);
    }
  }
  // Y la parte entera tampoco puede haberse movido: es lo que caza un acarreo
  // indebido (`999.50` NO puede salir como mil).
  const enteros = salida.replace(/^-/, "").slice(monedaConfig.simbolo.length);
  const soloDigitos = (llevaCola ? enteros.slice(0, enteros.lastIndexOf(monedaConfig.separadorDecimal)) : enteros)
    .split(monedaConfig.separadorMiles)
    .join("");
  if (soloDigitos !== enterosDelOraculo(origen)) {
    fallos.push(
      `${quien} -> ${salida}: la parte entera es ${soloDigitos} y el oraculo dice ${enterosDelOraculo(origen)}`,
    );
  }
  return fallos;
}

describe("guardia 359 · diente 1 — la cola se pinta si y solo si existe", () => {
  it("el corpus mira algo: mas de 100 casos por cada tipo de camino", () => {
    // Sin esto, un corpus que se quedara vacio dejaria los tests de abajo
    // pasando por no mirar nada — el modo de fallo silencioso de este repo.
    expect(CORPUS_STRING.length).toBeGreaterThan(100);
    expect(CORPUS_NUMERO.length).toBeGreaterThan(100);
    expect(CAMINOS_PUBLICOS).toBe(6);
    // Y los patrones distinguen lo que dicen distinguir.
    expect(CON_DECIMAL.test(`1.234${monedaConfig.separadorDecimal}5`)).toBe(true);
    expect(CON_DECIMAL.test("1.234")).toBe(false);
    expect(COLA_COMPLETA.test(`1.234${monedaConfig.separadorDecimal}56`)).toBe(true);
    expect(COLA_COMPLETA.test(`1.234${monedaConfig.separadorDecimal}5`)).toBe(false);
    expect(COLA_COMPLETA.test(`1.234${monedaConfig.separadorDecimal}567`)).toBe(false);
    // Y el oraculo distingue los dos casos que gobiernan la regla.
    expect(tieneCola(new Prisma.Decimal("11898.81"))).toBe(true);
    expect(tieneCola(new Prisma.Decimal("11899.00"))).toBe(false);
    expect(tieneCola(new Prisma.Decimal("11899"))).toBe(false);
  });

  it("ningun camino esconde una cola que existe ni inventa una que no (R1, R12)", () => {
    const fallos: string[] = [];
    for (const camino of CAMINOS_STRING) {
      for (const entrada of CORPUS_STRING) {
        fallos.push(
          ...reprochesA(camino.formatear(entrada), new Prisma.Decimal(entrada), `${camino.nombre}("${entrada}")`),
        );
      }
    }
    for (const camino of CAMINOS_NUMERO) {
      for (const entrada of CORPUS_NUMERO) {
        // El camino numerico recibe el importe POR CONTRATO (feature 32/R5) y lo
        // serializa a escala 2; el oraculo parte de esa misma serializacion, que
        // es la frontera declarada, no de la representacion binaria.
        fallos.push(
          ...reprochesA(
            camino.formatear(entrada),
            new Prisma.Decimal(entrada.toFixed(ESCALA_PRESENTACION)),
            `${camino.nombre}(${entrada})`,
          ),
        );
      }
    }
    expect(fallos, "un camino de dinero se desalineo de la regla de la ficha 359").toEqual([]);
  });

  it("un importe REDONDO no arrastra `,00`: eso es lo que la 230 quito y sigue quitado", () => {
    // La direccion «solo si» de la regla, escrita aparte porque es la mitad que
    // se pierde si alguien "simplifica" el formateador a un `toFixed(2)` de toda
    // la vida. El humano pidio quitar esos dos decimales en la 230 y la 359 NO
    // se los devuelve: se los devuelve solo a quien los tiene.
    // 61 y no >100: el corpus esta hecho para barrer COLAS (30 por parte entera)
    // y los redondos son solo las dos que valen cero. Se fija el numero exacto
    // esperado para que un corpus que encogiera no dejara esto pasando de vacio.
    const redondos = CORPUS_STRING.filter((v) => !tieneCola(new Prisma.Decimal(v)));
    expect(redondos.length).toBeGreaterThan(50);
    const conCola = redondos.filter((v) => CON_DOS_DECIMALES.test(formatMontoString(v)));
    expect(conCola, "un importe redondo volvio a arrastrar su cola de ceros").toEqual([]);
  });

  it("el ACARREO ya no se come la cola: `999.50` no se convierte en mil (borde de la 230)", () => {
    // Era EL borde de la feature anterior y ahora es su contrario: el caso que
    // prueba que la cifra ya no se mueve. Se afirma la cadena entera, no una
    // propiedad, porque este ejemplo concreto esta en la tabla de contrato.
    const mil = `${monedaConfig.simbolo}1${monedaConfig.separadorMiles}000`;
    expect(formatMontoString("999.50")).toBe(
      `${monedaConfig.simbolo}999${monedaConfig.separadorDecimal}50`,
    );
    expect(formatMontoString("999.50")).not.toBe(mil);
    // Y el acarreo SIGUE existiendo donde toca: por encima de la escala pintada.
    expect(formatMontoString("999.999")).toBe(mil);
  });

  it("los seis caminos dan la MISMA cadena para el mismo importe (R12)", () => {
    // Que cada uno cumpla la regla no basta: podrian estar dando seis aspectos
    // distintos que la cumplen. Los consumidores no cambian precisamente porque
    // no lo hacen.
    const discrepancias: string[] = [];
    for (const numero of CORPUS_NUMERO) {
      const desdeString = formatMontoString(numero.toFixed(ESCALA_PRESENTACION));
      const salidas: readonly [string, string][] = [
        ["formatMonto", formatMonto(numero)],
        ["PriceLabel", textoDePriceLabel(numero)],
        ["formatearValor", formatearValor(numero, "moneda")],
        ["montoExacto", montoExacto(numero)],
        ["money", money(numero.toFixed(ESCALA_PRESENTACION))],
      ];
      for (const [nombre, salida] of salidas) {
        if (salida !== desdeString) {
          discrepancias.push(`${nombre}(${numero}): ${salida} != ${desdeString}`);
        }
      }
    }
    expect(discrepancias).toEqual([]);
  });

  it("`moneyTope` comparte el aspecto pero NUNCA queda por encima (cota)", () => {
    // El septimo camino tiene una regla propia A PROPOSITO —cuadra hacia el cero—
    // y por eso no entra en el censo de arriba. Lo que si tiene que cumplir es:
    // (a) para todo lo que emite el servidor —escala 2— es la MISMA cadena que
    // `money`, o el reparto anunciaria un maximo distinto del que se ve al lado;
    // (b) para cualquier cosa, nunca por encima del importe recibido.
    const distintos: string[] = [];
    const porEncima: string[] = [];
    for (const entrada of CORPUS_STRING) {
      const decimal = new Prisma.Decimal(entrada);
      const enEscala = decimal.toFixed(ESCALA_PRESENTACION);
      if (moneyTope(enEscala) !== money(enEscala)) {
        distintos.push(`${enEscala}: ${moneyTope(enEscala)} != ${money(enEscala)}`);
      }
      // (b) se comprueba sobre la entrada CRUDA, que es donde las dos reglas se
      // separan: se reconstruye el importe pintado y se compara con el original.
      const pintado = formatMontoTope(entrada);
      const crudo = pintado
        .replace(monedaConfig.simbolo, "")
        .split(monedaConfig.separadorMiles)
        .join("")
        .replace(monedaConfig.separadorDecimal, ".");
      if (!decimal.isNegative() && new Prisma.Decimal(crudo).gt(decimal)) {
        porEncima.push(`${entrada} -> ${pintado}`);
      }
    }
    expect(distintos, "un tope se desalineo del importe que se lee a su lado").toEqual([]);
    expect(porEncima, "un tope se anuncio POR ENCIMA de lo que el validador acepta").toEqual([]);

    // Y las dos reglas de verdad se separan en alguna parte: sin esto, (a) podria
    // estar verde porque `moneyTope` fuera `money` con otro nombre.
    expect(formatMontoTope("999.999")).toBe(
      `${monedaConfig.simbolo}999${monedaConfig.separadorDecimal}99`,
    );
    expect(formatMontoString("999.999")).toBe(
      `${monedaConfig.simbolo}1${monedaConfig.separadorMiles}000`,
    );
  });

  it("CONTRAPRUEBA: los dos formateadores de mentira SI son cazados", () => {
    // Las dos mutaciones del diente 1, escritas dentro del test para que el
    // barrido no pueda estar pasando por no mirar nada. Las mutaciones REALES
    // sobre el modulo se ejecutaron aparte y su salida roja esta pegada en
    // `progress/impl_359.md`.

    // (1) El de la 230: cuadra al colon y tira la cola. Esconde lo que existe.
    const cuadraAlColon = (valor: string): string =>
      `${monedaConfig.simbolo}${new Prisma.Decimal(valor).toDecimalPlaces(0).toFixed(0)}`;
    const conCola = CORPUS_STRING.filter((v) => tieneCola(new Prisma.Decimal(v)));
    expect(conCola.length).toBeGreaterThan(100);
    expect(
      conCola.filter((v) => reprochesA(cuadraAlColon(v), new Prisma.Decimal(v), "mentira").length > 0)
        .length,
    ).toBe(conCola.length);

    // (2) El `toFixed(2)` de toda la vida: pinta `,00` en los importes redondos.
    const siempreDosDecimales = (valor: string): string =>
      `${monedaConfig.simbolo}${new Prisma.Decimal(valor)
        .toFixed(ESCALA_PRESENTACION)
        .replace(".", monedaConfig.separadorDecimal)}`;
    const redondos = CORPUS_STRING.filter((v) => !tieneCola(new Prisma.Decimal(v)));
    expect(redondos.length).toBeGreaterThan(50);
    expect(
      redondos.filter(
        (v) => reprochesA(siempreDosDecimales(v), new Prisma.Decimal(v), "mentira").length > 0,
      ).length,
    ).toBe(redondos.length);

    // Y el bueno, sobre exactamente el mismo corpus, no cae ni una vez.
    expect(
      CORPUS_STRING.filter(
        (v) => reprochesA(formatMontoString(v), new Prisma.Decimal(v), "bueno").length > 0,
      ),
    ).toEqual([]);
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
 *
 * LIMITE DEL MECANISMO — escrito aqui para que no se descubra dentro de seis
 * meses: la exencion es POR ARCHIVO, no por linea. Cada ruta de esta lista queda
 * ciega ENTERA, y lo seguira estando para los `.toFixed(` que le añadan mañana
 * —y esos si podrian ser importes—. Es el precio de la forma que eligio la 230,
 * y se paga a cambio de que ampliar la lista obligue a tocar este archivo y a
 * escribir un motivo. Las dos mitigaciones son de disciplina, no de codigo:
 * mantener la lista corta, y no meter en ella un fuente que ademas pinte dinero.
 * Si algun dia deja de bastar, el sitio donde afinar es `usosDeToFixed`, que ya
 * devuelve `ruta:linea` y por tanto podria exentar la linea y no el fuente.
 */
const LISTA_BLANCA_TO_FIXED: readonly { ruta: string; porque: string }[] = [
  {
    ruta: "components/shared/BulkUpload.tsx",
    porque: "tamaño de archivo en MB, no un importe",
  },
  {
    // No se reescribio el fuente para sacarlo de aqui: `Math.round(m / 100) / 10`
    // se come el cero final y «1.0 km» pasaria a «1 km». Lo que ve el mensajero no
    // se cambia para acomodar una guardia.
    ruta: "app/(app)/mis-asignaciones/_components/TrayectoVivoButton.tsx",
    porque: "distancia en km hasta la siguiente parada, no un importe",
  },
];

const SERIALIZA_CRUDO = /\.toFixed\s*\(/;

/** `ruta:linea` de cada `.toFixed(` que sobreviva a quitar los comentarios. */
function usosDeToFixed(fuente: string, ruta: string): string[] {
  return lineasSinComentarios(fuente)
    .map((linea, indice) => (SERIALIZA_CRUDO.test(linea) ? `${ruta}:${indice + 1}` : null))
    .filter((hallazgo): hallazgo is string => hallazgo !== null);
}

describe("guardia 359 · diente 2 — nadie serializa un importe a mano", () => {
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
// Diente 3 — la frontera de las descargas XLSX/CSV y las salidas de maquina:
// la contabilidad conserva los centimos. Esta mitad vigila las DESCARGAS; la
// otra excepcion de la misma familia —las salidas de maquina— vive en el
// diente 6, al final de este archivo.
// ───────────────────────────────────────────────────────────────────────────

const MODULOS_DE_DESCARGA: readonly string[] = [
  "lib/utils/descarga-dataset.ts",
  "lib/utils/manifiesto-xlsx.ts",
];

const IMPORTA_MONEDA = /from\s+["']@\/lib\/config\/moneda["']/;
const NOMBRA_FORMATEADOR = /\b(money|formatMonto|formatMontoString)\s*\(/;

describe("guardia 359 · diente 3 — las descargas NO pasan por el formateador (R16)", () => {
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

describe("guardia 359 · diente 4 — lo que NO se toca", () => {
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
    // ausencia. No pasa por el cuadre a escala, asi que su salida no la puede
    // avalar el oraculo del diente 1 —podria llevar un digito de cola, o tres—, y
    // por eso el corpus del diente 1 solo lleva importes CON forma decimal.
    const conComa = `1${monedaConfig.separadorDecimal}50`;
    expect(formatMontoString(conComa)).toBe(`${monedaConfig.simbolo}${conComa}`);
    expect(formatMontoString(conComa)).toMatch(CON_DOS_DECIMALES);
    // Un caso que NINGUNA regla de formato de este modulo produciria, para que
    // quede claro que esta rama copia y no interpreta.
    expect(formatMontoString(`1${monedaConfig.separadorDecimal}5`)).toBe(
      `${monedaConfig.simbolo}1${monedaConfig.separadorDecimal}5`,
    );
    // Y no se confunde con ausencia de importe: pintar "sin monto" cuando si lo
    // hay seria mentir.
    expect(formatMontoString("1.2.3")).toBe(`${monedaConfig.simbolo}1.2.3`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diente 5 — la prosa: ningun docstring describe una regla que ya no rige
// (R18, C4).
//
// FICHA 359 — este diente CAMBIA DE PRESA, y es el unico que lo hace. Perseguia
// «promesas de decimales», y bajo la regla nueva un ejemplo con dos decimales ya
// no es una promesa falsa: es la documentacion correcta. Lo que ahora miente es
// lo contrario —«sin centimos», «sin parte decimal», «siempre dos decimales»— y
// eso es lo que se persigue.
//
// Las dos familias se conservan a la vez A PROPOSITO: «siempre dos decimales»
// era falso con la 230 y lo sigue siendo con la 359 (solo cuando existen), asi
// que ese patron no se retira. La guardia no se debilita al cambiar de regla.
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

/**
 * ⚠️ EL PRECIO DE ESTE DIENTE, escrito para que no se descubra dentro de seis
 * meses: la segunda familia prohibe LA FRASE, no la afirmacion. En estos tres
 * fuentes no se puede escribir «sin céntimos» ni siquiera para CONTAR que esa
 * era la regla de la 230 — el barrido no distingue el presente del pasado.
 *
 * Es deliberado y tiene su salida: la prosa historica de los tres archivos
 * cuenta la regla vieja por lo que HACIA («se pintaba cuadrado al colón», «la
 * cola se descartaba»), que ademas se entiende mejor. Se prefiere esa
 * incomodidad al regex de tiempos verbales que haria falta para distinguirlos,
 * porque ese regex fallaria en silencio y este no.
 */
const REGLAS_QUE_YA_NO_RIGEN: readonly RegExp[] = [
  // Ninguna regla de este modulo ha prometido nunca la cola SIEMPRE: era falso
  // con la 230 (no habia cola) y lo sigue siendo con la 359 (solo si existe).
  /siempre\s+(?:los\s+)?dos\s+decimales/i,
  // La regla de la 230, retirada por la 359.
  /\bsin\s+(?:la\s+|su\s+)?(?:parte\s+decimal|decimales|c[eé]ntimos|cola\b)/i,
  /\bya\s+no\s+lleva\s+(?:parte\s+decimal|decimales|c[eé]ntimos)\b/i,
];

/**
 * Descripciones caducas que viven en la PROSA y no en el codigo. Una linea
 * cuenta solo si el patron casa en el fuente original y NO casa ya sin
 * comentarios: asi el hallazgo es siempre del comentario, nunca de un literal
 * del codigo.
 */
function promesasEnProsa(fuente: string, ruta: string): string[] {
  const original = fuente.split("\n");
  const sinProsa = lineasSinComentarios(fuente);
  const hallazgos = new Set<string>();
  original.forEach((linea, indice) => {
    for (const patron of REGLAS_QUE_YA_NO_RIGEN) {
      if (patron.test(linea) && !patron.test(sinProsa[indice] ?? "")) {
        hallazgos.add(`${ruta}:${indice + 1}: ${linea.trim()}`);
      }
    }
  });
  return [...hallazgos];
}

describe("guardia 359 · diente 5 — ningun docstring describe la regla vieja (R18)", () => {
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

  it("ningun fuente de la superficie de dinero describe el formato de la 230", () => {
    const hallazgos: string[] = [];
    for (const ruta of SUPERFICIE_DOCUMENTADA) {
      hallazgos.push(...promesasEnProsa(readFileSync(path.join(RAIZ, ruta), "utf8"), ruta));
    }
    expect(
      hallazgos,
      "un docstring de la superficie de dinero sigue describiendo la regla que la ficha 359 retiro",
    ).toEqual([]);
  });

  it("y la superficie censada SI describe la regla vigente (contraparte en positivo)", () => {
    // Sin esto, el barrido de arriba estaria verde tambien si alguien borrara
    // toda la prosa de formato: la ausencia de mentira no es documentacion.
    const conLaRegla = SUPERFICIE_DOCUMENTADA.filter((ruta) =>
      /solo\s+cuando\s+existe/i.test(readFileSync(path.join(RAIZ, ruta), "utf8")),
    );
    expect(conLaRegla, "un fuente de la superficie dejo de decir cual es la regla").toEqual([
      ...SUPERFICIE_DOCUMENTADA,
    ]);
  });

  it("CONTRAPRUEBA: los docstrings caducos SI son cazados, y el vigente no", () => {
    const prometeSiempre = [
      "/**",
      ` * Etiqueta de precio: el valor con separador de miles y SIEMPRE dos decimales`,
      ` * (\`${monedaConfig.simbolo}1.234${monedaConfig.separadorDecimal}50\`).`,
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(promesasEnProsa(prometeSiempre, "prometeSiempre").length).toBeGreaterThan(0);

    // El docstring que la 230 dejo escrito en `PriceLabel`, palabra por palabra.
    const reglaDeLa230 = [
      "/**",
      " * Etiqueta de precio: el valor con separador de miles y sin parte decimal",
      ` * (\`${monedaConfig.simbolo}1.234\`).`,
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(promesasEnProsa(reglaDeLa230, "reglaDeLa230").length).toBeGreaterThan(0);

    // Y el que describe el formato vigente NO cae, aunque lleve un ejemplo con
    // cola: con la regla nueva ese ejemplo es correcto, no una promesa falsa.
    const vigente = [
      "/**",
      " * Etiqueta de precio: el valor con separador de miles y la cola solo cuando",
      ` * existe (\`${monedaConfig.simbolo}1.234\`, \`${monedaConfig.simbolo}416${monedaConfig.separadorDecimal}47\`).`,
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(promesasEnProsa(vigente, "vigente")).toEqual([]);

    // Y la prosa HISTORICA, en pasado, tampoco: contar de donde viene una regla
    // no es prometerla, y prohibirlo obligaria a borrar el porque.
    const historica = [
      "/**",
      " * Hasta la ficha 359 este formato se pintaba cuadrado al colon y la cola se",
      " * descartaba; desde entonces la cola sale solo cuando existe.",
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(promesasEnProsa(historica, "historica")).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diente 6 — salidas de maquina: el contrato JSON SI lleva centimos (255/R41).
//
// Hermano explicito del diente 3 y con su misma forma (censo por ruta +
// contraprueba). El diente 3 declara la primera excepcion de esta guardia —las
// descargas XLSX/CSV, "la contabilidad los necesita"—; esta es la segunda: un
// importe que viaja en un contrato JSON y lo lee un integrador, no una persona.
// Las dos cosas son compatibles y conviene que quede escrito: dentro de seis
// meses, quien encuentre un `toFixed(2)` de dinero en `lib/` no debe leerlo
// como una incoherencia que hay que "arreglar".
// ───────────────────────────────────────────────────────────────────────────

/**
 * Las salidas de MAQUINA censadas una a una, con su motivo. Igual que el censo
 * del diente 3: si el modulo se mueve o se borra, el test cae en vez de salirse
 * del alcance en silencio, y añadir una salida nueva obliga a tocar este archivo
 * y a escribir por que.
 *
 * SOBRE LA RUTA DEL CANAL POR API KEY. `design.md` §6 (decision b) contemplaba
 * nombrar aqui `app/api/ordenes/api-key/cotizacion/route.ts` como excepcion
 * prevista al barrido de pantallas. Resulto INNECESARIA: el route handler NO
 * importa el formateador, porque el formateo ocurre entero en `lib/` (el service
 * compone los importes y la ruta solo devuelve el JSON ya hecho). Asi que la
 * afirmacion de abajo es la fuerte —ninguna pantalla lo importa, CERO
 * excepciones— y el propio barrido de `app/**` vigila esa ruta: si algun dia
 * alguien mueve el formateo al handler, esta guardia se pone roja. No se declara
 * una excepcion que el codigo no necesita.
 */
const SALIDAS_DE_MAQUINA: readonly { ruta: string; porque: string }[] = [
  {
    ruta: "lib/utils/monto-cotizacion.ts",
    porque:
      "importes del contrato JSON de la cotizacion por API key (feature 255, enmendada por la ficha 319): los lee un integrador, no una persona, y un precio servido como respuesta no puede perder centimos por el camino. Desde la 319 viajan CRUDOS, en money-safe de escala 2, el mismo dialecto que el `costoEnvio` de la carga",
  },
];

/** Un import de una salida de maquina, por el alias o por ruta relativa. */
const IMPORTA_SALIDA_DE_MAQUINA = /from\s+["'][^"']*\/monto-cotizacion["']/;

/** Los nombres de los SEIS caminos publicos, tal cual se exportan hoy. */
const EXPORTA_CAMINO_PUBLICO =
  /export\s+(?:async\s+)?(?:function|const|class)\s+(formatMontoString|money|formatMonto|PriceLabel|formatearValor)\b/;

/**
 * El PUNTO money-safe seguido de EXACTAMENTE dos digitos. Lo exigido a una salida
 * de maquina desde la ficha 319.
 *
 * Se escribe a mano, y aqui eso es correcto: hasta la 319 este regex se componia
 * desde `monedaConfig.separadorDecimal` porque la salida se formateaba con el
 * separador configurado. Ya no. El punto de un money-safe string no es
 * configuracion de presentacion —es la forma del dato en el contrato, como el
 * `YYYY-MM-DD` de una fecha—, asi que componerlo desde `monedaConfig` haria que
 * este diente se pusiera verde o rojo segun una variable de entorno que ya no
 * gobierna nada de lo que vigila.
 */
const EXACTAMENTE_DOS_DECIMALES = /\.\d\d$/;

/** La forma COMPLETA del money-safe: signo opcional, digitos, punto, dos digitos. */
const MONEY_SAFE_CRUDO = /^-?\d+\.\d{2}$/;

describe("guardia 359 · diente 6 — las salidas de maquina SI llevan centimos (255/R41)", () => {
  it("el censo existe, vive fuera de los arboles de pantalla y no es un camino publico (R40)", () => {
    expect(SALIDAS_DE_MAQUINA.length).toBeGreaterThan(0);
    for (const { ruta, porque } of SALIDAS_DE_MAQUINA) {
      expect(existsSync(path.join(RAIZ, ruta)), `${ruta} no existe`).toBe(true);
      expect(porque.length, `${ruta} esta censado sin motivo`).toBeGreaterThan(20);
      // R40: fuera de `app/**` y `components/**`, que es donde barre el diente 2.
      for (const arbol of ARBOLES_DE_PANTALLA) {
        expect(ruta.startsWith(`${arbol}/`), `${ruta} vive en un arbol de pantalla`).toBe(false);
      }
      // Y no es ninguno de los seis caminos publicos disfrazado: no exporta
      // ninguno de sus seis nombres.
      const nombrado = EXPORTA_CAMINO_PUBLICO.exec(codigo(ruta));
      expect(nombrado?.[1] ?? null, `${ruta} exporta un camino publico de dinero`).toBeNull();
    }
    // Los seis caminos publicos siguen siendo seis: si alguien añadiera uno,
    // el regex de arriba se quedaria corto sin que nadie lo notara.
    expect(CAMINOS_PUBLICOS).toBe(6);
  });

  it("ninguna pantalla importa una salida de maquina, sin excepciones (R40, R41)", () => {
    const hallazgos: string[] = [];
    for (const dir of ARBOLES_DE_PANTALLA) {
      for (const absoluta of listarFuentes(path.join(RAIZ, dir))) {
        const ruta = relativa(absoluta);
        lineasSinComentarios(readFileSync(absoluta, "utf8")).forEach((linea, indice) => {
          if (IMPORTA_SALIDA_DE_MAQUINA.test(linea)) hallazgos.push(`${ruta}:${indice + 1}`);
        });
      }
    }
    expect(
      hallazgos,
      "una pantalla consumio el formateador de la cotizacion: el dinero que se PINTA va sin centimos y sale de `@/lib/config/moneda`",
    ).toEqual([]);

    // El route handler del canal por API key entra en ese barrido —vive en
    // `app/**`— y hoy pasa porque NO importa el formateador. Se ancla aqui para
    // que el barrido de arriba no pueda estar verde por no haber mirado el
    // fuente que la feature 255 añadio.
    const rutaDelCanal = "app/api/ordenes/api-key/cotizacion/route.ts";
    expect(existsSync(path.join(RAIZ, rutaDelCanal)), `${rutaDelCanal} no existe`).toBe(true);
    expect(IMPORTA_SALIDA_DE_MAQUINA.test(codigo(rutaDelCanal))).toBe(false);
  });

  it("el serializador de la cotizacion SI emite exactamente dos decimales (R35, R41)", () => {
    // La afirmacion en POSITIVO, que es el punto de este diente: si alguien
    // "alinea" el modulo con las pantallas y le quita los centimos, esto se pone
    // ROJO y la cotizacion no pierde dinero en silencio.
    expect(CORPUS_STRING.length).toBeGreaterThan(100);
    const sinLosDosDecimales = CORPUS_STRING.filter(
      (entrada) =>
        !EXACTAMENTE_DOS_DECIMALES.test(serializarMontoCotizacion(new Prisma.Decimal(entrada))),
    );
    expect(
      sinLosDosDecimales,
      "el serializador de la cotizacion dejo de emitir los dos decimales del contrato",
    ).toEqual([]);
  });

  it("y los emite CRUDOS: money-safe, sin simbolo ni miles agrupados (ficha 319)", () => {
    // La otra mitad de la enmienda. El diente de arriba solo exige la cola de dos
    // decimales, que un `₡13.331.832,72` tambien cumpliria; esto fija la forma
    // ENTERA, que es lo que el integrador parsea.
    const noCrudos = CORPUS_STRING.filter(
      (entrada) => !MONEY_SAFE_CRUDO.test(serializarMontoCotizacion(new Prisma.Decimal(entrada))),
    );
    expect(
      noCrudos,
      "el serializador de la cotizacion volvio a formatear: el contrato JSON sirve money-safe crudo",
    ).toEqual([]);

    // Y no era un regex que aceptase cualquier cosa: la forma ANTERIOR se caza.
    expect(MONEY_SAFE_CRUDO.test(`${monedaConfig.simbolo}13.331.832,72`)).toBe(false);
  });

  it("y convive con las pantallas: donde se separan es en el importe REDONDO", () => {
    // Las dos cosas a la vez y sobre los mismos numeros, para que la coexistencia
    // quede escrita y no se relea como una incoherencia.
    //
    // FICHA 359 — el ejemplo tuvo que cambiar. Hasta la 359 bastaba un importe
    // CON cola para separarlos (la maquina la conservaba, la pantalla no); ahora
    // ahi coinciden en el fondo y solo se distinguen en la forma. La diferencia
    // de verdad esta en el importe REDONDO: el contrato JSON sigue emitiendo
    // `.00` porque un integrador parsea una forma fija, y la pantalla no lo pinta
    // porque una persona no lee ceros que no dicen nada.
    const redondo = "1578.00";
    expect(serializarMontoCotizacion(new Prisma.Decimal(redondo))).toBe(redondo);
    expect(formatMontoString(redondo)).not.toMatch(CON_DECIMAL);

    // Y con cola coinciden en la cifra, no en el formato: la maquina la sirve
    // cruda y sin simbolo, la pantalla agrupada y con el.
    const conCola = "13331832.72";
    expect(serializarMontoCotizacion(new Prisma.Decimal(conCola))).toBe(conCola);
    expect(formatMontoString(conCola)).toMatch(CON_DECIMAL);
    expect(formatMontoString(conCola)).not.toBe(conCola);
  });

  it("CONTRAPRUEBA: un modulo que DEJARA de emitir decimales seria cazado", () => {
    // La mutacion escrita dentro del test, como la del diente 3: alguien pasa el
    // serializador de la cotizacion por el camino publico de las pantallas para
    // "unificar el aspecto del dinero". El detector dispara en todo el corpus.
    const serializadorAlineadoConLasPantallas = (valor: Prisma.Decimal): string =>
      formatMontoString(valor.toFixed(2));

    const cazados = CORPUS_STRING.filter(
      (entrada) =>
        !EXACTAMENTE_DOS_DECIMALES.test(
          serializadorAlineadoConLasPantallas(new Prisma.Decimal(entrada)),
        ),
    );
    expect(cazados.length).toBeGreaterThan(100);

    // Y el detector de imports caza a una pantalla que lo consumiera...
    const ficticio = `
      import { serializarMontoCotizacion } from "@/lib/utils/monto-cotizacion";
      export function Celda({ monto }: { monto: Prisma.Decimal }) { return serializarMontoCotizacion(monto); }
    `;
    expect(IMPORTA_SALIDA_DE_MAQUINA.test(quitarComentarios(ficticio))).toBe(true);
    // ...sin denunciar un import cualquiera del modulo de moneda.
    expect(IMPORTA_SALIDA_DE_MAQUINA.test(`import { money } from "@/lib/config/moneda";`)).toBe(
      false,
    );
  });
});
