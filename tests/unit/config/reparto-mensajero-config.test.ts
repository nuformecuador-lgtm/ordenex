import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { loadRepartoMensajeroConfig } from "@/lib/config/reparto-mensajero";
import { codigoSinComentarios, quitarComentarios } from "../../fixtures/money-safe";

/**
 * Feature 205 (T0.4, R53) — el tope de imputaciones de UN reparto vive en UN solo punto,
 * vale 50 mientras nadie lo cambie y se puede cambiar sin tocar el calculo del reparto.
 *
 * Se ejercita `loadRepartoMensajeroConfig()` (RECARGA), no la constante `repartoMensajeroConfig`
 * ya evaluada: esa se congelo al importar el modulo y no veria ningun cambio de entorno, asi que
 * un test contra ella pasaria en verde sin comprobar la sobreescritura.
 */

const KEY = "REPARTO_MENSAJERO_MAX_CIERRES";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

const max = () => loadRepartoMensajeroConfig().MAX_CIERRES_POR_REPARTO;

describe("loadRepartoMensajeroConfig (R53)", () => {
  it("DEFAULT: sin variable de entorno, el tope vale 50", () => {
    withEnv(undefined, () => {
      expect(max()).toBe(50);
    });
  });

  it("la variable de entorno lo cambia sin desplegar codigo", () => {
    withEnv("12", () => {
      expect(max()).toBe(12);
    });
    withEnv("500", () => {
      expect(max()).toBe(500);
    });
  });

  it("un valor no positivo cae al defecto (0 y negativo no son un tope util)", () => {
    withEnv("0", () => {
      expect(max()).toBe(50);
    });
    withEnv("-3", () => {
      expect(max()).toBe(50);
    });
  });

  it("un valor basura o vacio cae al defecto, nunca a NaN", () => {
    for (const basura of ["", "   ", "cincuenta", "abc50", "null", "undefined"]) {
      withEnv(basura, () => {
        expect(max(), `entrada ${JSON.stringify(basura)}`).toBe(50);
      });
    }
  });

  it("un decimal se trunca a su parte entera (no explota ni cae al defecto)", () => {
    // Documenta lo que `parseInt` hace de verdad, para que nadie lo descubra en produccion.
    withEnv("7.9", () => {
      expect(max()).toBe(7);
    });
  });

  it("R53: el tope se declara en UN solo punto — nadie mas escribe el 50", () => {
    // El valor solo puede vivir aqui: quien lo necesita lo recibe inyectado (el servicio en su
    // construccion, la funcion pura por parametro). Si aparece un `50` suelto en el modulo del
    // reparto, hay dos numeros que pueden divergir y R57 deja de estar garantizado.
    // Sobre el CODIGO, no sobre el texto crudo: la cabecera del modulo puro CITA a proposito
    // que no lee el entorno, y un barrido literal fallaria por citarlo (mismo motivo que
    // `tests/fixtures/money-safe.ts`).
    const raiz = path.resolve(__dirname, "../../..");
    const puro = quitarComentarios(
      readFileSync(path.join(raiz, "lib/utils/reparto-liquidacion-mensajero.ts"), "utf8"),
    );
    expect(puro).not.toMatch(/\bMAX_CIERRES_POR_REPARTO\b/);
    expect(puro).not.toMatch(/reparto-mensajero/);
    // Y el modulo puro no lee el entorno: el tope entra por parametro (design §2.5.2).
    expect(puro).not.toMatch(/process\.env/);
  });

  it("R53: el SERVICIO tampoco lo escribe — su tope por defecto sale de aqui", () => {
    // El barrido de arriba alcanza al modulo PURO, que recibe el tope por parametro. El otro
    // sitio donde puede aparecer la segunda copia es el DEFAULT del constructor del servicio,
    // y ese no lo miraba nadie: poner ahi `= 50` literal —la copia que el propio docstring de
    // `LiquidacionService` prohibe— deja 3141 tests en verde y `tsc --noEmit` limpio, porque el
    // 50 del literal y el 50 de esta configuracion valen lo mismo HOY. El dia que alguien
    // cambie la variable de entorno, dejan de valerlo y el servicio sigue con el suyo.
    //
    // Por eso lo que se afirma no es el VALOR del default —seria la misma coincidencia otra
    // vez— sino DE DONDE sale.
    // El corte arranca en la CLASE y no en el primer `constructor(` del archivo: por delante
    // hay cuatro clases de error con el suyo, y cortar desde ahi se traga trescientas lineas
    // ajenas —entre ellas cualquier numero que alguna escriba— y convierte este caso en un
    // barrido sobre otra cosa.
    const servicio = codigoSinComentarios("lib/services/LiquidacionService.ts");
    const clase = servicio.slice(servicio.indexOf("export class LiquidacionService"));
    const abre = clase.indexOf("constructor(");
    const constructor = clase.slice(abre, clase.indexOf(") {}", abre));
    // Autocomprobaciones: sin ellas, un corte que no encuentra nada dejaria las dos aserciones
    // de abajo pasando sobre la cadena vacia, que es un verde que no comprueba nada.
    expect(servicio).toContain("export class LiquidacionService");
    expect(abre).toBeGreaterThan(-1);
    expect(constructor).toContain("private readonly pagoRepo");
    expect(constructor).not.toContain("class ");

    expect(constructor).toMatch(
      /maxCierresPorReparto:\s*number\s*=\s*repartoMensajeroConfig\.MAX_CIERRES_POR_REPARTO\b/,
    );
    // Y NINGUN parametro del constructor trae un numero por defecto. Es mas ancho que el tope a
    // proposito: cualquier cota de negocio con valor por defecto escrito ahi es una segunda
    // copia, se llame como se llame. El reloj (`= () => new Date()`) no es un numero y pasa.
    expect(constructor).not.toMatch(/=\s*-?\d/);
  });

  it("design §2.5.2: este modulo no maneja dinero ni casa con la auto-captura del barrido", () => {
    // Los dos hechos que sostienen que este archivo NO este en el censo money-safe. Si alguien
    // lo renombra a `liquidacion-*` o le mete un `Prisma.Decimal`, este test lo dice aqui en vez
    // de que el barrido caiga con un falso positivo tres tandas despues.
    const raiz = path.resolve(__dirname, "../../..");
    const ruta = "lib/config/reparto-mensajero.ts";
    expect(ruta).not.toMatch(/[Ll]iquidacion/);

    const fuente = readFileSync(path.join(raiz, ruta), "utf8");
    expect(fuente).not.toMatch(/from\s+"@prisma\/client"/);
    expect(fuente).not.toMatch(/\bDecimal\b/);
    expect(fuente).not.toMatch(/\btoFixed\s*\(/);
  });
});
