import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { monedaConfig } from "@/lib/config/moneda";
import { formatMontoCotizacion } from "@/lib/utils/monto-cotizacion";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 255 (T1) — el formateo de los importes de la cotizacion, al caracter.
 *
 * La tabla de contrato de `design.md` §6.1 se transcribe ENTERA (14 filas) como
 * test parametrizado: son los bordes que fijan el formato (cero sin signo,
 * acarreo que cambia el numero de digitos, agrupacion multiple, once digitos que
 * no caben en un `number`).
 *
 * R35 tabla · R36 configuracion + estructural · R37 signo · R38 cero · R39 orden.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const FUENTE = "lib/utils/monto-cotizacion.ts";

/** Redondeo de la ARITMETICA (`round2` de `derivarIngresoOrden`), no del formateador. */
function comoLoRedondeaLaAritmetica(valor: string): Prisma.Decimal {
  return new Prisma.Decimal(valor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * `design.md` §6.1, las 14 filas. Las salidas se componen desde `monedaConfig`
 * —no se escriben `₡`, `.` ni `,` a mano— por la misma razon que se lo prohibe
 * al fuente: son configuracion, no contexto hardcodeado (R36).
 */
const { simbolo, separadorMiles: miles, separadorDecimal: coma } = monedaConfig;

const TABLA_DE_CONTRATO: readonly {
  fila: number;
  entrada: Prisma.Decimal;
  esperado: string;
  borde: string;
}[] = [
  {
    fila: 1,
    entrada: new Prisma.Decimal(0),
    esperado: `${simbolo}0${coma}00`,
    borde: "cero: dos decimales, sin signo (R38)",
  },
  {
    fila: 2,
    entrada: new Prisma.Decimal("-0.00"),
    esperado: `${simbolo}0${coma}00`,
    borde: "menos cero no se emite (R38)",
  },
  {
    fila: 3,
    entrada: new Prisma.Decimal(7),
    esperado: `${simbolo}7${coma}00`,
    borde: "un digito, cola sintetica",
  },
  {
    fila: 4,
    entrada: new Prisma.Decimal("7.5"),
    esperado: `${simbolo}7${coma}50`,
    borde: "escala < 2 se completa a 2",
  },
  {
    fila: 5,
    entrada: new Prisma.Decimal(999),
    esperado: `${simbolo}999${coma}00`,
    borde: "3 digitos exactos: sin separador delante",
  },
  {
    fila: 6,
    entrada: new Prisma.Decimal(1000),
    esperado: `${simbolo}1${miles}000${coma}00`,
    borde: "multiplo de 3: primer grupo de 1",
  },
  {
    fila: 7,
    entrada: new Prisma.Decimal(1578),
    esperado: `${simbolo}1${miles}578${coma}00`,
    borde: "el ejemplo del humano, positivo",
  },
  {
    fila: 8,
    entrada: new Prisma.Decimal(-1578),
    esperado: `-${simbolo}1${miles}578${coma}00`,
    borde: "signo DELANTE del simbolo (R37)",
  },
  {
    fila: 9,
    entrada: new Prisma.Decimal("-1578.4"),
    esperado: `-${simbolo}1${miles}578${coma}40`,
    borde: "negativo con cola",
  },
  {
    fila: 10,
    entrada: comoLoRedondeaLaAritmetica("999.995"),
    esperado: `${simbolo}1${miles}000${coma}00`,
    borde: "acarreo que cambia el nº de digitos: se redondea y LUEGO se agrupa (R39)",
  },
  {
    fila: 11,
    entrada: new Prisma.Decimal("13331832.72"),
    esperado: `${simbolo}13${miles}331${miles}832${coma}72`,
    borde: "agrupacion multiple",
  },
  {
    fila: 12,
    entrada: new Prisma.Decimal("99999999999.51"),
    esperado: `${simbolo}99${miles}999${miles}999${miles}999${coma}51`,
    borde: "11 digitos: no cabe exacto en un number, nunca se convierte",
  },
  {
    fila: 13,
    entrada: comoLoRedondeaLaAritmetica("0.004"),
    esperado: `${simbolo}0${coma}00`,
    borde: "un centimo que se cae no reaparece como signo (R38)",
  },
  {
    fila: 14,
    entrada: new Prisma.Decimal("-0.5"),
    esperado: `-${simbolo}0${coma}50`,
    borde: "negativo menor que la unidad: el signo SI sobrevive",
  },
];

describe("formatMontoCotizacion · tabla de contrato de design.md §6.1 (R35)", () => {
  it("la tabla transcrita tiene las CATORCE filas del contrato", () => {
    // Sin esto, una tabla recortada dejaria el parametrizado verde por no mirar
    // los bordes que justifican su existencia.
    expect(TABLA_DE_CONTRATO).toHaveLength(14);
    expect(TABLA_DE_CONTRATO.map((caso) => caso.fila)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it.each(TABLA_DE_CONTRATO)("fila $fila — $borde", ({ entrada, esperado }) => {
    expect(formatMontoCotizacion(entrada)).toBe(esperado);
  });

  it("emite SIEMPRE exactamente dos decimales (salida de maquina, R35)", () => {
    const conDosDecimales = new RegExp(`${coma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d\\d$`);
    for (const { entrada } of TABLA_DE_CONTRATO) {
      expect(formatMontoCotizacion(entrada)).toMatch(conDosDecimales);
    }
  });
});

describe("formatMontoCotizacion · el signo (R37, R38)", () => {
  it("R37 · fila 8: coloca el signo negativo DELANTE del simbolo de moneda", () => {
    expect(formatMontoCotizacion(new Prisma.Decimal(-1578))).toBe(
      `-${simbolo}1${miles}578${coma}00`,
    );
  });

  it("R37 · fila 14: el signo sobrevive en un negativo menor que la unidad", () => {
    expect(formatMontoCotizacion(new Prisma.Decimal("-0.5"))).toBe(`-${simbolo}0${coma}50`);
  });

  it("R38 · filas 1, 2 y 13: el cero va sin signo, «menos cero» no se emite", () => {
    const ceros = [
      new Prisma.Decimal(0),
      new Prisma.Decimal(-0),
      new Prisma.Decimal("-0.00"),
      comoLoRedondeaLaAritmetica("0.004"),
      comoLoRedondeaLaAritmetica("-0.004"),
    ];
    for (const cero of ceros) {
      expect(formatMontoCotizacion(cero)).toBe(`${simbolo}0${coma}00`);
    }
  });
});

describe("formatMontoCotizacion · toma los tres caracteres de monedaConfig (R36)", () => {
  const original = { ...monedaConfig };

  afterEach(() => {
    Object.assign(monedaConfig, original);
  });

  it("con `monedaConfig` sobreescrito, el formato cambia en consecuencia", () => {
    const antes = formatMontoCotizacion(new Prisma.Decimal("13331832.72"));

    monedaConfig.simbolo = "$";
    monedaConfig.separadorMiles = " ";
    monedaConfig.separadorDecimal = "|";

    expect(formatMontoCotizacion(new Prisma.Decimal("13331832.72"))).toBe("$13 331 832|72");
    expect(formatMontoCotizacion(new Prisma.Decimal(-1578))).toBe("-$1 578|00");
    // Y no era que diera siempre lo mismo: la salida por defecto es otra.
    expect(antes).not.toBe("$13 331 832|72");
  });

  it("ESTRUCTURAL · el fuente no escribe el simbolo ni los separadores a mano", () => {
    const codigo = quitarComentarios(readFileSync(path.join(RAIZ, FUENTE), "utf8"));

    // El simbolo no aparece NI UNA VEZ en el codigo (solo puede llegar de config).
    expect(codigo, `${FUENTE} escribe el simbolo de moneda a mano`).not.toContain(original.simbolo);

    // Y ninguno de los tres caracteres aparece como literal de cadena.
    const literales = [original.simbolo, original.separadorMiles, original.separadorDecimal]
      .flatMap((caracter) => [`"${caracter}"`, `'${caracter}'`, `\`${caracter}\``])
      .filter((literal) => codigo.includes(literal));
    expect(literales, `${FUENTE} escribe un separador de moneda como literal`).toEqual([]);

    // Contraprueba: el barrido caza a un formateador que SI los escribiera.
    const mentiroso = `return \`\${"₡"}\${enteros}\${","}\${decimales}\`;`;
    expect(mentiroso).toContain(`"${original.simbolo}"`);
    expect(mentiroso).toContain(`"${original.separadorDecimal}"`);

    // Y el fuente lee los tres de la configuracion.
    for (const campo of ["simbolo", "separadorMiles", "separadorDecimal"]) {
      expect(codigo, `${FUENTE} no lee monedaConfig.${campo}`).toContain(`monedaConfig.${campo}`);
    }
  });
});

describe("formatMontoCotizacion · el redondeo es de la aritmetica, no del formateador (R39)", () => {
  it("agrupa DESPUES de serializar: el acarreo de la aritmetica ya cambio los digitos", () => {
    // Fila 10 del contrato, desglosada: la aritmetica sube `999.995` a `1000.00`
    // y el formateador agrupa los CUATRO digitos resultantes, no los tres de la
    // entrada original.
    expect(comoLoRedondeaLaAritmetica("999.995").toFixed(2)).toBe("1000.00");
    expect(formatMontoCotizacion(comoLoRedondeaLaAritmetica("999.995"))).toBe(
      `${simbolo}1${miles}000${coma}00`,
    );
  });

  it("con escala > 2 el redondeo lo hace `toFixed(2)`: no deberia llegar aqui, pero llega redondeado", () => {
    // El contrato dice que aqui llegan importes YA a escala 2, asi que este caso hoy
    // es inalcanzable desde la cotizacion. Se fija el comportamiento REAL de la
    // serializacion —`toFixed(2)` redondea— para que no se descubra despues: si esto
    // se ejercitara de verdad, seria la señal de que la aritmetica dejo de redondear.
    expect(formatMontoCotizacion(new Prisma.Decimal("1.005"))).toBe(`${simbolo}1${coma}01`);
  });

  it("un importe que no es un decimal finito falla ruidosamente, no se sirve como precio", () => {
    expect(() => formatMontoCotizacion(new Prisma.Decimal(NaN))).toThrow(/decimal finito/);
  });
});
