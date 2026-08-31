import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { monedaConfig } from "@/lib/config/moneda";
import { serializarMontoCotizacion } from "@/lib/utils/monto-cotizacion";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 255 (T1), ENMENDADA por la ficha 319 el 2026-08-28 — la serializacion
 * de los importes de la cotizacion, al caracter.
 *
 * La tabla de contrato conserva sus CATORCE filas y sus catorce bordes; lo que
 * cambia es la salida esperada, que pasa de formateada a CRUDA. Los bordes
 * siguen siendo los mismos y siguen mereciendo un caso: cero sin signo, acarreo
 * que cambia el numero de digitos, y once digitos que no caben exactos en un
 * `number` y por eso jamas se convierten a uno.
 *
 * R35 tabla (enmendada) - R36 estructural (invertida: el fuente NO lee
 * `monedaConfig`) - R38 cero - R39 orden del redondeo.
 *
 * R37 —el signo DELANTE del simbolo— se EXTINGUE con la enmienda: sin simbolo no
 * hay nada delante de lo que colocar el signo. Lo que sobrevive de ella, y se
 * sigue probando abajo, es que el signo del negativo no se pierde.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const FUENTE = "lib/utils/monto-cotizacion.ts";

/** Redondeo de la ARITMETICA (`round2` de `derivarIngresoOrden`), no del serializador. */
function comoLoRedondeaLaAritmetica(valor: string): Prisma.Decimal {
  return new Prisma.Decimal(valor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

const TABLA_DE_CONTRATO: readonly {
  fila: number;
  entrada: Prisma.Decimal;
  esperado: string;
  borde: string;
}[] = [
  {
    fila: 1,
    entrada: new Prisma.Decimal(0),
    esperado: "0.00",
    borde: "cero: dos decimales, sin signo (R38)",
  },
  {
    fila: 2,
    entrada: new Prisma.Decimal("-0.00"),
    esperado: "0.00",
    borde: "menos cero no se emite (R38)",
  },
  {
    fila: 3,
    entrada: new Prisma.Decimal(7),
    esperado: "7.00",
    borde: "un digito, cola sintetica",
  },
  {
    fila: 4,
    entrada: new Prisma.Decimal("7.5"),
    esperado: "7.50",
    borde: "escala < 2 se completa a 2",
  },
  {
    fila: 5,
    entrada: new Prisma.Decimal(999),
    esperado: "999.00",
    borde: "3 digitos exactos",
  },
  {
    fila: 6,
    entrada: new Prisma.Decimal(1000),
    esperado: "1000.00",
    borde: "multiplo de 3: NO se agrupa (era el borde de la agrupacion)",
  },
  {
    fila: 7,
    entrada: new Prisma.Decimal(1578),
    esperado: "1578.00",
    borde: "el ejemplo del humano, positivo",
  },
  {
    fila: 8,
    entrada: new Prisma.Decimal(-1578),
    esperado: "-1578.00",
    borde: "el signo abre la cadena (R37 enmendada: ya no hay simbolo detras)",
  },
  {
    fila: 9,
    entrada: new Prisma.Decimal("-1578.4"),
    esperado: "-1578.40",
    borde: "negativo con cola",
  },
  {
    fila: 10,
    entrada: comoLoRedondeaLaAritmetica("999.995"),
    esperado: "1000.00",
    borde: "acarreo que cambia el n de digitos: lo redondea la aritmetica (R39)",
  },
  {
    fila: 11,
    entrada: new Prisma.Decimal("13331832.72"),
    esperado: "13331832.72",
    borde: "ocho digitos SIN separador de miles",
  },
  {
    fila: 12,
    entrada: new Prisma.Decimal("99999999999.51"),
    esperado: "99999999999.51",
    borde: "11 digitos: no cabe exacto en un number, nunca se convierte",
  },
  {
    fila: 13,
    entrada: comoLoRedondeaLaAritmetica("0.004"),
    esperado: "0.00",
    borde: "un centimo que se cae no reaparece como signo (R38)",
  },
  {
    fila: 14,
    entrada: new Prisma.Decimal("-0.5"),
    esperado: "-0.50",
    borde: "negativo menor que la unidad: el signo SI sobrevive",
  },
];

describe("serializarMontoCotizacion - tabla de contrato (R35, enmendada por la 319)", () => {
  it("la tabla transcrita tiene las CATORCE filas del contrato", () => {
    // Sin esto, una tabla recortada dejaria el parametrizado verde por no mirar
    // los bordes que justifican su existencia.
    expect(TABLA_DE_CONTRATO).toHaveLength(14);
    expect(TABLA_DE_CONTRATO.map((caso) => caso.fila)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it.each(TABLA_DE_CONTRATO)("fila $fila - $borde", ({ entrada, esperado }) => {
    expect(serializarMontoCotizacion(entrada)).toBe(esperado);
  });

  it("emite SIEMPRE exactamente dos decimales (salida de maquina, R35)", () => {
    for (const { entrada } of TABLA_DE_CONTRATO) {
      expect(serializarMontoCotizacion(entrada)).toMatch(/\.\d\d$/);
    }
  });

  it("la forma es money-safe y NADA MAS: signo, digitos y un punto (ficha 319)", () => {
    // El contrato entero en un solo regex. Si alguien reintrodujera el simbolo,
    // la agrupacion de miles o la coma decimal, esto se pone rojo en las catorce
    // filas a la vez.
    for (const { entrada } of TABLA_DE_CONTRATO) {
      expect(serializarMontoCotizacion(entrada)).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

describe("serializarMontoCotizacion - el signo (R37 enmendada, R38)", () => {
  it("el negativo conserva su signo, ahora al principio de la cadena", () => {
    expect(serializarMontoCotizacion(new Prisma.Decimal(-1578))).toBe("-1578.00");
  });

  it("el signo sobrevive en un negativo menor que la unidad", () => {
    expect(serializarMontoCotizacion(new Prisma.Decimal("-0.5"))).toBe("-0.50");
  });

  it("R38 - filas 1, 2 y 13: el cero va sin signo, un «menos cero» no se emite", () => {
    const ceros = [
      new Prisma.Decimal(0),
      new Prisma.Decimal(-0),
      new Prisma.Decimal("-0.00"),
      comoLoRedondeaLaAritmetica("0.004"),
      comoLoRedondeaLaAritmetica("-0.004"),
    ];
    for (const cero of ceros) {
      expect(serializarMontoCotizacion(cero)).toBe("0.00");
    }
  });
});

describe("serializarMontoCotizacion - NO depende de la moneda (R36, invertida por la 319)", () => {
  // R36 exigia que el simbolo y los dos separadores salieran de `monedaConfig` y
  // no del codigo. Con la salida cruda la exigencia se INVIERTE y se vuelve mas
  // fuerte: la configuracion de PRESENTACION no puede tocar un contrato de
  // maquina. Un importe servido a un integrador no puede cambiar de forma porque
  // alguien mueva una variable de entorno pensada para las pantallas.

  it("ESTRUCTURAL - el fuente no importa ni lee `monedaConfig`", () => {
    const codigo = quitarComentarios(readFileSync(path.join(RAIZ, FUENTE), "utf8"));

    expect(codigo, `${FUENTE} volvio a acoplarse a la configuracion de moneda`).not.toContain(
      "monedaConfig",
    );
    expect(codigo, `${FUENTE} importa el modulo de moneda`).not.toContain("config/moneda");

    // Contraprueba: el barrido SI caza a un fuente que lo leyera.
    const mentiroso = quitarComentarios(
      'import { monedaConfig } from "@/lib/config/moneda";\nexport const x = monedaConfig.simbolo;',
    );
    expect(mentiroso).toContain("monedaConfig");
  });

  it("el simbolo de moneda NO aparece en ninguna salida", () => {
    // Se lee de `monedaConfig` para no escribirlo a mano en el test tampoco.
    for (const { entrada } of TABLA_DE_CONTRATO) {
      expect(serializarMontoCotizacion(entrada)).not.toContain(monedaConfig.simbolo);
    }
  });

  it("cambiar `monedaConfig` NO altera la salida (antes era justo lo contrario)", () => {
    const original = { ...monedaConfig };
    const antes = serializarMontoCotizacion(new Prisma.Decimal("13331832.72"));
    try {
      monedaConfig.simbolo = "$";
      monedaConfig.separadorMiles = " ";
      monedaConfig.separadorDecimal = "|";
      expect(serializarMontoCotizacion(new Prisma.Decimal("13331832.72"))).toBe(antes);
      expect(antes).toBe("13331832.72");
    } finally {
      Object.assign(monedaConfig, original);
    }
  });
});

describe("serializarMontoCotizacion - el redondeo es de la aritmetica (R39)", () => {
  it("la aritmetica ya subio `999.995` a `1000.00` antes de llegar aqui", () => {
    expect(comoLoRedondeaLaAritmetica("999.995").toFixed(2)).toBe("1000.00");
    expect(serializarMontoCotizacion(comoLoRedondeaLaAritmetica("999.995"))).toBe("1000.00");
  });

  it("con escala > 2 redondea `toFixed(2)`: no deberia llegar aqui, pero llega redondeado", () => {
    // El contrato dice que aqui llegan importes YA a escala 2, asi que este caso hoy
    // es inalcanzable desde la cotizacion. Se fija el comportamiento REAL de la
    // serializacion —`toFixed(2)` redondea— para que no se descubra despues: si esto
    // se ejercitara de verdad, seria la señal de que la aritmetica dejo de redondear.
    expect(serializarMontoCotizacion(new Prisma.Decimal("1.005"))).toBe("1.01");
  });

  it("un importe que no es un decimal finito falla ruidosamente, no se sirve como precio", () => {
    expect(() => serializarMontoCotizacion(new Prisma.Decimal(NaN))).toThrow(/decimal finito/);
  });
});

describe("serializarMontoCotizacion - habla el MISMO dialecto que la carga (ficha 319)", () => {
  it("un importe sale igual que el `costoEnvio` de POST /carga, que ya era crudo", () => {
    // El motivo de la enmienda, escrito como assert: los dos endpoints del canal
    // por API key sirven dinero con la misma forma, y un integrador necesita un
    // solo parser. `costoEnvio` es un money-safe string de escala 2.
    const comoLoSirveLaCarga = new Prisma.Decimal("4501.5").toFixed(2);
    expect(serializarMontoCotizacion(new Prisma.Decimal("4501.5"))).toBe(comoLoSirveLaCarga);
    expect(comoLoSirveLaCarga).toBe("4501.50");
  });
});
