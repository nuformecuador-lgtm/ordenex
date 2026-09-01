import { describe, it, expect } from "vitest";

import {
  loadComposicionDetalleConfig,
  composicionDetalleConfig,
} from "@/lib/config/composicion-detalle";
import { listarMovimientosDeFilaSchema } from "@/lib/types/wallet";

/**
 * Ficha 339 (T3.1, design §4.6) — el tamano de pagina del DETALLE de una fila y su tope salen
 * de la CONFIGURACION. Cubre **R29 y R30**.
 *
 * POR QUE ESTE ARCHIVO Y NO `paginacion-dominios.test.ts`. Ese archivo es el censo de los TRECE
 * listados del Anexo III de la ficha 170 y cierra con `expect(listados).toHaveLength(13)`, que
 * significa eso literalmente. El detalle de una fila NO es uno de esos trece: es un desplegable
 * por fila, como el desglose de una tienda —que por el mismo motivo tampoco esta ahi—. Meterlo
 * alli falsearia la afirmacion de aquel censo; el dominio nuevo trae su propia red, con las
 * mismas cuatro comprobaciones.
 *
 * Los valores por defecto se escriben A MANO (10 y 50) y no se leen de la propia config: una
 * asercion contra su propia fuente esta siempre verde y no distingue nada.
 */

const ENV_DEFAULT = "COMPOSICION_DETALLE_DEFAULT_PAGE_SIZE";
const ENV_MAX = "COMPOSICION_DETALLE_MAX_PAGE_SIZE";

function conEntorno<T>(valores: Record<string, string | undefined>, fn: () => T): T {
  const previos = Object.fromEntries(
    Object.keys(valores).map((clave) => [clave, process.env[clave]]),
  );
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }
  try {
    return fn();
  } finally {
    for (const [clave, valor] of Object.entries(previos)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  }
}

describe("lib/config/composicion-detalle (R29/R30)", () => {
  it("R29: declara los DOS numeros, con los valores por defecto de la ficha (10 y 50)", () => {
    conEntorno({ [ENV_DEFAULT]: undefined, [ENV_MAX]: undefined }, () => {
      const cfg = loadComposicionDetalleConfig();
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(10);
      expect(cfg.MAX_PAGE_SIZE).toBe(50);
    });
  });

  it("R29: el default NO supera al tope (una pagina que la propia config recortaria)", () => {
    const cfg = loadComposicionDetalleConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
    expect(cfg.MAX_PAGE_SIZE).toBeGreaterThan(0);
    expect(cfg.DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(cfg.MAX_PAGE_SIZE);
  });

  it("R30: el entorno sobreescribe los dos numeros, sin tocar codigo", () => {
    conEntorno({ [ENV_DEFAULT]: "3", [ENV_MAX]: "7" }, () => {
      const cfg = loadComposicionDetalleConfig();
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(3);
      expect(cfg.MAX_PAGE_SIZE).toBe(7);
      // Y son valores DISTINTOS de los de por defecto: si el override no se aplicara, esta
      // comparacion lo diria en vez de pasar por casualidad.
      expect(cfg.DEFAULT_PAGE_SIZE).not.toBe(10);
      expect(cfg.MAX_PAGE_SIZE).not.toBe(50);
    });
  });

  it("R30: un valor basura NO se cuela — cae al valor por defecto", () => {
    for (const basura of ["abc", "-5", "0", "", "   "]) {
      conEntorno({ [ENV_DEFAULT]: basura, [ENV_MAX]: basura }, () => {
        const cfg = loadComposicionDetalleConfig();
        expect(cfg.DEFAULT_PAGE_SIZE, basura).toBe(10);
        expect(cfg.MAX_PAGE_SIZE, basura).toBe(50);
      });
    }
  });

  it("el limite CONOCIDO del molde: `parseInt` acepta el prefijo numerico («12abc» → 12)", () => {
    // Medido, no supuesto. `readPositiveInt` es el molde COMPARTIDO por los ocho dominios de
    // configuracion de paginacion de este repo (`lib/config/gasto-fijo.ts` y hermanos), y
    // `Number.parseInt("12abc", 10)` vale 12. Queda escrito aqui —en vez de fingir que un valor
    // asi cae al default— porque endurecerlo solo en este dominio abriria dos criterios
    // distintos de «que es un entero valido» para la misma clase de variable de entorno; y
    // porque un cambio de molde tiene que verse en un diff, no descubrirse en produccion.
    conEntorno({ [ENV_DEFAULT]: "12abc", [ENV_MAX]: "60xyz" }, () => {
      const cfg = loadComposicionDetalleConfig();
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(12);
      expect(cfg.MAX_PAGE_SIZE).toBe(60);
    });
  });

  it("R29: el BORDE toma de esta config su default y su tope — no de un literal propio", () => {
    // La otra mitad de R29: que la config exista no sirve de nada si el schema del detalle
    // escribiera sus propios numeros. Se mide por COMPORTAMIENTO del schema, que es lo que
    // corre en produccion.
    const sinPagina = listarMovimientosDeFilaSchema.parse({ fila: "egreso_pago_mensajero" });
    expect(sinPagina.pageSize).toBe(composicionDetalleConfig.DEFAULT_PAGE_SIZE);
    expect(sinPagina.pageSize).toBe(10);
    expect(sinPagina.page).toBe(1);

    // El tope, en sus dos lados: justo en el maximo pasa, uno por encima es ZodError.
    const enElTope = listarMovimientosDeFilaSchema.parse({
      fila: "egreso_pago_mensajero",
      pageSize: composicionDetalleConfig.MAX_PAGE_SIZE,
    });
    expect(enElTope.pageSize).toBe(50);
    expect(() =>
      listarMovimientosDeFilaSchema.parse({
        fila: "egreso_pago_mensajero",
        pageSize: composicionDetalleConfig.MAX_PAGE_SIZE + 1,
      }),
    ).toThrow();
    // Y el tope del detalle NO es el del libro (100): si el schema hubiera heredado el literal
    // del listado en vez de leer la config, 100 seria admisible y esto lo dice.
    expect(() =>
      listarMovimientosDeFilaSchema.parse({ fila: "egreso_pago_mensajero", pageSize: 100 }),
    ).toThrow();
  });
});
