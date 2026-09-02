import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ESCALA_PRESENTACION,
  formatMonto,
  formatMontoString,
  formatMontoTope,
  loadMonedaConfig,
  monedaConfig,
  money,
  moneyTope,
  montoExacto,
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
 * Feature 230 — el dinero se pintaba cuadrado al colon: la cola de la escala 2
 * decidia el redondeo de la parte entera y se descartaba.
 *
 * FICHA 359 — LA REGLA VIGENTE: la cola se pinta SOLO CUANDO EXISTE.
 * `₡11.899` cuando el importe es redondo; `₡416,47` cuando tiene cola.
 *
 * Este archivo es donde el comportamiento se DEFINE (los demas lo observan), asi
 * que aqui vive la tabla de contrato entera. Que la regla cambiara NO vacia estos
 * tests: los bordes que perseguian —el acarreo, la agrupacion, la caida del
 * signo, el importe que no cabe en un `double`— son los mismos y siguen siendo
 * donde esto se rompe. Lo que cambia es la cifra esperada, y en dos casos el
 * borde se DA LA VUELTA: el acarreo de `999,50` ya no ocurre a escala 0 sino a
 * escala 2, y el `-0,49` ya no pierde el signo porque ya no se cuadra a cero.
 *
 * Las aserciones del aspecto por defecto se escriben con el literal a la vista
 * (`"₡13.331.832,72"`) A PROPOSITO: derivarlas de la propia configuracion las
 * volveria tautologicas —el formato saldria "bien" fuera cual fuera— y el
 * requisito humano de esta ficha es exactamente ese literal. Que el formato NO
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

describe("formatMontoString — el formato objetivo (miles con punto, cola si existe)", () => {
  it("agrupa los miles y CONSERVA la cola cuando el importe la tiene", () => {
    expect(formatMontoString("13331832.72")).toBe("₡13.331.832,72");
    expect(formatMontoString("12345678901.99")).toBe("₡12.345.678.901,99");
    expect(formatMontoString("1500.50")).toBe("₡1.500,50");
    expect(formatMontoString("1234.49")).toBe("₡1.234,49");
    expect(formatMontoString("1234.50")).toBe("₡1.234,50");
    expect(formatMontoString("1234.56")).toBe("₡1.234,56");
    expect(formatMontoString("99.99")).toBe("₡99,99");
    expect(formatMontoString("0.10")).toBe("₡0,10");
  });

  it("y la ESCONDE cuando no la tiene: el `,00` no vuelve (lo que quito la 230)", () => {
    // La otra mitad de la regla, y la que se pierde si alguien "simplifica" el
    // modulo a un `toFixed(2)` de toda la vida. El humano pidio quitar esos dos
    // decimales y la 359 solo se los devuelve a quien de verdad los tiene.
    expect(formatMontoString("-4500.00")).toBe("-₡4.500");
    expect(formatMontoString("100.00")).toBe("₡100");
    expect(formatMontoString("0.00")).toBe("₡0");
    // Y da lo MISMO que el importe sin cola ninguna: son el mismo dinero.
    expect(formatMontoString("1234.00")).toBe(formatMontoString("1234"));
    for (const importe of ["-4500.00", "100.00", "0.00", "1234.00"]) {
      expect(formatMontoString(importe), importe).not.toContain(monedaConfig.separadorDecimal);
    }
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
    // Los mismos bordes ALCANZADOS POR EL ACARREO. Con la ficha 359 el acarreo
    // vive una escala mas abajo —hace falta un TERCER decimal para provocarlo—,
    // pero cuando ocurre sigue teniendo que reagrupar: si se agrupara primero,
    // `999,999` saldria "₡9991" o "₡1000" sin punto.
    expect(formatMontoString("999.999")).toBe("₡1.000");
    expect(formatMontoString("999999.999")).toBe("₡1.000.000");

    // Y dicho de la forma en que se rompe: ningun resultado EMPIEZA por el
    // separador, ni justo detras del simbolo ni justo detras del signo.
    for (const importe of [
      "999",
      "1000",
      "1000000",
      "999.99",
      "-1000.00",
      "999.999",
      "-999.999",
    ]) {
      expect(formatMontoString(importe), importe).not.toMatch(/^-?₡\./);
    }
  });

  it("el signo negativo va DELANTE del simbolo", () => {
    expect(formatMontoString("-4500.00")).toBe("-₡4.500");
    expect(formatMontoString("-0.50")).toBe("-₡0,50");
    expect(formatMontoString("-13331832.72")).toBe("-₡13.331.832,72");
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

describe("formatMontoString — el cuadre a la escala de presentacion (ficha 359)", () => {
  it("la escala de presentacion ES la del dato y la de la frontera", () => {
    // El numero del que cuelga todo lo demas. Si bajara, formatear volveria a
    // perder informacion y las identidades de pantalla se descuadrarian: es
    // exactamente el defecto que esta ficha mata.
    expect(ESCALA_PRESENTACION).toBe(2);
  });

  it("el medio se aleja del cero, tambien en negativo (R2, D1)", () => {
    // El redondeo NO desaparecio con la 359: se mudo una escala mas abajo. Hace
    // falta un tercer decimal —fuera del contrato de la frontera— para verlo.
    expect(formatMontoString("1234.505")).toBe("₡1.234,51");
    expect(formatMontoString("-1234.505")).toBe("-₡1.234,51");
    expect(formatMontoString("0.005")).toBe("₡0,01");
    expect(formatMontoString("-0.005")).toBe("-₡0,01");
    // Y por debajo del medio baja, con el mismo simetrico en negativo.
    expect(formatMontoString("1234.494")).toBe("₡1.234,49");
    expect(formatMontoString("-1234.494")).toBe("-₡1.234,49");
  });

  it("el acarreo puede desbordar la cola y REAGRUPAR los miles (R3)", () => {
    // La razon por la que el cuadre va antes de agrupar y nunca despues. Ahora
    // el acarreo tiene que atravesar DOS fronteras: la de la cola y la de los
    // miles.
    expect(formatMontoString("999.999")).toBe("₡1.000");
    expect(formatMontoString("9.999")).toBe("₡10");
    expect(formatMontoString("99.999")).toBe("₡100");
    expect(formatMontoString("999999.999")).toBe("₡1.000.000");
    expect(formatMontoString("-999.999")).toBe("-₡1.000");
    // Acarreo que atraviesa una cadena de nueves entera sin quedarse a medias.
    expect(formatMontoString("9999.9999")).toBe("₡10.000");
    expect(formatMontoString("99999999999.999")).toBe("₡100.000.000.000");
    // Y el que se queda DENTRO de la cola: sube el centimo y no toca los enteros.
    expect(formatMontoString("999.995")).toBe("₡1.000");
    expect(formatMontoString("999.985")).toBe("₡999,99");
  });

  it("EL BORDE QUE SE DIO LA VUELTA: `999,50` ya no se convierte en mil", () => {
    // Era EL caso de la feature 230 —«el acarreo que cambia el numero de
    // digitos»— y hoy es su contrario: con la cola visible no hay nada que
    // acarrear, y la cifra se queda donde el servidor la dejo.
    expect(formatMontoString("999.50")).toBe("₡999,50");
    expect(formatMontoString("999.50")).not.toBe("₡1.000");
    expect(formatMontoString("9.99")).toBe("₡9,99");
    expect(formatMontoString("99.99")).toBe("₡99,99");
    expect(formatMontoString("999999.99")).toBe("₡999.999,99");
    expect(formatMontoString("9999.95")).toBe("₡9.999,95");
    expect(formatMontoString("99999999999.51")).toBe("₡99.999.999.999,51");
  });

  it("el cero NO lleva signo, y el que no es cero SI lo conserva (R4)", () => {
    // "menos cero" no es una cantidad que nadie quiera leer en una pantalla.
    expect(formatMontoString("-0.00")).toBe("₡0");
    expect(formatMontoString("-0")).toBe("₡0");
    expect(formatMontoString("-0.000")).toBe("₡0");
    for (const importe of ["-0.00", "-0", "-0.000"]) {
      expect(formatMontoString(importe), importe).not.toContain("-");
    }
    // EL OTRO BORDE QUE SE DIO LA VUELTA: `-0,49` ya no se cuadra a cero, asi que
    // el signo se queda. Con la 230 esto pintaba `₡0` — un importe que existe,
    // escondido detras de un cero.
    expect(formatMontoString("-0.49")).toBe("-₡0,49");
    expect(formatMontoString("-0.4")).toBe("-₡0,40");
    expect(formatMontoString("0.49")).toBe("₡0,49");
  });

  it("con mas decimales que la escala manda el PRIMERO que sobra (R6)", () => {
    expect(formatMontoString("10.4999")).toBe("₡10,50");
    expect(formatMontoString("10.5001")).toBe("₡10,50");
    expect(formatMontoString("10.500")).toBe("₡10,50");
    expect(formatMontoString("10.4")).toBe("₡10,40");
    // `0,9999` no acumula hasta 1 por sumar los decimales: sube porque el
    // TERCERO es `9`. Es la misma regla, no una excepcion.
    expect(formatMontoString("0.9999")).toBe("₡1");
  });

  it("un importe sin parte decimal se pinta como siempre: ni inventa ni altera digitos (R5)", () => {
    // Inventar una cola seria afirmar una escala que el servidor no mando, y
    // ademas devolveria los `,00` que la 230 quito.
    expect(formatMontoString("320")).toBe("₡320");
    expect(formatMontoString("1234567")).toBe("₡1.234.567");
    expect(formatMontoString("1500")).toBe("₡1.500");
    expect(formatMontoString("0")).toBe("₡0");
  });

  it("la cola, cuando sale, tiene EXACTAMENTE los digitos de la escala (R1)", () => {
    // Ni `₡1.234,5` ni `₡1.234,567`. El barrido ancho —los seis caminos, con
    // corpus de mas de 100 casos y oraculo `Prisma.Decimal`— vive en la guardia
    // `dinero-centimos-cuando-existen`; aqui se fija en el sitio donde el
    // comportamiento se define.
    const separador = monedaConfig.separadorDecimal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bienFormada = new RegExp(`^-?₡[\\d.]+(${separador}\\d{2})?$`);
    for (const importe of [
      "13331832.72",
      "1500.50",
      "0.10",
      "-4500.00",
      "999.50",
      "10.4999",
      "-0.49",
      "12345678901.99",
      "10.4",
      "0.005",
    ]) {
      expect(formatMontoString(importe), importe).toMatch(bienFormada);
    }
    // Contraprueba del patron: una cola de UN digito NO pasaria.
    expect(bienFormada.test(`₡1.234${monedaConfig.separadorDecimal}5`)).toBe(false);
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
    expect(formatMonto(13331832.72)).toBe("₡13.331.832,72");
    expect(formatMonto(1500.5)).toBe("₡1.500,50");
    expect(formatMonto(99.99)).toBe("₡99,99");
    expect(formatMonto(0)).toBe("₡0");
  });

  it("el negativo lleva el signo delante del simbolo, igual que el de STRING", () => {
    expect(formatMonto(-4500)).toBe("-₡4.500");
    expect(formatMonto(-4500)).toBe(formatMontoString("-4500.00"));
    // Y el negativo pequeño CONSERVA su cola y su signo (ficha 359).
    expect(formatMonto(-0.49)).toBe("-₡0,49");
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

  it("los dos caminos convergen: el mismo importe se pinta igual venga como numero o como string", () => {
    expect(formatMonto(320)).toBe("₡320");
    expect(formatMontoString("320")).toBe("₡320");
    expect(formatMonto(320)).toBe(formatMontoString("320"));
    expect(formatMonto(1000)).toBe("₡1.000");
    expect(formatMonto(1000)).toBe(formatMontoString("1000"));
  });

  it("C3 — el doble cuadre del camino numerico, declarado y fijado", () => {
    // `formatMonto` serializa con `toFixed(ESCALA)` ANTES de pasar por el modulo,
    // asi que un numero con MAS decimales que la escala se cuadra dos veces: la
    // primera la hace el motor de JS en binario y puede no coincidir con la del
    // modulo sobre el string.
    //
    // No es un descuido: la escala 2 es la del CONTRATO de la frontera y bajarla
    // aqui delegaria mas trabajo aun en el motor binario. El borde solo aparece
    // con entradas que YA estan fuera del contrato de escala 2.
    //
    // FICHA 359 — el EJEMPLO tuvo que cambiar. Con la 230 el caso era `1234.4951`
    // (subia por el camino numerico y bajaba por el de string); con la escala de
    // presentacion en 2 ese numero converge, y el borde se ha mudado al tercer
    // decimal: `1.005` no es representable en binario (`1.00499…`), asi que
    // `toFixed(2)` lo baja y el modulo, leyendo el string, lo sube.
    expect(formatMonto(1.005)).toBe("₡1");
    expect(formatMontoString("1.005")).toBe("₡1,01");
    expect(formatMonto(1.005)).not.toBe(formatMontoString("1.005"));
    // Dentro del contrato (dos decimales) los dos caminos coinciden siempre.
    expect(formatMonto(1234.49)).toBe(formatMontoString("1234.49"));
    expect(formatMonto(1234.5)).toBe(formatMontoString("1234.50"));
    expect(formatMonto(1234.4951)).toBe(formatMontoString("1234.4951"));
  });

  it("ya no agrupa con el espacio fino de `Intl`", () => {
    expect(formatMonto(13331832.72)).not.toMatch(/[\s  ]/);
  });
});

describe("montoExacto — el sexto formateador, retirado a alias (feature 300 / ficha 359)", () => {
  it("es `formatMonto` byte a byte: ya no tiene cuerpo propio", () => {
    // La 300 lo escribio aparte porque el formateador de entonces cuadraba al
    // colon y en esa pantalla esconder la cola bloqueaba al mensajero. Desde la
    // 359 el formateador base ya hace eso, asi que una segunda implementacion de
    // la misma regla solo podria divergir.
    for (const monto of [11898.81, 11899, 0, -0.19, 0.05, 1500.5, 13331832.72, -4500]) {
      expect(montoExacto(monto), `${monto}`).toBe(formatMonto(monto, SIN_MONTO_RAYA));
    }
    // Y el caso de la captura que motivo la 300 sigue dando lo mismo que daba.
    expect(montoExacto(11898.81)).toBe("₡11.898,81");
    expect(montoExacto(0.81)).toBe("₡0,81");
    expect(montoExacto(-0.19)).toBe("-₡0,19");
  });

  it("y ahora TODA la app ve lo mismo que veia solo esa pantalla", () => {
    // El punto de la ficha: lo que la 300 arreglo en un sitio ya no es una
    // excepcion. `money` y `formatMonto` dan la misma cadena que `montoExacto`.
    expect(money("11898.81")).toBe(montoExacto(11898.81));
    expect(formatMonto(11898.81)).toBe(montoExacto(11898.81));
  });
});

describe("formatMontoTope / moneyTope — la COTA nunca se cuadra al alza", () => {
  it("para todo lo que emite el servidor (escala 2) es la MISMA cadena que `money`", () => {
    // Si no lo fuera, un «como maximo ₡X» diria un numero distinto del que se lee
    // al lado, y la identidad del reparto dejaria de cerrar en pantalla.
    for (const importe of ["4500.35", "9999999999.99", "0.00", "999.50", "1234.56", "-0.49"]) {
      expect(moneyTope(importe), importe).toBe(money(importe));
      expect(formatMontoTope(importe), importe).toBe(formatMontoString(importe));
    }
  });

  it("pero con mas cola de la que se pinta se queda POR DEBAJO, y el otro sube", () => {
    // Aqui es donde las dos reglas se separan, y es la unica razon por la que
    // `moneyTope` sigue existiendo despues de la ficha 359.
    expect(formatMontoTope("999.999")).toBe("₡999,99");
    expect(formatMontoString("999.999")).toBe("₡1.000");
    expect(formatMontoTope("9999999999.999")).toBe("₡9.999.999.999,99");
    expect(formatMontoString("9999999999.999")).toBe("₡10.000.000.000");
  });

  it("el tope de la indemnizacion se anuncia EXACTO, y ya no 99 centimos por debajo", () => {
    // Con la 230 este tope se pintaba `₡9.999.999.999` —cortando por el punto—,
    // que era el lado seguro pero contradecia el «(10 digitos y 2 decimales)» de
    // su propia frase. Con la escala de presentacion en 2, el mensaje anuncia
    // exactamente el limite que el validador acepta.
    expect(formatMontoTope("9999999999.99")).toBe("₡9.999.999.999,99");
    expect(formatMontoTope("9999999999.99")).not.toBe("₡9.999.999.999");
  });

  it("comparte los marcadores de ausencia y la rama verbatim con el formateador base", () => {
    expect(formatMontoTope(null)).toBe(SIN_MONTO);
    expect(moneyTope(null)).toBe(SIN_MONTO_RAYA);
    expect(formatMontoTope("")).toBe(SIN_MONTO);
    expect(formatMontoTope("1.2.3")).toBe("₡1.2.3");
  });

  it("⚠ es para una cota POSITIVA: con un tope negativo cuadrar hacia el cero es SUBIR", () => {
    // Esta escrito en el docstring del modulo y se fija aqui para que sea una
    // decision y no una sorpresa: `-3.999` sale `-₡3,99`, que es MAYOR que el
    // valor recibido. Los topes de columna de este repo son todos positivos.
    expect(formatMontoTope("-3.999")).toBe("-₡3,99");
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
    // Entre la 230 y la 359 este test solo podia mover el separador de MILES,
    // porque no habia cola que separar. Con la regla nueva vuelven a moverse los
    // dos, que es lo que el campo `separadorDecimal` existia para gobernar.
    const { formatMontoString: formatear, formatMonto: formatearNumero } = await conConfiguracion({
      MONEDA_SIMBOLO: "$",
      MONEDA_SEPARADOR_MILES: ",",
      MONEDA_SEPARADOR_DECIMAL: ".",
    });

    expect(formatear("13331832.72")).toBe("$13,331,832.72");
    expect(formatear("999")).toBe("$999");
    expect(formatear("-4500.00")).toBe("-$4,500");
    expect(formatearNumero(1500.5)).toBe("$1,500.50");
    expect(formatear("13331832.72")).not.toContain("₡");
  });

  it("cambiar el separador DECIMAL SI altera la salida, y solo donde hay cola (ficha 359)", async () => {
    // El campo volvio a gobernar la salida. Se afirma en las dos direcciones: el
    // importe con cola lo lleva, y el redondo sigue sin llevarlo — porque no hay
    // nada que separar, no porque el campo este muerto.
    const { formatMontoString: formatear, monedaConfig: cfg } = await conConfiguracion({
      MONEDA_SEPARADOR_DECIMAL: "¤",
    });

    expect(cfg.separadorDecimal).toBe("¤");
    expect(formatear("13331832.72")).toBe("₡13.331.832¤72");
    expect(formatear("1500.50")).toBe("₡1.500¤50");
    expect(formatear("1500.00")).toBe("₡1.500");
    expect(formatear("1500.00")).not.toContain("¤");
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

    // Y el unico `toFixed` del modulo es el de la escala de presentacion. Se
    // afirma por la CONSTANTE y no por el literal `2` porque el modulo la nombra:
    // ese es justo el punto —la escala del formato y la de la frontera son la
    // misma decision y no pueden separarse por un descuido de tipeo—.
    const usos = [...codigo.matchAll(/\.toFixed\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(usos).toEqual(["ESCALA"]);
    expect(ESCALA_PRESENTACION).toBe(2);
  });

  it("el formato de un importe que un `number` no puede representar es EXACTO", () => {
    // Este es el test que demuestra que el modulo trabaja digito a digito. Con la
    // 230 lo demostraba REDONDEANDO once digitos; con la 359 lo demuestra
    // conservando la cola de once digitos sin tocar la parte entera, que es igual
    // de exigente: un camino que convirtiera a numero perderia el ultimo digito.
    expect(formatMontoString("12345678901.99")).toBe("₡12.345.678.901,99");
    expect(formatMontoString("99999999999.51")).toBe("₡99.999.999.999,51");
    expect(formatMontoString("99999999999.49")).toBe("₡99.999.999.999,49");
    expect(formatMontoString("99999999999.01")).toBe("₡99.999.999.999,01");
    // Y el acarreo, cuando de verdad hay que hacerlo, atraviesa los once nueves
    // de golpe y añade un digito: si se quedara a medias, la agrupacion lo
    // delataria.
    expect(formatMontoString("99999999999.999")).toMatch(/^₡100(\.000){3}$/);
    // CONTRAPRUEBA, Y HONESTA SOBRE SU ALCANCE. Se midio: dentro de la escala
    // real del repo —`DECIMAL(12,2)`— un `double` SI consigue devolver el string
    // exacto (`Number("99999999999.51").toFixed(2)` da la cadena de vuelta). La
    // prohibicion de convertir no es que hoy se rompa: es que el resultado
    // dependeria del tamaño del importe, y esa es una garantia que no se puede
    // razonar en el sitio de llamada. El punto en que el `double` deja de poder
    // esta a dos digitos de distancia:
    expect(Number("99999999999.51").toFixed(2)).toBe("99999999999.51");
    expect(Number("99999999999999.99").toFixed(2)).not.toBe("99999999999999.99");
    // Y el modulo, que no convierte, lo pinta bien tambien ahi.
    expect(formatMontoString("99999999999999.99")).toBe("₡99.999.999.999.999,99");
  });
});
