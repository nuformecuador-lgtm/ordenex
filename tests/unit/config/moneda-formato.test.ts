import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatMonto,
  formatMontoString,
  loadMonedaConfig,
  monedaConfig,
  SIN_MONTO,
  SIN_MONTO_RAYA,
} from "@/lib/config/moneda";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 201 (tanda A) — el helper de formato de dinero.
 *
 * El bug que lo motiva: los importes se pintaban `₡13331832.72`, sin separador
 * de miles, porque siete copias identicas de `money()` se limitaban a anteponer
 * un `₡` al STRING del servidor. Aqui se mide el formato objetivo
 * (`₡13.331.832,72`), los bordes de la agrupacion y —lo que de verdad puede
 * costar dinero— que el importe NUNCA pasa por un `number`.
 *
 * Las aserciones del aspecto por defecto se escriben con el literal a la vista
 * (`"₡13.331.832,72"`) A PROPOSITO: derivarlas de la propia configuracion las
 * volveria tautologicas —el formato saldria "bien" fuera cual fuera— y el
 * requisito humano de esta feature es exactamente ese literal. Que el formato NO
 * este hardcodeado se mide aparte, releyendo el modulo con otra configuracion.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Recarga el modulo con otra configuracion de moneda (resuelta al importarse). */
async function conConfiguracion(env: Record<string, string>) {
  vi.resetModules();
  for (const [clave, valor] of Object.entries(env)) vi.stubEnv(clave, valor);
  return import("@/lib/config/moneda");
}

describe("formatMontoString — el formato objetivo (punto para miles, coma para decimales)", () => {
  it("agrupa los miles y separa los decimales con coma", () => {
    expect(formatMontoString("13331832.72")).toBe("₡13.331.832,72");
    expect(formatMontoString("12345678901.99")).toBe("₡12.345.678.901,99");
    expect(formatMontoString("1500.50")).toBe("₡1.500,50");
    expect(formatMontoString("99.99")).toBe("₡99,99");
    expect(formatMontoString("-4500.00")).toBe("-₡4.500,00");
    expect(formatMontoString("0.10")).toBe("₡0,10");
  });

  it("el separador de miles no se cuela delante del primer grupo", () => {
    // El borde clasico: con menos de 3 digitos, con 3 exactos y con un multiplo
    // de 3, una agrupacion mal escrita produce ".999" o ".1.000".
    expect(formatMontoString("0")).toBe("₡0");
    expect(formatMontoString("7")).toBe("₡7");
    expect(formatMontoString("99")).toBe("₡99");
    expect(formatMontoString("999")).toBe("₡999");
    expect(formatMontoString("1000")).toBe("₡1.000");
    expect(formatMontoString("999999")).toBe("₡999.999");
    expect(formatMontoString("1000000")).toBe("₡1.000.000");
    expect(formatMontoString("100.00")).toBe("₡100,00");
    expect(formatMontoString("1000.00")).toBe("₡1.000,00");

    // Y dicho de la forma en que se rompe: ningun resultado EMPIEZA por el
    // separador, ni justo detras del simbolo ni justo detras del signo.
    for (const importe of ["999", "1000", "1000000", "999.99", "-1000.00"]) {
      expect(formatMontoString(importe), importe).not.toMatch(/^-?₡\./);
    }
  });

  it("copia los decimales VERBATIM: ni rellena ni recorta", () => {
    // `"1234567"` sin parte decimal se pinta sin parte decimal: inventar ",00"
    // seria afirmar una escala que el servidor no mando.
    expect(formatMontoString("1234567")).toBe("₡1.234.567");
    expect(formatMontoString("1500")).toBe("₡1.500");
    // Un solo decimal se queda en uno (`Number` lo dejaria igual, pero `"0.10"`
    // se convertiria en `0.1` y se pintaria "₡0,1": ese es el fallo real).
    expect(formatMontoString("1500.5")).toBe("₡1.500,5");
    expect(formatMontoString("0.10")).toBe("₡0,10");
    expect(formatMontoString("10.00")).toBe("₡10,00");
  });

  it("el signo negativo va DELANTE del simbolo", () => {
    expect(formatMontoString("-4500.00")).toBe("-₡4.500,00");
    expect(formatMontoString("-0.50")).toBe("-₡0,50");
    expect(formatMontoString("-13331832.72")).toBe("-₡13.331.832,72");
    expect(formatMontoString("-999")).toBe("-₡999");
    // Lo que NO puede pasar: el signo detras del simbolo ("₡-4.500,00").
    expect(formatMontoString("-4500.00")).not.toContain("₡-");
  });

  it("no mete espacios de ningun tipo: ese era el separador que daba `Intl`", () => {
    // `Intl` con locale "es-CR" agrupa con espacio fino (U+00A0 / U+202F), que
    // es justo lo que esta feature deja de usar.
    expect(formatMontoString("13331832.72")).not.toMatch(/[\s  ]/);
    expect(formatMontoString("13331832.72")).not.toBe(
      new Intl.NumberFormat(monedaConfig.locale, {
        style: "currency",
        currency: monedaConfig.currency,
      }).format(13331832.72),
    );
  });
});

describe("formatMontoString — ausencia de importe", () => {
  it("`null` usa el marcador por defecto del modulo", () => {
    expect(formatMontoString(null)).toBe(SIN_MONTO);
  });

  it("acepta OTRO marcador por parametro, y los dos que hay en pantalla son distintos", () => {
    // Las siete copias de `money()` pintan la raya larga; `formatMonto` pinta el
    // guion corto. Unificarlos cambiaria pantallas que esta feature no toca, asi
    // que el marcador se ELIGE en la llamada.
    expect(SIN_MONTO).not.toBe(SIN_MONTO_RAYA);
    expect(SIN_MONTO).toBe("-");
    expect(SIN_MONTO_RAYA).toBe("—");
    expect(formatMontoString(null, SIN_MONTO_RAYA)).toBe("—");
    expect(formatMontoString(null, SIN_MONTO_RAYA)).not.toBe(formatMontoString(null));
  });

  it("una cadena vacia o en blanco tambien es ausencia, no un simbolo suelto", () => {
    expect(formatMontoString("")).toBe(SIN_MONTO);
    expect(formatMontoString("   ")).toBe(SIN_MONTO);
    expect(formatMontoString("", SIN_MONTO_RAYA)).toBe("—");
    expect(formatMontoString("")).not.toContain("₡");
  });

  it("un importe con espacios alrededor se formatea igual", () => {
    expect(formatMontoString(" 1500.50 ")).toBe("₡1.500,50");
  });

  it("lo que no tiene forma de decimal se pinta tal cual, sin fingir que no hay monto", () => {
    // Comportamiento de las copias de `money()`: el simbolo delante del texto.
    // Devolver el marcador de ausencia diria "no hay importe" cuando si lo hay.
    expect(formatMontoString("1.2.3")).toBe("₡1.2.3");
    expect(formatMontoString("1.2.3")).not.toBe(SIN_MONTO);
  });
});

describe("formatMonto (number|null) produce el MISMO aspecto (feature 32/R5)", () => {
  it("coincide con el helper de STRING para el mismo importe", () => {
    expect(formatMonto(13331832.72)).toBe(formatMontoString("13331832.72"));
    expect(formatMonto(13331832.72)).toBe("₡13.331.832,72");
    expect(formatMonto(1500.5)).toBe("₡1.500,50");
    expect(formatMonto(99.99)).toBe("₡99,99");
    expect(formatMonto(0)).toBe("₡0,00");
  });

  it("el negativo lleva el signo delante del simbolo, igual que el de STRING", () => {
    expect(formatMonto(-4500)).toBe("-₡4.500,00");
    expect(formatMonto(-4500)).toBe(formatMontoString("-4500.00"));
  });

  it("`null` sigue siendo `SIN_MONTO`", () => {
    expect(formatMonto(null)).toBe(SIN_MONTO);
  });

  it("acepta OTRO marcador por parametro, igual que el helper de STRING", () => {
    // Tanda D: las cuatro pantallas del mensajero y del satelite pintan la raya
    // larga cuando no hay monto a cobrar. Si el marcador no se pudiera elegir,
    // migrarlas al helper compartido les cambiaria el guion en pantalla.
    expect(formatMonto(null, SIN_MONTO_RAYA)).toBe(SIN_MONTO_RAYA);
    expect(formatMonto(null, SIN_MONTO_RAYA)).not.toBe(formatMonto(null));
    // Y con importe, el segundo parametro no pinta nada.
    expect(formatMonto(1500.5, SIN_MONTO_RAYA)).toBe("₡1.500,50");
  });

  it("un importe ENTERO se pinta con los dos decimales", () => {
    // Aqui la escala 2 SI esta en el contrato (`toFixed(2)`), al reves que en
    // `formatMontoString`, que copia los decimales verbatim. Es lo que hace que
    // una columna de dinero tenga la coma a la misma altura en todas las filas.
    expect(formatMonto(320)).toBe("₡320,00");
    expect(formatMonto(1000)).toBe("₡1.000,00");
    expect(formatMontoString("320")).toBe("₡320");
  });

  it("ya no agrupa con el espacio fino de `Intl`", () => {
    expect(formatMonto(13331832.72)).not.toMatch(/[\s  ]/);
  });
});

describe("el formato sale de configuracion, no del codigo", () => {
  it("los defaults son colon, punto y coma", () => {
    const cfg = loadMonedaConfig();
    expect(cfg.simbolo).toBe("₡");
    expect(cfg.separadorMiles).toBe(".");
    expect(cfg.separadorDecimal).toBe(",");
    // Los dos que ya existian siguen igual.
    expect(cfg.locale).toBe("es-CR");
    expect(cfg.currency).toBe("CRC");
  });

  it("una variable vacia o en blanco cae al default (patron `readNonEmpty`)", () => {
    vi.stubEnv("MONEDA_SIMBOLO", "");
    vi.stubEnv("MONEDA_SEPARADOR_MILES", "   ");
    const cfg = loadMonedaConfig();
    expect(cfg.simbolo).toBe("₡");
    expect(cfg.separadorMiles).toBe(".");
  });

  it("con otra configuracion cambian el simbolo y LOS DOS separadores", async () => {
    // Si el formato estuviera escrito en el codigo, esta asercion no se moveria.
    const { formatMontoString: formatear, formatMonto: formatearNumero } = await conConfiguracion({
      MONEDA_SIMBOLO: "$",
      MONEDA_SEPARADOR_MILES: ",",
      MONEDA_SEPARADOR_DECIMAL: ".",
    });

    expect(formatear("13331832.72")).toBe("$13,331,832.72");
    expect(formatear("999")).toBe("$999");
    expect(formatear("-4500.00")).toBe("-$4,500.00");
    expect(formatearNumero(1500.5)).toBe("$1,500.50");
    expect(formatear("13331832.72")).not.toContain("₡");
  });

  it("un separador vacio NO deja el importe sin agrupar: cae al default", async () => {
    // `readNonEmpty` es el mismo patron que el resto de `lib/config/**`: una
    // variable en blanco es una variable sin poner, no una orden de no agrupar.
    const { formatMontoString: formatear } = await conConfiguracion({
      MONEDA_SEPARADOR_MILES: "",
    });
    expect(formatear("13331832.72")).toBe("₡13.331.832,72");
  });

  it("se puede agrupar con otro caracter (apostrofo) sin tocar codigo", async () => {
    // Un separador EN BLANCO no es configurable —`readNonEmpty` lo trata como
    // ausente, igual que en el resto de `lib/config/**`—, asi que el aspecto de
    // `Intl` con espacio fino no se puede restaurar por entorno. Se deja escrito
    // aqui porque es una consecuencia del patron, no un olvido.
    const { formatMontoString: formatear } = await conConfiguracion({
      MONEDA_SEPARADOR_MILES: "'",
    });
    expect(formatear("13331832.72")).toBe("₡13'331'832,72");
  });
});

describe("money-safe: el helper no convierte el importe a numero", () => {
  it("el modulo no llama a `Number(`, `parseFloat(` ni `parseInt(`", () => {
    // Se barre el CODIGO sin comentarios: la prosa de este archivo y la del
    // modulo NOMBRAN a proposito lo prohibido, y un barrido literal fallaria por
    // citarlo. `.toFixed(` queda fuera del barrido a proposito: en `formatMonto`
    // el argumento es un `number` POR CONTRATO (feature 32/R5) y `toFixed(2)` es
    // la serializacion exacta de escala 2, la misma con la que el dinero cruza
    // la frontera.
    const codigo = codigoSinComentarios("lib/config/moneda.ts");

    expect(codigo).not.toMatch(/\bNumber\s*\(/);
    expect(codigo).not.toMatch(/\bparseFloat\s*\(/);
    expect(codigo).not.toMatch(/\bparseInt\s*\(/);

    // Contraprueba del barrido: sobre este mismo fuente, con la llamada colada,
    // SI la encuentra. Sin esto los tres `not.toMatch` podrian estar pasando por
    // no mirar nada.
    expect(`${codigo}\nconst x = Number(monto);`).toMatch(/\bNumber\s*\(/);
    expect(codigo).toContain("formatMontoString");

    // Y el unico `toFixed` del modulo es de escala 2.
    const usos = [...codigo.matchAll(/\.toFixed\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(usos).toEqual(["2"]);
  });

  it("los decimales sobreviven a un importe que un `number` no puede representar", () => {
    // `Number("12345678901.99")` pierde el importe exacto; el helper lo pinta
    // digito a digito porque nunca lo convierte.
    expect(formatMontoString("12345678901.99")).toBe("₡12.345.678.901,99");
    expect(formatMontoString("99999999999.01")).toBe("₡99.999.999.999,01");
    expect(formatMontoString("0.10")).toContain("0,10");
  });
});
