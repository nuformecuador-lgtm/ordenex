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
 * un `₡` al STRING del servidor. Aqui se mide el formato objetivo, los bordes de
 * la agrupacion y —lo que de verdad puede costar dinero— que el importe NUNCA
 * pasa por un `number`.
 *
 * Feature 230 — el dinero se pinta SIN CENTIMOS. Este archivo es donde el
 * comportamiento se DEFINE (los demas lo observan), asi que aqui vive la tabla
 * de contrato entera de `specs/230-dinero-sin-centimos/design.md` §2.4: el
 * redondeo half away from zero, el acarreo que reagrupa los miles y la caida del
 * signo cuando el resultado es cero.
 *
 * Las aserciones del aspecto por defecto se escriben con el literal a la vista
 * (`"₡13.331.833"`) A PROPOSITO: derivarlas de la propia configuracion las
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

describe("formatMontoString — el formato objetivo (miles con punto, sin centimos)", () => {
  it("agrupa los miles y redondea la cola decimal en vez de pintarla", () => {
    expect(formatMontoString("13331832.72")).toBe("₡13.331.833");
    expect(formatMontoString("12345678901.99")).toBe("₡12.345.678.902");
    expect(formatMontoString("1500.50")).toBe("₡1.501");
    expect(formatMontoString("1234.49")).toBe("₡1.234");
    expect(formatMontoString("1234.50")).toBe("₡1.235");
    expect(formatMontoString("1234.56")).toBe("₡1.235");
    // El acarreo puede cambiar el numero de digitos: `99,99` no se queda en 99.
    expect(formatMontoString("99.99")).toBe("₡100");
    // Un importe que ya venia entero en la cola no gana ni pierde nada.
    expect(formatMontoString("-4500.00")).toBe("-₡4.500");
    expect(formatMontoString("0.10")).toBe("₡0");
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
    // Feature 230: los mismos bordes, pero ALCANZADOS POR EL ACARREO. Es el caso
    // que obliga a redondear ANTES de agrupar: si se agrupara primero, `999,50`
    // saldria "₡9991" o "₡1000" sin punto.
    expect(formatMontoString("100.00")).toBe("₡100");
    expect(formatMontoString("999.50")).toBe("₡1.000");
    expect(formatMontoString("999999.99")).toBe("₡1.000.000");

    // Y dicho de la forma en que se rompe: ningun resultado EMPIEZA por el
    // separador, ni justo detras del simbolo ni justo detras del signo.
    for (const importe of ["999", "1000", "1000000", "999.99", "-1000.00", "999.50", "-999.50"]) {
      expect(formatMontoString(importe), importe).not.toMatch(/^-?₡\./);
    }
  });

  // RETIRADO por la feature 230: «copia los decimales VERBATIM: ni rellena ni
  // recorta» (`"1500.5" → ₡1.500,5`) afirmaba justo el corazon de lo que esta
  // feature cambia — la cola decimal ya no se copia, se usa para redondear y se
  // descarta. Lo que de aquel test sigue vivo —que un importe SIN parte decimal
  // se pinta igual que siempre— esta abajo, en «un importe sin parte decimal».

  it("el signo negativo va DELANTE del simbolo", () => {
    expect(formatMontoString("-4500.00")).toBe("-₡4.500");
    // El medio se ALEJA del cero (D1), asi que `-0,50` baja a `-1` y no sube a 0.
    // `Math.round(-0.5)` daria `-0`: por eso el redondeo no se delega en el motor.
    expect(formatMontoString("-0.50")).toBe("-₡1");
    expect(formatMontoString("-13331832.72")).toBe("-₡13.331.833");
    expect(formatMontoString("-999")).toBe("-₡999");
    // Lo que NO puede pasar: el signo detras del simbolo ("₡-4.500").
    expect(formatMontoString("-4500.00")).not.toContain("₡-");
  });

  it("no mete espacios de ningun tipo: ese era el separador que daba `Intl`", () => {
    // `Intl` con locale "es-CR" agrupa con espacio fino (U+00A0 / U+202F), que
    // es justo lo que esta feature deja de usar.
    expect(formatMontoString("13331832.72")).not.toMatch(/[\s  ]/);
    expect(formatMontoString("13331832.72")).not.toBe(
      new Intl.NumberFormat(monedaConfig.locale, {
        style: "currency",
        currency: monedaConfig.currency,
      }).format(13331832.72),
    );
  });
});

describe("formatMontoString — el redondeo (feature 230)", () => {
  it("el medio se aleja del cero, tambien en negativo (R2, D1)", () => {
    expect(formatMontoString("1234.50")).toBe("₡1.235");
    expect(formatMontoString("-1234.50")).toBe("-₡1.235");
    expect(formatMontoString("0.50")).toBe("₡1");
    expect(formatMontoString("-0.50")).toBe("-₡1");
    // Y por debajo del medio baja, con el mismo simetrico en negativo.
    expect(formatMontoString("1234.49")).toBe("₡1.234");
    expect(formatMontoString("-1234.49")).toBe("-₡1.234");
  });

  it("el acarreo que añade un digito REAGRUPA los miles (R3)", () => {
    // La razon por la que el redondeo va antes de agrupar y nunca despues.
    expect(formatMontoString("999.50")).toBe("₡1.000");
    expect(formatMontoString("9.99")).toBe("₡10");
    expect(formatMontoString("99.99")).toBe("₡100");
    expect(formatMontoString("999999.99")).toBe("₡1.000.000");
    expect(formatMontoString("-999.50")).toBe("-₡1.000");
    // Acarreo que atraviesa una cadena de nueves entera sin quedarse a medias.
    expect(formatMontoString("9999.95")).toBe("₡10.000");
    expect(formatMontoString("99999999999.51")).toBe("₡100.000.000.000");
  });

  it("el cero redondeado NO lleva signo (R4)", () => {
    // "menos cero" no es una cantidad que nadie quiera leer en una pantalla.
    expect(formatMontoString("-0.49")).toBe("₡0");
    expect(formatMontoString("-0.00")).toBe("₡0");
    expect(formatMontoString("-0.4")).toBe("₡0");
    expect(formatMontoString("-0")).toBe("₡0");
    // Dicho de la forma en que se rompe: ninguna de esas salidas lleva el menos.
    for (const importe of ["-0.49", "-0.00", "-0.4", "-0"]) {
      expect(formatMontoString(importe), importe).not.toContain("-");
    }
    // Y el cero que NO viene de un negativo sigue igual que siempre.
    expect(formatMontoString("0.49")).toBe("₡0");
  });

  it("con mas de dos decimales manda el PRIMERO, y el resto se ignora (R6)", () => {
    expect(formatMontoString("10.4999")).toBe("₡10");
    expect(formatMontoString("10.5001")).toBe("₡11");
    expect(formatMontoString("10.500")).toBe("₡11");
    expect(formatMontoString("10.4")).toBe("₡10");
    // `0,9999` no acumula hasta 1 por sumar los decimales: sube porque el
    // primero es `9`. Es la misma regla, no una excepcion.
    expect(formatMontoString("0.9999")).toBe("₡1");
  });

  it("un importe sin parte decimal se pinta como siempre: ni inventa ni altera digitos (R5)", () => {
    // Lo que sobrevive del test de «copia los decimales VERBATIM»: inventar una
    // cola seria afirmar una escala que el servidor no mando, y ahora ademas
    // seria afirmar unos centimos que la app ya no pinta.
    expect(formatMontoString("320")).toBe("₡320");
    expect(formatMontoString("1234567")).toBe("₡1.234.567");
    expect(formatMontoString("1500")).toBe("₡1.500");
    expect(formatMontoString("0")).toBe("₡0");
  });

  it("ninguna salida con forma decimal lleva el separador decimal seguido de un digito (R1)", () => {
    // El sub-caso que pidio el humano, afirmado en el sitio donde el
    // comportamiento se define. El barrido ancho —los cinco caminos, con corpus
    // de mas de 100 casos— vive en la guardia `dinero-sin-centimos`.
    const sospechoso = new RegExp(`${monedaConfig.separadorDecimal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d`);
    for (const importe of [
      "13331832.72",
      "1500.50",
      "0.10",
      "-4500.00",
      "999.50",
      "10.4999",
      "-0.49",
      "12345678901.99",
    ]) {
      expect(formatMontoString(importe), importe).not.toMatch(sospechoso);
    }
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
    // Lo que afirma es el `trim`, no el aspecto: el valor esperado cambio con la
    // feature 230 (`₡1.500,50` -> `₡1.501`) porque cambio el formato de TODA la
    // app, no porque el recorte de espacios haga nada distinto.
    expect(formatMontoString(" 1500.50 ")).toBe("₡1.501");
    expect(formatMontoString(" 1500.50 ")).toBe(formatMontoString("1500.50"));
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
    expect(formatMonto(13331832.72)).toBe("₡13.331.833");
    expect(formatMonto(1500.5)).toBe("₡1.501");
    expect(formatMonto(99.99)).toBe("₡100");
    expect(formatMonto(0)).toBe("₡0");
  });

  it("el negativo lleva el signo delante del simbolo, igual que el de STRING", () => {
    expect(formatMonto(-4500)).toBe("-₡4.500");
    expect(formatMonto(-4500)).toBe(formatMontoString("-4500.00"));
    // Y el negativo que redondea a cero pierde el signo por el mismo camino.
    expect(formatMonto(-0.49)).toBe("₡0");
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
    expect(formatMonto(1500.5, SIN_MONTO_RAYA)).toBe("₡1.501");
  });

  // RETIRADO por la feature 230: «un importe ENTERO se pinta con los dos
  // decimales» (`formatMonto(320) → ₡320,00`) documentaba la ASIMETRIA entre los
  // dos caminos —el numerico rellenaba la cola, el de string la copiaba verbatim—
  // y esa asimetria ya no existe. En su lugar se afirma que convergen:

  it("los dos caminos convergen: el mismo importe se pinta igual venga como numero o como string", () => {
    expect(formatMonto(320)).toBe("₡320");
    expect(formatMontoString("320")).toBe("₡320");
    expect(formatMonto(320)).toBe(formatMontoString("320"));
    expect(formatMonto(1000)).toBe("₡1.000");
    expect(formatMonto(1000)).toBe(formatMontoString("1000"));
  });

  it("C3 — el doble redondeo del camino numerico, declarado y fijado", () => {
    // `formatMonto` serializa con `toFixed(2)` ANTES de redondear el string, asi
    // que un numero con mas de dos decimales se redondea dos veces: `1234.4951`
    // pasa por `"1234.50"` y SUBE, cuando el redondeo directo habria bajado.
    //
    // No es un descuido: la escala 2 es la del CONTRATO de la frontera y bajarla
    // aqui delegaria el redondeo en el motor de JS —binario— justo en la
    // operacion que esta feature quiere determinista (`design.md` §7/A3). El
    // borde solo aparece con entradas que YA estan fuera del contrato de escala 2.
    expect(formatMonto(1234.4951)).toBe("₡1.235");
    expect(formatMontoString("1234.4951")).toBe("₡1.234");
    expect(formatMonto(1234.4951)).not.toBe(formatMontoString("1234.4951"));
    // Dentro del contrato (dos decimales) los dos caminos coinciden siempre.
    expect(formatMonto(1234.49)).toBe(formatMontoString("1234.49"));
    expect(formatMonto(1234.5)).toBe(formatMontoString("1234.50"));
  });

  it("ya no agrupa con el espacio fino de `Intl`", () => {
    expect(formatMonto(13331832.72)).not.toMatch(/[\s  ]/);
  });
});

describe("el formato sale de configuracion, no del codigo", () => {
  it("los defaults son colon, punto y coma", () => {
    const cfg = loadMonedaConfig();
    expect(cfg.simbolo).toBe("₡");
    expect(cfg.separadorMiles).toBe(".");
    // `separadorDecimal` se CONSERVA tras la feature 230 (decision Q1(b)) aunque
    // ya no gobierne la salida: es el caracter que la guardia `dinero-sin-centimos`
    // vigila, y lo lee de aqui en vez de escribir la coma a mano.
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

  it("con otra configuracion cambian el simbolo y el separador de MILES", async () => {
    // Hasta la feature 230 este test decia «y LOS DOS separadores». Ya no: el
    // decimal no se emite, asi que aqui solo puede moverse el de miles. Que el
    // decimal siga siendo configurable —y que cambiarlo no altere nada— se
    // afirma en el test siguiente.
    const { formatMontoString: formatear, formatMonto: formatearNumero } = await conConfiguracion({
      MONEDA_SIMBOLO: "$",
      MONEDA_SEPARADOR_MILES: ",",
      MONEDA_SEPARADOR_DECIMAL: ".",
    });

    expect(formatear("13331832.72")).toBe("$13,331,833");
    expect(formatear("999")).toBe("$999");
    expect(formatear("-4500.00")).toBe("-$4,500");
    expect(formatearNumero(1500.5)).toBe("$1,501");
    expect(formatear("13331832.72")).not.toContain("₡");
  });

  it("cambiar el separador DECIMAL no altera ni un byte de la salida (Q1(b))", async () => {
    // El campo sigue vivo y sigue siendo configurable, pero desde la 230 no
    // gobierna nada: no hay parte decimal que separar. Se afirma explicitamente
    // para que nadie lo cambie esperando ver algo — y para que, si alguien
    // reintroduce los centimos, este test lo diga en vez de callarse.
    const { formatMontoString: formatear, monedaConfig: cfg } = await conConfiguracion({
      MONEDA_SEPARADOR_DECIMAL: "¤",
    });

    expect(cfg.separadorDecimal).toBe("¤");
    expect(formatear("13331832.72")).toBe("₡13.331.833");
    expect(formatear("1500.50")).toBe("₡1.501");
    expect(formatear("13331832.72")).not.toContain("¤");
  });

  it("un separador vacio NO deja el importe sin agrupar: cae al default", async () => {
    // `readNonEmpty` es el mismo patron que el resto de `lib/config/**`: una
    // variable en blanco es una variable sin poner, no una orden de no agrupar.
    const { formatMontoString: formatear } = await conConfiguracion({
      MONEDA_SEPARADOR_MILES: "",
    });
    expect(formatear("13331832.72")).toBe("₡13.331.833");
  });

  it("se puede agrupar con otro caracter (apostrofo) sin tocar codigo", async () => {
    // Un separador EN BLANCO no es configurable —`readNonEmpty` lo trata como
    // ausente, igual que en el resto de `lib/config/**`—, asi que el aspecto de
    // `Intl` con espacio fino no se puede restaurar por entorno. Se deja escrito
    // aqui porque es una consecuencia del patron, no un olvido.
    const { formatMontoString: formatear } = await conConfiguracion({
      MONEDA_SEPARADOR_MILES: "'",
    });
    expect(formatear("13331832.72")).toBe("₡13'331'833");
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

    // Y el unico `toFixed` del modulo es de escala 2. La feature 230 lo dejo
    // donde estaba a proposito (`design.md` §7/A3): bajarlo a `toFixed(0)`
    // delegaria el redondeo en el motor binario de JS.
    const usos = [...codigo.matchAll(/\.toFixed\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(usos).toEqual(["2"]);
  });

  it("el redondeo de un importe que un `number` no puede representar es EXACTO", () => {
    // Este es el test que demuestra que el modulo trabaja digito a digito.
    // Hasta la feature 230 lo demostraba conservando los decimales de
    // `"12345678901.99"`; ahora lo demuestra REDONDEANDOLO, que es mas exigente:
    // once digitos no caben exactos en un `double`, asi que un camino que
    // convirtiera a numero no podria garantizar el acarreo.
    expect(formatMontoString("12345678901.99")).toBe("₡12.345.678.902");
    expect(formatMontoString("99999999999.51")).toBe("₡100.000.000.000");
    expect(formatMontoString("99999999999.49")).toBe("₡99.999.999.999");
    // El acarreo atraviesa los once nueves de golpe y añade un digito: si se
    // quedara a medias, la agrupacion lo delataria.
    expect(formatMontoString("99999999999.51")).toMatch(/^₡100(\.000){3}$/);
    expect(formatMontoString("99999999999.01")).toBe("₡99.999.999.999");
  });
});
