import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  derivarCaja,
  derivarComposicionGanancia,
  NATURALEZA_POR_CATEGORIA,
} from "@/lib/utils/caja-tesoreria";
import { montoEscala2 } from "@/lib/utils/monto-escala-2";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import {
  WALLET_EGRESO_CON_FILA_SEED,
  WALLET_EGRESO_DESGLOSADO_SEED,
  WALLET_EGRESO_NOMBRADO_SEED,
  WALLET_INGRESO_PROPIO_SEED,
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/** Raiz del repo, para los barridos de FUENTE del segundo oficio (menor 4). */
const RAIZ_231 = path.resolve(__dirname, "../../..");

/**
 * Feature 231 (T1.5) — GUARDIA: **la particion de la ganancia cubre el catalogo entero.**
 * Cubre **R23, R26 y R32**.
 *
 * POR QUE EXISTE. La tarjeta nueva enseña «ingresos − egresos = ganancia» con las dos columnas
 * abiertas concepto por concepto. Si una categoria propia se quedara fuera de la particion, la
 * resta NO cuadraria en pantalla y nadie lo notaria hasta que un humano sumara a mano: el total
 * seguiria siendo un numero plausible. Es exactamente lo que ya pasa hoy con
 * `DesgloseEgresosDTO`, que cubre cuatro de las siete categorias de egreso propio — y el hueco
 * es el pago a los mensajeros, que no es pequeño. De ahi D2 y de ahi `otrosEgresos`.
 *
 * POR QUE EN RUNTIME Y NO CON `tsc`. La naturaleza de una categoria es un VALOR
 * (`NATURALEZA_POR_CATEGORIA`), no un tipo: TypeScript puede obligar a que la tabla sea TOTAL
 * sobre el union —y lo hace—, pero no puede afirmar que el seed de ingresos propios contenga
 * exactamente las categorias que esa tabla marca `propio`. Eso solo se sabe ejecutando.
 *
 * COMO SE AUTO-COMPRUEBA. Las afirmaciones de cobertura son afirmaciones de AUSENCIA («no
 * queda ninguna categoria sin cubrir»), y una ausencia solo prueba algo si el detector sabe
 * ENCONTRAR. Por eso el detector es una funcion propia, `categoriasSinCubrir`, y se ejercita en
 * las DOS direcciones: verde sobre el catalogo real, y ROJO sobre un catalogo con una categoria
 * inventada. Sin esa segunda mitad, un detector roto pasaria en verde por no mirar nada.
 *
 * La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin lista central.
 */

/** El tipo de una categoria se lee de su prefijo, igual que en la suite de la 173. */
function tipoDe(categoria: string): AgregadoCajaRow["tipo"] {
  return categoria.startsWith("ingreso_") ? "ingreso" : "egreso";
}

/**
 * Las categorias de egreso propio que hoy caen en «otros gastos». NO es la definicion —la
 * definicion es el complemento, y vive en `derivarComposicionGanancia`—: es la FOTO de lo que
 * ese complemento vale hoy, escrita a mano para que el detector pueda ponerse rojo si mañana
 * aparece una categoria que nadie recoge. T3.1 exige que la lista salga de recorrer
 * `NATURALEZA_POR_CATEGORIA`, y eso es lo que hace el primer `it` de este archivo: la deriva y
 * la compara contra esta foto.
 *
 * FICHA 339 (T2.3) — la foto pasa de TRES categorias a UNA, y el motivo es el objeto de la
 * ficha: `egreso_pago_mensajero` y `egreso_ajuste` ganan FILA PROPIA en la columna, asi que
 * dejan de ser residuo. Queda `egreso_gasto`, categoria RESERVADA sin un solo escritor en el
 * arbol (medido: solo aparece en `lib/types/wallet.ts` y en los catalogos de
 * `lib/analytics/metrics.ts`). Consecuencia buscada: en produccion «Otros» vale 0,00 y no se
 * pinta, y el dia que muestre un importe significara literalmente «entro dinero de un concepto
 * que nadie ha decidido como se llama». La suma de la columna deja de ser «4 conceptos + otros»
 * y pasa a ser «4 conceptos + 2 nombrados + otros»; el TOTAL no se mueve un centimo.
 */
const OTROS_EGRESOS_DE_ORDENEX = ["egreso_gasto"];

/**
 * EL DETECTOR. Dada una lista de categorias, devuelve las de naturaleza `propio` que la
 * particion de `ComposicionGananciaDTO` NO sabria colocar:
 *
 *  - un INGRESO propio esta cubierto si es una fila del desglose (`WALLET_INGRESO_PROPIO_SEED`);
 *  - un EGRESO propio esta cubierto si es uno de los cuatro conceptos de `DesgloseEgresosDTO`
 *    (`WALLET_EGRESO_DESGLOSADO_SEED`) o si cae en «otros gastos de Ordenex», que es el
 *    COMPLEMENTO — y por eso los egresos no pueden quedarse fuera por construccion.
 *
 * El dinero de TERCEROS no entra en la ganancia y no tiene que estar cubierto por nadie: es
 * justo lo que la tarjeta declara que deja fuera (R29).
 */
function categoriasSinCubrir(categorias: readonly string[]): string[] {
  const ingresosCubiertos = new Set<string>(WALLET_INGRESO_PROPIO_SEED);
  const egresosCubiertos = new Set<string>([
    // Ficha 339: el conjunto CON FILA (los cuatro del desglose + los dos nombrados) mas lo
    // que sigue cayendo en el complemento.
    ...WALLET_EGRESO_CON_FILA_SEED,
    ...OTROS_EGRESOS_DE_ORDENEX,
  ]);
  const naturaleza = NATURALEZA_POR_CATEGORIA as Readonly<Record<string, string | undefined>>;

  return categorias.filter((categoria) => {
    if (naturaleza[categoria] !== "propio") return false;
    return tipoDe(categoria) === "ingreso"
      ? !ingresosCubiertos.has(categoria)
      : !egresosCubiertos.has(categoria);
  });
}

/** Un importe distinto por categoria: ningun par de cifras se puede confundir. */
function importeDe(indice: number): string {
  return `${(indice + 1) * 101}.00`;
}

/** Una fila del agregado por cada categoria del catalogo, con importes todos distintos. */
const LIBRO_COMPLETO: AgregadoCajaRow[] = WALLET_MOVIMIENTO_CATEGORIA_SEED.map((categoria, i) => ({
  categoria,
  tipo: tipoDe(categoria),
  total: importeDe(i),
}));

describe("R32 — la clasificacion por naturaleza cubre el SEED entero (runtime)", () => {
  it("CONTROL DE NO-VACUIDAD: el catalogo tiene categorias, y de las DOS naturalezas", () => {
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED.length).toBeGreaterThan(10);
    const naturalezas = WALLET_MOVIMIENTO_CATEGORIA_SEED.map((c) => NATURALEZA_POR_CATEGORIA[c]);
    expect(new Set(naturalezas)).toEqual(new Set(["propio", "terceros"]));
  });

  it("R32: toda categoria del catalogo tiene una naturaleza declarada, sin huecos", () => {
    const sinNaturaleza = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => NATURALEZA_POR_CATEGORIA[c] === undefined,
    );
    expect(sinNaturaleza).toEqual([]);
  });
});

describe("R23/R26 — la particion de la ganancia cubre TODAS las categorias propias", () => {
  it("R23/R26: ninguna categoria propia del catalogo se queda fuera de la particion", () => {
    expect(categoriasSinCubrir(WALLET_MOVIMIENTO_CATEGORIA_SEED)).toEqual([]);
  });

  it("AUTO-COMPROBACION: el detector SE PONE ROJO con una categoria que nadie cubre", () => {
    // La mutacion que la task pide: una categoria añadida al SEED (aqui, a una copia local del
    // SEED, para no tocar el catalogo real) tiene que salir nombrada. Se prueban las DOS
    // mitades del detector —un ingreso y un egreso—, porque cada una usa un conjunto distinto.
    const naturalezaAmpliada = NATURALEZA_POR_CATEGORIA as unknown as Record<string, string>;
    naturalezaAmpliada.ingreso_concepto_inventado = "propio";
    naturalezaAmpliada.egreso_concepto_inventado = "propio";
    naturalezaAmpliada.ingreso_de_una_tienda_inventada = "terceros";
    try {
      const seedAmpliado = [
        ...WALLET_MOVIMIENTO_CATEGORIA_SEED,
        "ingreso_concepto_inventado",
        "egreso_concepto_inventado",
        "ingreso_de_una_tienda_inventada",
      ];

      // Las dos propias salen nombradas; la de TERCEROS no, porque no entra en la ganancia.
      expect(categoriasSinCubrir(seedAmpliado)).toEqual([
        "ingreso_concepto_inventado",
        "egreso_concepto_inventado",
      ]);
    } finally {
      delete naturalezaAmpliada.ingreso_concepto_inventado;
      delete naturalezaAmpliada.egreso_concepto_inventado;
      delete naturalezaAmpliada.ingreso_de_una_tienda_inventada;
    }

    // Y el catalogo real queda como estaba: la mutacion no se filtra a los demas casos.
    expect(Object.keys(NATURALEZA_POR_CATEGORIA).sort()).toEqual(
      [...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort(),
    );
  });

  it("T3.1: las categorias de «otros gastos» se DERIVAN del catalogo, no de una copia a mano", () => {
    // Se recorre `NATURALEZA_POR_CATEGORIA` en runtime y se restan los egresos propios que
    // tienen FILA PROPIA. El resultado tiene que ser exactamente la foto declarada arriba: si
    // mañana el catalogo gana un egreso propio sin fila, este caso lo nombra.
    const derivadas = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) =>
        NATURALEZA_POR_CATEGORIA[c] === "propio" &&
        tipoDe(c) === "egreso" &&
        !(WALLET_EGRESO_CON_FILA_SEED as readonly string[]).includes(c),
    );

    expect([...derivadas].sort()).toEqual([...OTROS_EGRESOS_DE_ORDENEX].sort());
    // Control de no-vacuidad del `toEqual`: la lista NO esta vacia — sigue habiendo un hueco,
    // y es exactamente `egreso_gasto` (ficha 339, T2.3).
    expect(derivadas.length).toBe(1);
    expect(derivadas).toEqual(["egreso_gasto"]);
  });

  it("R13 (ficha 339): los dos egresos NOMBRADOS salieron del complemento de verdad", () => {
    // La afirmacion que la ficha existe para hacer cierta, medida sobre la DERIVACION y no
    // sobre una lista: las dos categorias que antes caian en «otros» ya no estan ahi, y estan
    // en el conjunto con fila. Si alguien las devolviera al cubo, este caso las nombra.
    const complemento = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) =>
        NATURALEZA_POR_CATEGORIA[c] === "propio" &&
        tipoDe(c) === "egreso" &&
        !(WALLET_EGRESO_CON_FILA_SEED as readonly string[]).includes(c),
    );
    for (const categoria of WALLET_EGRESO_NOMBRADO_SEED) {
      expect(complemento, `${categoria} sigue en «otros»`).not.toContain(categoria);
      expect(WALLET_EGRESO_CON_FILA_SEED as readonly string[]).toContain(categoria);
    }
    // Y el seed CON FILA es la EXTENSION de los cuatro del desglose, sin repetidos.
    expect([...WALLET_EGRESO_CON_FILA_SEED]).toEqual([
      ...WALLET_EGRESO_DESGLOSADO_SEED,
      ...WALLET_EGRESO_NOMBRADO_SEED,
    ]);
    expect(new Set(WALLET_EGRESO_CON_FILA_SEED).size).toBe(WALLET_EGRESO_CON_FILA_SEED.length);
  });

  it("R23: el seed de ingresos propios es EXACTAMENTE el que dice la clasificacion", () => {
    const derivados = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => NATURALEZA_POR_CATEGORIA[c] === "propio" && tipoDe(c) === "ingreso",
    );
    expect([...WALLET_INGRESO_PROPIO_SEED].sort()).toEqual([...derivados].sort());
    expect(derivados.length).toBe(7); // D5: los seis del feed MAS el ajuste
  });
});

describe("R23/R26 — MEDIDO sobre el catalogo entero: las dos columnas cuadran", () => {
  it("R23: la Σ de las siete filas de ingresos es, importe a importe, `ingresosPropios`", () => {
    const caja = derivarCaja(LIBRO_COMPLETO);
    const composicion = derivarComposicionGanancia(LIBRO_COMPLETO);

    const suma = Object.values(composicion.ingresos).reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    expect(suma.toFixed(2)).toBe(composicion.totalIngresos);
    expect(composicion.totalIngresos).toBe(caja.ingresosPropios);
    // Control: el conjunto TIENE dinero de terceros, asi que `entradas` no puede ser igual.
    expect(caja.entradas).not.toBe(composicion.totalIngresos);
  });

  it("R11 (ficha 339): los cuatro conceptos + los dos nombrados + «otros» suman `egresosPropios`", async () => {
    // La mitad de la izquierda se mide por el camino REAL de la 45/158
    // (`WalletMovimientoRepository.agregarPorCategoria`) y la de la derecha por el camino nuevo
    // (`derivarComposicionGanancia`), sobre EL MISMO libro. Es lo unico que prueba que las dos
    // columnas de la tarjeta cuadran de verdad, y no que dos funciones mias coincidan.
    const prisma = {
      walletMovimiento: {
        groupBy: vi.fn().mockResolvedValue(
          LIBRO_COMPLETO.map((f) => ({
            categoria: f.categoria,
            _sum: { monto: new Prisma.Decimal(f.total) },
          })),
        ),
      },
    };
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const desglose = await repo.agregarPorCategoria({});
    const caja = derivarCaja(LIBRO_COMPLETO);
    const composicion = derivarComposicionGanancia(LIBRO_COMPLETO);

    // Ficha 339 (T2.3): la columna ya no es «4 conceptos + otros», es «4 conceptos + los dos
    // NOMBRADOS + otros». Las filas se toman del seed y no a mano, para que un concepto nuevo
    // con fila entre aqui solo.
    const sumaDeLaColumna = [
      desglose.gastoFijo,
      desglose.gastoVariable,
      desglose.sueldo,
      desglose.indemnizacion,
      ...WALLET_EGRESO_NOMBRADO_SEED.map((c) => composicion.egresos[c]),
      composicion.otrosEgresos,
    ].reduce((s, v) => s.add(new Prisma.Decimal(v)), new Prisma.Decimal(0));

    expect(sumaDeLaColumna.toFixed(2)).toBe(composicion.totalEgresos);
    expect(composicion.totalEgresos).toBe(caja.egresosPropios);
    // Control de no-vacuidad de las filas nuevas: las DOS traen importe en este libro, asi que
    // la suma de arriba no puede estar cuadrando por sumar dos ceros.
    for (const categoria of WALLET_EGRESO_NOMBRADO_SEED) {
      expect(new Prisma.Decimal(composicion.egresos[categoria]).gt(0), categoria).toBe(true);
    }

    // Y la consecuencia FIRMADA en D2, medida: los cuatro conceptos SOLOS no llegan. Si esta
    // asercion cayera, «Otros gastos de Ordenex» habria dejado de hacer falta… o de sumar.
    const soloLosCuatro = [
      desglose.gastoFijo,
      desglose.gastoVariable,
      desglose.sueldo,
      desglose.indemnizacion,
    ].reduce((s, v) => s.add(new Prisma.Decimal(v)), new Prisma.Decimal(0));
    expect(soloLosCuatro.toFixed(2)).not.toBe(composicion.totalEgresos);
    expect(new Prisma.Decimal(composicion.otrosEgresos).gt(0)).toBe(true);
  });

  it("R13: cada categoria propia aporta a UNA sola cubeta, nunca a dos", () => {
    // Se comprueba fila a fila: quitar una categoria del libro tiene que bajar exactamente su
    // importe de UNA de las dos columnas, y dejar la otra intacta. Un doble conteo —o una
    // categoria contada en «otros» Y en su concepto— cae aqui con el importe a la vista.
    const completo = derivarComposicionGanancia(LIBRO_COMPLETO);

    for (const [i, categoria] of WALLET_MOVIMIENTO_CATEGORIA_SEED.entries()) {
      const sinElla = derivarComposicionGanancia(
        LIBRO_COMPLETO.filter((f) => f.categoria !== categoria),
      );
      const importe = new Prisma.Decimal(importeDe(i));
      const caidaIngresos = new Prisma.Decimal(completo.totalIngresos).minus(
        sinElla.totalIngresos,
      );
      const caidaEgresos = new Prisma.Decimal(completo.totalEgresos).minus(sinElla.totalEgresos);

      const esperado = esperadoDe(categoria, importe);
      expect(caidaIngresos.toFixed(2), `${categoria} en ingresos`).toBe(esperado.ingresos);
      expect(caidaEgresos.toFixed(2), `${categoria} en egresos`).toBe(esperado.egresos);

      // Ficha 339 (R13) — y AHORA, cubeta a cubeta: quitar una categoria tiene que vaciar SU
      // cubeta y no rozar ninguna otra. La version anterior solo miraba los dos totales, y un
      // importe contado a la vez en su fila y en «otros» habria subido `totalEgresos` en el
      // doble… pero tambien lo habria hecho el libro completo, asi que se compensaba. Esto no.
      for (const nombrada of WALLET_EGRESO_NOMBRADO_SEED) {
        const esperadaCubeta = nombrada === categoria ? "0.00" : completo.egresos[nombrada];
        expect(sinElla.egresos[nombrada], `${categoria} movio la cubeta ${nombrada}`).toBe(
          esperadaCubeta,
        );
      }
      const otrosEsperado =
        (OTROS_EGRESOS_DE_ORDENEX as readonly string[]).includes(categoria)
          ? new Prisma.Decimal(completo.otrosEgresos).minus(importe).toFixed(2)
          : completo.otrosEgresos;
      expect(sinElla.otrosEgresos, `${categoria} movio «otros»`).toBe(otrosEsperado);
    }
  });
});

/** Cuanto debe bajar cada total al quitar `categoria` del libro. */
function esperadoDe(
  categoria: WalletMovimientoCategoria,
  importe: Prisma.Decimal,
): { ingresos: string; egresos: string } {
  const cero = "0.00";
  if (NATURALEZA_POR_CATEGORIA[categoria] !== "propio") return { ingresos: cero, egresos: cero };
  return tipoDe(categoria) === "ingreso"
    ? { ingresos: importe.toFixed(2), egresos: cero }
    : { ingresos: cero, egresos: importe.toFixed(2) };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// SEGUNDO OFICIO — el barrido MONEY-SAFE de `lib/utils/monto-escala-2.ts`.
// (menor 4 de `progress/review_231.md`; el humano firmó que el módulo se queda.)
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * POR QUÉ ESTE MÓDULO NECESITA RED PROPIA. `lib/utils/monto-escala-2.ts` nació de una excepción:
 * `tests/unit/utils/caja-tesoreria.test.ts` («R7: el modulo NO tiene ni una llamada capaz de
 * convertir un monto a numero») prohíbe el literal `.toFixed(` en `lib/utils/caja-tesoreria.ts`,
 * y la 231 necesita emitir desde ahí once importes y un porcentaje. La conversión se sacó a un
 * módulo de tres líneas en vez de relajar aquella aserción —debilitar una aserción de dinero de
 * otra feature es firma humana, no arreglo de paso—. El precio de esa salida es que el módulo
 * nuevo quedaba SIN CENSAR: hoy sólo contiene `Decimal#toFixed(2)` y mañana nada impedía que
 * entrara ahí un `Number(`. Esto lo impide.
 *
 * POR QUÉ AQUÍ Y NO EN OTRO SITIO, mirado antes de decidir:
 *
 *  - **No en `tests/unit/guards/liquidacion-money-safe.test.ts`**: su censo declara «los archivos
 *    que la 172 creó o modificó» y se valida contra los árboles de liquidación. Meterle un módulo
 *    de la caja convertiría esa afirmación en mentira — es literalmente el motivo que la guardia
 *    de la 204 escribió para vivir aparte (`ordenes-columnas-money-safe.guardia.test.ts`).
 *  - **No en `tests/unit/utils/caja-tesoreria.test.ts`**, que es quien barre al módulo padre: ese
 *    archivo NO lo selecciona `pnpm exec vitest run guard`, así que el barrido sólo correría
 *    cuando el grafo de imports lo arrastrase. Un barrido de FUENTE que dependa del grafo es
 *    exactamente lo que `docs/verification.md` dice que se pierde.
 *  - **No una guardia nueva**: ésta ya es la guardia de la derivación de la caja de la 231, y el
 *    módulo existe por esa derivación. Se declara el segundo oficio en vez de fundirlo con el
 *    primero.
 *
 * EL CRITERIO, y en qué se diferencia del de su módulo padre: aquí `.toFixed(` **se permite** —es
 * el oficio del módulo, y sobre un `Prisma.Decimal` es exacto—, y a cambio se prohíbe todo lo que
 * saca un monto de `Decimal` y lo mete en un `number`, incluido `.toNumber(`, que la lista
 * genérica `LLAMADAS_PROHIBIDAS_EN_DINERO` no persigue. La excepción queda acotada a tres líneas
 * vigiladas en vez de acotada a la buena voluntad.
 */

const FUENTE_CONVERSION = "lib/utils/monto-escala-2.ts";

/** Las cuatro formas de sacar un monto de `Prisma.Decimal` y meterlo en un `number`. */
const CONVERSIONES_PROHIBIDAS: readonly { nombre: string; re: RegExp }[] = [
  { nombre: "Number(", re: /\bNumber\s*\(/ },
  { nombre: "parseFloat(", re: /\bparseFloat\s*\(/ },
  { nombre: "parseInt(", re: /\bparseInt\s*\(/ },
  { nombre: ".toNumber(", re: /\.toNumber\s*\(/ },
];

/** Bibliotecas de decimales que este módulo NO necesita: su única entrada YA es un `Decimal`. */
const BIBLIOTECAS_PROHIBIDAS: readonly { nombre: string; re: RegExp }[] = [
  { nombre: "decimal.js", re: /["']decimal\.js["']/ },
  { nombre: "big.js", re: /["']big\.js["']/ },
];

/** EL DETECTOR: qué llamadas prohibidas hay en este código. Se usa en las dos direcciones. */
function conversionesEn(codigo: string): string[] {
  return CONVERSIONES_PROHIBIDAS.filter(({ re }) => re.test(codigo)).map(({ nombre }) => nombre);
}

/** Un código de mentira con las cuatro llamadas dentro. Es el control POSITIVO del detector. */
const CODIGO_CON_LAS_CUATRO = [
  "const a = Number(monto);",
  "const b = parseFloat(monto);",
  "const c = parseInt(monto, 10);",
  "const d = decimal.toNumber();",
].join("\n");

/**
 * Un código de mentira que CITA lo prohibido sin llamarlo. Es el control NEGATIVO: los docstrings
 * de este árbol nombran a propósito lo que persiguen («money-safe: sin parseFloat/Number»), y un
 * barrido que fallara por citarlo sería inservible.
 */
const CODIGO_QUE_SOLO_LO_CITA = [
  "export const NOTA = 'money-safe: sin parseFloat, sin Number, sin parseInt, sin toNumber';",
  "const numberOfRows = filas.length;",
  "const parseFloatingWindow = 1;",
].join("\n");

describe("menor 4 — `lib/utils/monto-escala-2.ts` no convierte un monto a número", () => {
  it("CONTROL DE NO-VACUIDAD: el módulo existe, tiene contenido y sigue siendo el que convierte", () => {
    // Sin esto, las afirmaciones de ausencia de abajo podrían estar barriendo un archivo borrado,
    // vacío o renombrado — y saldrían verdes por no mirar nada.
    expect(existsSync(path.join(RAIZ_231, FUENTE_CONVERSION))).toBe(true);
    const crudo = readFileSync(path.join(RAIZ_231, FUENTE_CONVERSION), "utf8");
    expect(crudo.length).toBeGreaterThan(500);
    const fuente = codigoSinComentarios(FUENTE_CONVERSION);
    expect(fuente).toContain("export function montoEscala2");
    expect(fuente).toContain(".toFixed(2)"); // su oficio, y la razón de que exista
  });

  it("AUTO-COMPROBACIÓN del detector: caza la LLAMADA y no caza la CITA", () => {
    // La trampa que este repo ya se comió: una expresión regular que llega mutilada al comparador
    // (un `\b` convertido en backspace por una capa de escapado) no casa nada y el censo sale
    // verde por no encontrar. Aquí el detector se mide contra dos respuestas conocidas y escritas
    // a mano, en las DOS direcciones.
    expect(conversionesEn(CODIGO_CON_LAS_CUATRO).sort()).toEqual(
      [".toNumber(", "Number(", "parseFloat(", "parseInt("].sort(),
    );
    expect(conversionesEn(CODIGO_QUE_SOLO_LO_CITA)).toEqual([]);

    // Y cada expresión, una por una: ninguna puede estar muerta dentro del conjunto.
    for (const { nombre, re } of CONVERSIONES_PROHIBIDAS) {
      expect(re.test(CODIGO_CON_LAS_CUATRO), `la expresión de ${nombre} no caza su llamada`).toBe(
        true,
      );
      expect(re.test(CODIGO_QUE_SOLO_LO_CITA), `la expresión de ${nombre} caza una cita`).toBe(
        false,
      );
    }
    // Lo mismo para las bibliotecas: el detector encuentra un import de verdad y deja pasar el
    // único que este módulo sí necesita.
    for (const { nombre, re } of BIBLIOTECAS_PROHIBIDAS) {
      expect(re.test(`import Decimal from "${nombre}";`), nombre).toBe(true);
      expect(re.test('import { Prisma } from "@prisma/client";'), nombre).toBe(false);
    }
  });

  it("menor 4: ni una llamada capaz de convertir un monto a número", () => {
    expect(conversionesEn(codigoSinComentarios(FUENTE_CONVERSION))).toEqual([]);
  });

  it("menor 4: ni una biblioteca de decimales de más — su única entrada ya es un `Decimal`", () => {
    const fuente = codigoSinComentarios(FUENTE_CONVERSION);
    for (const { nombre, re } of BIBLIOTECAS_PROHIBIDAS) {
      expect(re.test(fuente), `${FUENTE_CONVERSION} importa ${nombre}`).toBe(false);
    }
    // Control de no-vacuidad del `false`: el archivo SÍ importa lo único que necesita.
    expect(fuente).toMatch(/import\s*\{\s*Prisma\s*\}\s*from\s*"@prisma\/client"/);
  });

  it("menor 4 MEDIDO: el `.toFixed(` que se permite es exacto — no pierde un céntimo", () => {
    // La prohibición se levanta para UNA llamada concreta, así que se mide que esa llamada hace
    // lo que se dice que hace, en los dos sitios donde un `number` sí fallaría:
    //   (a) 0.1 + 0.2, que en coma flotante da 0.30000000000000004;
    //   (b) un importe de 11 dígitos, que no cabe exacto en un `double`.
    expect(montoEscala2(new Prisma.Decimal("0.1").add("0.2"))).toBe("0.30");
    expect(montoEscala2(new Prisma.Decimal("98765432109.87"))).toBe("98765432109.87");
    // Escala 2 SIEMPRE, también en el cero y en el negativo (lo que `toString()` no daría).
    expect(montoEscala2(new Prisma.Decimal(0))).toBe("0.00");
    expect(montoEscala2(new Prisma.Decimal("-1.5"))).toBe("-1.50");
    // Y la firma: un solo parámetro, y ese parámetro es un `Decimal`. No hay por dónde colarle un
    // `number` sin que `tsc` lo rechace.
    expect(montoEscala2.length).toBe(1);
  });

  it("CONTRAPRUEBA: el mismo barrido SÍ nombra la llamada cuando está dentro del archivo real", () => {
    // La contraprueba sobre el CÓDIGO REAL, no sobre una cadena suelta: se le pega al final del
    // módulo la llamada prohibida y se comprueba que el detector la encuentra. Es la forma en
    // memoria de la mutación que se ejecutó sobre el disco (bitácora §6).
    const real = codigoSinComentarios(FUENTE_CONVERSION);
    expect(conversionesEn(real)).toEqual([]); // hoy, limpio
    expect(conversionesEn(`${real}\nconst colado = Number(valor);`)).toEqual(["Number("]);
    expect(conversionesEn(`${real}\nconst colado = valor.toNumber();`)).toEqual([".toNumber("]);
  });
});
