import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  categoriasDeFilaComposicion,
  derivarCaja,
  derivarComposicionGanancia,
  NATURALEZA_POR_CATEGORIA,
} from "@/lib/utils/caja-tesoreria";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import {
  COMPOSICION_FILA_OTROS,
  WALLET_EGRESO_CON_FILA_SEED,
  WALLET_EGRESO_DESGLOSADO_SEED,
  WALLET_EGRESO_NOMBRADO_SEED,
  WALLET_INGRESO_PROPIO_SEED,
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type ModoComposicionCaja,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

/**
 * Feature 231 (T1.4) — la caja partida en DOS BOLSILLOS y la ganancia abierta concepto por
 * concepto. Cubre **R10, R14-R19, R23, R26** y la no-regresion **R38** (T7.2).
 *
 * Todo se mide, nada se afirma por ausencia (design §7): para cada modo hay un conjunto de
 * filas con los signos que lo provocan y el porcentaje exacto que se espera. Los importes de
 * cada conjunto son DISTINTOS entre si —y distintos de los de los demas conjuntos— para que
 * ninguna asercion pueda pasar por confundir dos cifras, que es la trampa que la suite de la
 * 173 ya documento. Ningun caso pasa por el conjunto vacio: el `it` de no-vacuidad lo afirma.
 */

const fila = (
  categoria: WalletMovimientoCategoria,
  total: string,
): AgregadoCajaRow => ({
  categoria,
  tipo: categoria.startsWith("ingreso_") ? "ingreso" : "egreso",
  total,
});

/**
 * Un conjunto con la ganancia `G` y el dinero de terceros `T` que se pidan. El colchon de la
 * cubeta PROPIA (1 700) y el de la de TERCEROS (5 300) son distintos a proposito: ninguna
 * cifra de una naturaleza puede confundirse con la de la otra. Es lo que permite recorrer los
 * nueve pares de signos sin escribir nueve conjuntos a mano.
 */
function conjuntoCon(g: string, t: string): AgregadoCajaRow[] {
  const ganancia = new Prisma.Decimal(g);
  const terceros = new Prisma.Decimal(t);
  // Un colchon distinto por cubeta: los cuatro importes salen siempre distintos y positivos.
  const ingresoPropio = ganancia.add(1700);
  const egresoPropio = new Prisma.Decimal(1700);
  const ingresoTerceros = terceros.add(5300);
  const egresoTerceros = new Prisma.Decimal(5300);
  return [
    fila("ingreso_flete", ingresoPropio.toFixed(2)),
    fila("egreso_gasto", egresoPropio.toFixed(2)),
    fila("ingreso_cod_recaudado", ingresoTerceros.toFixed(2)),
    fila("egreso_pago_tienda", egresoTerceros.toFixed(2)),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Los cuatro conjuntos con nombre. Cada uno provoca UN modo, y sus importes no se repiten.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** R10/R19 — G = 2 000, T = 10 000, enCaja = 12 000. El caso del lienzo. */
const DOS_BOLSILLOS: AgregadoCajaRow[] = [
  fila("ingreso_flete", "5000.00"),
  fila("egreso_gasto", "3000.00"),
  fila("ingreso_cod_recaudado", "10000.00"),
];

/** R15 — G = −900, T = 4 500: Ordenex pierde y el dinero de las tiendas cubre el saldo. */
const SOLO_TIENDAS: AgregadoCajaRow[] = [
  fila("ingreso_flete", "400.00"),
  fila("egreso_gasto", "1300.00"),
  fila("ingreso_cod_recaudado", "7000.00"),
  fila("egreso_pago_tienda", "2500.00"),
];

/** R17 — G = 5 600, T = −1 900: el espejo (D4), se pago a las tiendas mas de lo recaudado. */
const SOLO_ORDENEX: AgregadoCajaRow[] = [
  fila("ingreso_flete", "6400.00"),
  fila("egreso_gasto", "800.00"),
  fila("ingreso_cod_recaudado", "1200.00"),
  fila("egreso_pago_tienda", "3100.00"),
];

/** R18 — G = −1 500, T = −2 400: no hay nada que repartir. */
const SIN_REPARTO: AgregadoCajaRow[] = [
  fila("ingreso_flete", "250.00"),
  fila("egreso_gasto", "1750.00"),
  fila("ingreso_cod_recaudado", "900.00"),
  fila("egreso_pago_tienda", "3300.00"),
];

describe("derivarCaja — el modo de composicion y la proporcion (R10/R14-R19)", () => {
  it("CONTROL DE NO-VACUIDAD: ningun conjunto de esta suite esta vacio ni suma cero", () => {
    // Sin esto, cualquiera de los `it` de abajo podria estar midiendo `derivarCaja([])`, que
    // cae en `sin_reparto` con porcentaje "0.00" y pasaria tres de las cuatro aserciones de
    // modo por pura casualidad.
    for (const [nombre, filas] of Object.entries({
      DOS_BOLSILLOS,
      SOLO_TIENDAS,
      SOLO_ORDENEX,
      SIN_REPARTO,
    })) {
      expect(filas.length, `${nombre} esta vacio`).toBeGreaterThan(2);
      const suma = filas.reduce((s, f) => s.add(new Prisma.Decimal(f.total)), new Prisma.Decimal(0));
      expect(suma.gt(0), `${nombre} suma cero`).toBe(true);
    }
  });

  it("R10: `dos_bolsillos`: 10 000 / 12 000 → 83.33", () => {
    const caja = derivarCaja(DOS_BOLSILLOS);

    // Las tres cifras que entran en la division, medidas antes de mirar el resultado: si el
    // conjunto no diera estos numeros, el 83.33 de abajo no probaria nada.
    expect(caja.deTerceros).toBe("10000.00");
    expect(caja.enCaja).toBe("12000.00");
    expect(caja.ganancia).toBe("2000.00");

    expect(caja.porcentajeTiendas).toBe("83.33"); // 10 000 / 12 000 x 100 = 83.333…
    expect(caja.modoComposicion).toBe("dos_bolsillos");
  });

  it("R15: ganancia negativa con dinero de tiendas → `solo_tiendas`", () => {
    const caja = derivarCaja(SOLO_TIENDAS);

    expect(caja.ganancia).toBe("-900.00");
    expect(caja.deTerceros).toBe("4500.00");
    expect(caja.enCaja).toBe("3600.00");
    // La porcion de las tiendas (4 500) es MAYOR que el total de la caja (3 600): la barra no
    // se puede partir sin mentir, asi que va entera de las tiendas.
    expect(caja.modoComposicion).toBe("solo_tiendas");
    expect(caja.porcentajeTiendas).toBe("100.00");
  });

  it("R17: `deTerceros` negativo → `solo_ordenex`", () => {
    const caja = derivarCaja(SOLO_ORDENEX);

    expect(caja.deTerceros).toBe("-1900.00");
    expect(caja.ganancia).toBe("5600.00");
    expect(caja.enCaja).toBe("3700.00");
    expect(caja.modoComposicion).toBe("solo_ordenex");
    expect(caja.porcentajeTiendas).toBe("0.00");
  });

  it("R18: nada que repartir → `sin_reparto`, sin porcentaje", () => {
    const caja = derivarCaja(SIN_REPARTO);

    expect(caja.ganancia).toBe("-1500.00");
    expect(caja.deTerceros).toBe("-2400.00");
    expect(caja.enCaja).toBe("-3900.00");
    expect(caja.modoComposicion).toBe("sin_reparto");
    expect(caja.porcentajeTiendas).toBe("0.00");
  });

  it("R14: los cuatro modos, uno por conjunto", () => {
    // El union entero se cubre, y con conjuntos DISTINTOS: ningun modo queda sin caso vivo y
    // ninguno se produce dos veces por el mismo camino.
    const medidos = [DOS_BOLSILLOS, SOLO_TIENDAS, SOLO_ORDENEX, SIN_REPARTO].map(
      (filas) => derivarCaja(filas).modoComposicion,
    );

    expect(medidos).toEqual(["dos_bolsillos", "solo_tiendas", "solo_ordenex", "sin_reparto"]);
    expect(new Set(medidos).size).toBe(4);
  });

  it("R19: el resto de conjuntos cae en `dos_bolsillos`", () => {
    // Los tres pares de signos que NO disparan ninguna de las tres primeras filas de la tabla:
    // (G>0, T>0), (G=0, T>0) y (G>0, T=0). Los tres tienen que llegar a la ultima fila, y en
    // los tres la division existe porque `enCaja` es estrictamente positivo.
    const casos: { g: string; t: string; porcentaje: string }[] = [
      { g: "1300.00", t: "2900.00", porcentaje: "69.05" }, // 2 900 / 4 200 = 69.047…
      { g: "0.00", t: "2900.00", porcentaje: "100.00" }, // la caja entera es de las tiendas
      { g: "1300.00", t: "0.00", porcentaje: "0.00" }, // …y aqui no hay nada de las tiendas
    ];

    for (const { g, t, porcentaje } of casos) {
      const caja = derivarCaja(conjuntoCon(g, t));
      expect(caja.ganancia, `G=${g} T=${t}`).toBe(new Prisma.Decimal(g).toFixed(2));
      expect(caja.deTerceros, `G=${g} T=${t}`).toBe(new Prisma.Decimal(t).toFixed(2));
      expect(caja.modoComposicion, `G=${g} T=${t}`).toBe("dos_bolsillos");
      expect(caja.porcentajeTiendas, `G=${g} T=${t}`).toBe(porcentaje);
    }
  });

  it("R14/R19: los NUEVE pares de signos caen en EXACTAMENTE una fila de la tabla", () => {
    // La tabla de design §3.1 se declara TOTAL. Aqui se ejecuta entera: tres signos de G por
    // tres de T. Los valores esperados estan escritos a mano —no derivados del propio codigo—,
    // que es lo unico que hace que este caso pueda ponerse rojo.
    const G = { neg: "-700.00", cero: "0.00", pos: "1300.00" };
    const T = { neg: "-1100.00", cero: "0.00", pos: "2900.00" };
    const esperado: [string, string, ModoComposicionCaja, string][] = [
      [G.neg, T.neg, "sin_reparto", "0.00"],
      [G.neg, T.cero, "sin_reparto", "0.00"],
      [G.neg, T.pos, "solo_tiendas", "100.00"],
      [G.cero, T.neg, "sin_reparto", "0.00"],
      [G.cero, T.cero, "sin_reparto", "0.00"],
      [G.cero, T.pos, "dos_bolsillos", "100.00"],
      [G.pos, T.neg, "solo_ordenex", "0.00"],
      [G.pos, T.cero, "dos_bolsillos", "0.00"],
      [G.pos, T.pos, "dos_bolsillos", "69.05"],
    ];

    for (const [g, t, modo, porcentaje] of esperado) {
      const caja = derivarCaja(conjuntoCon(g, t));
      expect(caja.modoComposicion, `G=${g} T=${t}`).toBe(modo);
      expect(caja.porcentajeTiendas, `G=${g} T=${t}`).toBe(porcentaje);
    }

    // Y la lectura que importa: el porcentaje NO identifica el modo. "0.00" sale en tres modos
    // distintos y "100.00" en dos, asi que la pantalla no puede deducir la forma de la barra a
    // partir de la proporcion (R21). Tiene que leer `modoComposicion`.
    const porCero = esperado.filter(([, , , p]) => p === "0.00").map(([, , m]) => m);
    expect(new Set(porCero).size).toBeGreaterThan(1);
    const porCien = esperado.filter(([, , , p]) => p === "100.00").map(([, , m]) => m);
    expect(new Set(porCien)).toEqual(new Set(["solo_tiendas", "dos_bolsillos"]));
  });

  it("R9/R10: el porcentaje es STRING de dos decimales, redondeado HALF_UP y dentro de 0–100", () => {
    // Un reparto que cae JUSTO en el medio del tercer decimal: 83 335 / 100 000 x 100 = 83.335.
    // Con HALF_UP sube a 83.34; con HALF_DOWN o truncando se quedaria en 83.33. Es la unica
    // forma de que esta asercion distinga un criterio de redondeo de otro.
    const enMedio = derivarCaja([
      fila("ingreso_flete", "16665.00"),
      fila("ingreso_cod_recaudado", "83335.00"),
    ]);
    expect(enMedio.enCaja).toBe("100000.00");
    expect(enMedio.deTerceros).toBe("83335.00");
    expect(enMedio.porcentajeTiendas).toBe("83.34");

    // Y uno periodico puro: 10 000 / 30 000 = 33.333…
    const periodico = derivarCaja([
      fila("ingreso_flete", "20000.00"),
      fila("ingreso_cod_recaudado", "10000.00"),
    ]);
    expect(periodico.porcentajeTiendas).toBe("33.33");

    // El rango, sobre TODOS los conjuntos de la suite: nunca por debajo de 0 ni por encima de
    // 100, y siempre con escala 2 (tambien en los extremos).
    for (const filas of [DOS_BOLSILLOS, SOLO_TIENDAS, SOLO_ORDENEX, SIN_REPARTO]) {
      const p = derivarCaja(filas).porcentajeTiendas;
      expect(p).toMatch(/^\d+\.\d{2}$/);
      expect(new Prisma.Decimal(p).gte(0)).toBe(true);
      expect(new Prisma.Decimal(p).lte(100)).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// La ganancia, concepto por concepto (R23/R26)
// ═════════════════════════════════════════════════════════════════════════════════════════

/** Las categorias PROPIAS del catalogo, partidas por tipo. Se leen del SEED, no a mano. */
const INGRESOS_PROPIOS = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
  (c) => NATURALEZA_POR_CATEGORIA[c] === "propio" && c.startsWith("ingreso_"),
);
const EGRESOS_PROPIOS = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
  (c) => NATURALEZA_POR_CATEGORIA[c] === "propio" && c.startsWith("egreso_"),
);

/** Un importe distinto por categoria: 101.00, 202.00, 303.00… Ningun par se puede confundir. */
function importeDe(indice: number): string {
  return `${(indice + 1) * 101}.00`;
}

describe("derivarComposicionGanancia — la ganancia concepto por concepto (R23/R26)", () => {
  it("CONTROL DE NO-VACUIDAD: el catalogo tiene categorias propias de los dos tipos", () => {
    expect(INGRESOS_PROPIOS.length).toBeGreaterThan(5);
    expect(EGRESOS_PROPIOS.length).toBeGreaterThan(5);
    // …y hay dinero de terceros que dejar fuera, que es la mitad del trabajo de esta funcion.
    expect(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter((c) => NATURALEZA_POR_CATEGORIA[c] === "terceros")
        .length,
    ).toBeGreaterThan(0);
  });

  it("R23: el desglose cubre todas las categorias propias y suma `ingresosPropios`", () => {
    // Un conjunto con TODAS las categorias del catalogo, una fila cada una y un importe
    // distinto por fila: si el desglose se dejara una, su total dejaria de cuadrar.
    const filas = WALLET_MOVIMIENTO_CATEGORIA_SEED.map((c, i) => fila(c, importeDe(i)));

    const caja = derivarCaja(filas);
    const composicion = derivarComposicionGanancia(filas);

    // (a) cada concepto lleva SU importe, no el del vecino.
    for (const categoria of INGRESOS_PROPIOS) {
      const indice = WALLET_MOVIMIENTO_CATEGORIA_SEED.indexOf(categoria);
      expect(composicion.ingresos[categoria as keyof typeof composicion.ingresos], categoria).toBe(
        importeDe(indice),
      );
    }
    // (b) el `Record` no tiene huecos ni claves de mas: son EXACTAMENTE las categorias de
    //     ingreso propio del catalogo.
    expect(Object.keys(composicion.ingresos).sort()).toEqual([...INGRESOS_PROPIOS].sort());
    // (c) el total de la columna es la Σ de sus propias filas…
    const sumaDeLasFilas = Object.values(composicion.ingresos).reduce(
      (s, v) => s.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    expect(sumaDeLasFilas.toFixed(2)).toBe(composicion.totalIngresos);
    // (d) …y es IDENTICO, importe a importe, a `ingresosPropios` (R23).
    expect(composicion.totalIngresos).toBe(caja.ingresosPropios);
    // (e) control: el dinero de las tiendas NO esta ahi dentro. `entradas` es mayor.
    expect(new Prisma.Decimal(caja.entradas).gt(composicion.totalIngresos)).toBe(true);
  });

  it("R26: la columna de egresos suma `egresosPropios`", () => {
    const filas = WALLET_MOVIMIENTO_CATEGORIA_SEED.map((c, i) => fila(c, importeDe(i)));

    const caja = derivarCaja(filas);
    const composicion = derivarComposicionGanancia(filas);

    // Los CUATRO conceptos que `DesgloseEgresosDTO` ya abre, sumados desde el mismo conjunto.
    const desglosados = WALLET_EGRESO_DESGLOSADO_SEED.reduce(
      (s, c) => s.add(new Prisma.Decimal(importeDe(WALLET_MOVIMIENTO_CATEGORIA_SEED.indexOf(c)))),
      new Prisma.Decimal(0),
    );
    // Y el complemento medido a mano: los egresos propios que no tienen FILA PROPIA (ficha
    // 339: ya no son «los que no estan entre los cuatro del desglose», son «los que no estan
    // entre los SEIS con fila»).
    const otrosEsperado = EGRESOS_PROPIOS.filter(
      (c) => !(WALLET_EGRESO_CON_FILA_SEED as readonly string[]).includes(c),
    ).reduce(
      (s, c) => s.add(new Prisma.Decimal(importeDe(WALLET_MOVIMIENTO_CATEGORIA_SEED.indexOf(c)))),
      new Prisma.Decimal(0),
    );
    const nombrados = WALLET_EGRESO_NOMBRADO_SEED.reduce(
      (s, c) => s.add(new Prisma.Decimal(composicion.egresos[c])),
      new Prisma.Decimal(0),
    );

    expect(composicion.otrosEgresos).toBe(otrosEsperado.toFixed(2));
    // La resta de la tarjeta cuadra: los cuatro conceptos + los dos NOMBRADOS + «otros gastos»
    // = el total…
    expect(
      desglosados.add(nombrados).add(new Prisma.Decimal(composicion.otrosEgresos)).toFixed(2),
    ).toBe(composicion.totalEgresos);
    // …y el total es IDENTICO a `egresosPropios` (R26). Esta es la asercion que D2 existe para
    // hacer posible: con solo los cuatro conceptos, la diferencia seria el pago al mensajero.
    expect(composicion.totalEgresos).toBe(caja.egresosPropios);
    // Sigue habiendo hueco de verdad —`egreso_gasto` tiene importe en este conjunto—, y las
    // dos filas nuevas tambien traen el suyo: la suma de arriba no cuadra sumando ceros.
    expect(new Prisma.Decimal(composicion.otrosEgresos).gt(0)).toBe(true);
    expect(nombrados.gt(0)).toBe(true);
    // El pago a la tienda es de TERCEROS: nunca entra en la columna de egresos de la ganancia.
    expect(new Prisma.Decimal(caja.salidas).gt(composicion.totalEgresos)).toBe(true);
  });

  it("R23/R26: la identidad se conserva en VARIOS conjuntos, no solo en el que los tiene todos", () => {
    const conjuntos: { nombre: string; filas: AgregadoCajaRow[] }[] = [
      { nombre: "dos bolsillos", filas: DOS_BOLSILLOS },
      { nombre: "solo tiendas", filas: SOLO_TIENDAS },
      { nombre: "solo ordenex", filas: SOLO_ORDENEX },
      { nombre: "sin reparto", filas: SIN_REPARTO },
      {
        nombre: "solo egresos propios, sin ningun ingreso",
        filas: EGRESOS_PROPIOS.map((c, i) => fila(c, importeDe(i + 3))),
      },
      {
        nombre: "el mismo concepto repetido en dos filas del agregado",
        filas: [
          fila("ingreso_flete", "120.00"),
          fila("ingreso_flete", "80.50"),
          fila("egreso_gasto", "15.25"),
        ],
      },
    ];

    for (const { nombre, filas } of conjuntos) {
      const caja = derivarCaja(filas);
      const composicion = derivarComposicionGanancia(filas);
      expect(composicion.totalIngresos, nombre).toBe(caja.ingresosPropios);
      expect(composicion.totalEgresos, nombre).toBe(caja.egresosPropios);
      // Y las siete filas siguen siendo STRING escala 2 aunque el conjunto no las mencione.
      for (const importe of Object.values(composicion.ingresos)) {
        expect(importe, nombre).toMatch(/^\d+\.\d{2}$/);
      }
    }

    // Control de la ultima fila: dos filas del MISMO concepto se acumulan, no se pisan.
    const repetido = derivarComposicionGanancia(conjuntos[5].filas);
    expect(repetido.ingresos.ingreso_flete).toBe("200.50");
    expect(repetido.totalIngresos).toBe("200.50");
  });

  it("R23: el conjunto VACIO da las siete cubetas en 0.00, nunca un hueco", () => {
    const composicion = derivarComposicionGanancia([]);
    expect(Object.keys(composicion.ingresos).sort()).toEqual([...WALLET_INGRESO_PROPIO_SEED].sort());
    for (const importe of Object.values(composicion.ingresos)) expect(importe).toBe("0.00");
    expect(composicion).toMatchObject({
      totalIngresos: "0.00",
      otrosEgresos: "0.00",
      totalEgresos: "0.00",
    });
    // Ficha 339 (T2.4): el `Record` de egresos tampoco tiene huecos con el libro vacio — la
    // pantalla recorre el seed, y una cubeta ausente se pintaria como «un importe vacio».
    expect(Object.keys(composicion.egresos).sort()).toEqual([...WALLET_EGRESO_NOMBRADO_SEED].sort());
    for (const importe of Object.values(composicion.egresos)) expect(importe).toBe("0.00");
    expect(composicion.hayOtrosEgresos).toBe(false);
  });
});

// =========================================================================================
// FICHA 343 (T2.4) — las filas nuevas, la bandera del servidor y las cifras que NO se mueven.
// =========================================================================================

/**
 * El libro con el que se miden las cubetas nuevas. Los importes son distintos entre si y
 * distintos de cualquier total del conjunto: ninguna asercion puede pasar confundiendo dos
 * cifras. `egreso_gasto` esta a proposito —es el UNICO residuo que queda tras la ficha— y el
 * pago a la tienda tambien, para que la particion tenga dinero de terceros que dejar fuera.
 */
const LIBRO_CON_LAS_FILAS_NUEVAS: AgregadoCajaRow[] = [
  fila("ingreso_flete", "7000.00"),
  fila("egreso_pago_mensajero", "227300.00"), // el caso REAL de produccion (9 movimientos)
  fila("egreso_ajuste", "45.75"),
  fila("egreso_sueldo", "1200.00"), // tiene fila en `DesgloseEgresosDTO`, no en `egresos`
  fila("egreso_gasto", "13.20"), // el residuo: lo unico que sigue cayendo en «otros»
  fila("egreso_pago_tienda", "9999.00"), // de TERCEROS: nunca entra en la ganancia
];

describe("ficha 343 — las filas nuevas de la columna de egresos (R4/R9/R12/R14)", () => {
  it("R4: cada cubeta de `egresos` suma SOLO su categoria", () => {
    const composicion = derivarComposicionGanancia(LIBRO_CON_LAS_FILAS_NUEVAS);

    // Los importes, escritos a mano y no derivados de la funcion que se prueba.
    expect(composicion.egresos.egreso_pago_mensajero).toBe("227300.00");
    expect(composicion.egresos.egreso_ajuste).toBe("45.75");
    // Ninguna cubeta se comio el importe de otra fila de la columna...
    expect(composicion.egresos.egreso_pago_mensajero).not.toBe(composicion.totalEgresos);
    expect(composicion.egresos.egreso_ajuste).not.toBe(composicion.otrosEgresos);
    // ...y el sueldo (que tiene fila en `DesgloseEgresosDTO`) NO aparece en ninguna de las dos
    // cubetas nuevas ni en «otros»: lo sirve el camino de la 45/158.
    expect(Object.values(composicion.egresos)).not.toContain("1200.00");
    expect(composicion.otrosEgresos).not.toBe("1200.00");

    // Dos filas del agregado con la MISMA categoria se acumulan, no se pisan.
    const repetido = derivarComposicionGanancia([
      fila("egreso_ajuste", "10.25"),
      fila("egreso_ajuste", "0.50"),
    ]);
    expect(repetido.egresos.egreso_ajuste).toBe("10.75");
  });

  it("R4/R18: «Otros» se queda EXACTAMENTE con lo que no tiene fila — hoy `egreso_gasto`", () => {
    const composicion = derivarComposicionGanancia(LIBRO_CON_LAS_FILAS_NUEVAS);

    expect(composicion.otrosEgresos).toBe("13.20");
    // Y la lista con la que el detalle leera ESOS movimientos sale de la MISMA definicion.
    expect(categoriasDeFilaComposicion(COMPOSICION_FILA_OTROS)).toEqual(["egreso_gasto"]);
    // Contraprueba de la ficha: el pago al mensajero YA NO esta dentro del cubo.
    expect(composicion.otrosEgresos).not.toBe("227300.00");
    expect(composicion.otrosEgresos).not.toBe("227313.20");
  });

  it("R9: `hayOtrosEgresos` lo deriva el SERVIDOR, y es `false` cuando el residuo es 0.00", () => {
    // (a) CON residuo: hay dinero que la tarjeta no sabe nombrar y la fila tiene que pintarse.
    const conResiduo = derivarComposicionGanancia(LIBRO_CON_LAS_FILAS_NUEVAS);
    expect(conResiduo.otrosEgresos).toBe("13.20");
    expect(conResiduo.hayOtrosEgresos).toBe(true);

    // (b) SIN residuo: el mismo libro sin `egreso_gasto` — que es el estado REAL de produccion,
    //     donde esa categoria no tiene un solo escritor. La fila desaparece.
    const sinResiduo = derivarComposicionGanancia(
      LIBRO_CON_LAS_FILAS_NUEVAS.filter((f) => f.categoria !== "egreso_gasto"),
    );
    expect(sinResiduo.otrosEgresos).toBe("0.00");
    expect(sinResiduo.hayOtrosEgresos).toBe(false);
    // ...y quitar el residuo NO apago las filas nuevas: siguen con su importe.
    expect(sinResiduo.egresos.egreso_pago_mensajero).toBe("227300.00");

    // (c) el libro vacio tampoco pinta la fila, y la bandera es un BOOLEANO, no un importe.
    expect(derivarComposicionGanancia([]).hayOtrosEgresos).toBe(false);
    expect(typeof conResiduo.hayOtrosEgresos).toBe("boolean");
  });

  it("R12: `otrosEgresos + egresos.*` es el MISMO importe que «otros» antes de la ficha", () => {
    // La ficha mueve dinero de cubeta y no puede mover ni un centimo del total. El «antes» se
    // reconstruye con la definicion VIEJA —el complemento de los cuatro del desglose— sobre el
    // mismo libro, y tiene que coincidir con «lo que hoy hay en las filas nuevas + lo que
    // queda en otros».
    const composicion = derivarComposicionGanancia(LIBRO_CON_LAS_FILAS_NUEVAS);

    const otrosAntesDeLaFicha = LIBRO_CON_LAS_FILAS_NUEVAS.filter(
      (f) =>
        NATURALEZA_POR_CATEGORIA[f.categoria] === "propio" &&
        f.tipo === "egreso" &&
        !(WALLET_EGRESO_DESGLOSADO_SEED as readonly string[]).includes(f.categoria),
    ).reduce((s, f) => s.add(new Prisma.Decimal(f.total)), new Prisma.Decimal(0));

    const hoy = WALLET_EGRESO_NOMBRADO_SEED.reduce(
      (s, c) => s.add(new Prisma.Decimal(composicion.egresos[c])),
      new Prisma.Decimal(composicion.otrosEgresos),
    );

    expect(hoy.toFixed(2)).toBe(otrosAntesDeLaFicha.toFixed(2));
    // Control de no-vacuidad: el importe movido NO es cero, y es el grande de verdad.
    expect(otrosAntesDeLaFicha.toFixed(2)).toBe("227358.95"); // 227 300 + 45,75 + 13,20
    expect(composicion.otrosEgresos).not.toBe(otrosAntesDeLaFicha.toFixed(2));
  });

  it("R14: las cifras agregadas de la caja no cambian de valor al repartir la columna", () => {
    const caja = derivarCaja(LIBRO_CON_LAS_FILAS_NUEVAS);
    const composicion = derivarComposicionGanancia(LIBRO_CON_LAS_FILAS_NUEVAS);

    // Los valores, escritos A MANO: 227 300 + 45,75 + 1 200 + 13,20 = 228 558,95 de egreso
    // propio; el pago a la tienda (9 999) es de terceros y no entra en la ganancia.
    expect(caja.egresosPropios).toBe("228558.95");
    expect(caja.ingresosPropios).toBe("7000.00");
    expect(caja.salidas).toBe("238557.95"); // + el pago a la tienda
    expect(composicion.totalEgresos).toBe(caja.egresosPropios);
    expect(composicion.totalIngresos).toBe(caja.ingresosPropios);

    // Y la identidad que R11 exige, sobre este libro: las filas con nombre + «otros» = total.
    const sueldoDelLibro = "1200.00"; // la unica fila del desglose presente en este libro
    const suma = [
      sueldoDelLibro,
      ...WALLET_EGRESO_NOMBRADO_SEED.map((c) => composicion.egresos[c]),
      composicion.otrosEgresos,
    ].reduce((s, v) => s.add(new Prisma.Decimal(v)), new Prisma.Decimal(0));
    expect(suma.toFixed(2)).toBe(composicion.totalEgresos);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// R38 (T7.2) — NO-REGRESION: las cifras que ya existian no cambian de valor.
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Un libro con NUEVE importes distintos entre si y con dinero de las dos naturalezas. Si dos
 * de ellos coincidieran, una asercion podria pasar confundiendo una cifra con otra — que es
 * exactamente lo que la 173 documento como trampa.
 */
const LIBRO_DE_NO_REGRESION: AgregadoCajaRow[] = [
  fila("ingreso_flete", "5000.00"),
  fila("ingreso_comision_cod", "1250.00"),
  fila("ingreso_cod_recaudado", "18000.00"), // de TERCEROS
  fila("egreso_gasto_fijo", "300.00"),
  fila("egreso_gasto_variable", "175.00"),
  fila("egreso_sueldo", "2400.00"),
  fila("egreso_indemnizacion", "125.50"),
  fila("egreso_pago_mensajero", "940.00"),
  fila("egreso_pago_tienda", "11000.00"), // de TERCEROS
];

describe("R38 — las siete cifras y los cuatro conceptos no cambian de valor", () => {
  it("R38/R14: las siete cifras de `CajaResumenDTO` siguen valiendo lo mismo, importe a importe", () => {
    // Los valores esperados estan escritos A MANO, no derivados del codigo que se prueba: son
    // los que la 173 producia sobre este libro. Si `derivarCaja` cambiara una suma al ganar el
    // modo y el porcentaje, este caso lo dice con el importe a la vista.
    const caja = derivarCaja(LIBRO_DE_NO_REGRESION);

    expect({
      entradas: caja.entradas,
      salidas: caja.salidas,
      enCaja: caja.enCaja,
      ingresosPropios: caja.ingresosPropios,
      egresosPropios: caja.egresosPropios,
      ganancia: caja.ganancia,
      deTerceros: caja.deTerceros,
    }).toEqual({
      entradas: "24250.00", // 5 000 + 1 250 + 18 000
      salidas: "14940.50", // 300 + 175 + 2 400 + 125,50 + 940 + 11 000
      enCaja: "9309.50",
      ingresosPropios: "6250.00", // 5 000 + 1 250
      egresosPropios: "3940.50", // todo menos el pago a la tienda
      ganancia: "2309.50",
      deTerceros: "7000.00", // 18 000 − 11 000
    });
    // Los signos tampoco se mueven, y la identidad de la 173 sigue en pie.
    expect(caja.signoEnCaja).toBe("positivo");
    expect(caja.signoGanancia).toBe("positivo");
    expect(new Prisma.Decimal(caja.ganancia).add(caja.deTerceros).toFixed(2)).toBe(caja.enCaja);
  });

  it("R38/R14: los cuatro conceptos de `DesgloseEgresosDTO` siguen valiendo lo mismo", async () => {
    // Se miden por el camino REAL —`WalletMovimientoRepository.agregarPorCategoria`—, con el
    // mismo libro. La feature 231 no toca ese metodo; este caso es la prueba ejecutada, no la
    // afirmacion de que no se toco.
    const prisma = {
      walletMovimiento: {
        groupBy: vi.fn().mockResolvedValue(
          LIBRO_DE_NO_REGRESION.map((f) => ({
            categoria: f.categoria,
            _sum: { monto: new Prisma.Decimal(f.total) },
          })),
        ),
      },
    };
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.agregarPorCategoria({})).toEqual({
      gastoFijo: "300.00",
      gastoVariable: "175.00",
      sueldo: "2400.00",
      indemnizacion: "125.50",
    });

    // Y la consecuencia FIRMADA en D2: esos cuatro NO son `egresosPropios`. El hueco es el pago
    // al mensajero, y es exactamente lo que `otrosEgresos` recoge para que la tarjeta cuadre.
    const composicion = derivarComposicionGanancia(LIBRO_DE_NO_REGRESION);
    // FICHA 343 (R12/R14): los 940 del pago al mensajero siguen en la columna y siguen en el
    // total — lo que cambia es la CUBETA. «Otros» se queda a cero porque en este libro no hay
    // ninguna categoria sin fila propia, y por eso esa fila no se pintaria (R7).
    expect(composicion.egresos.egreso_pago_mensajero).toBe("940.00");
    expect(composicion.otrosEgresos).toBe("0.00");
    expect(composicion.hayOtrosEgresos).toBe(false);
    expect(composicion.totalEgresos).toBe("3940.50");
    expect(new Prisma.Decimal("300.00").add("175.00").add("2400.00").add("125.50").toFixed(2)).toBe(
      "3000.50",
    );
    expect(composicion.totalEgresos).not.toBe("3000.50");
  });
});
