import { describe, it, expect } from "vitest";

import {
  loadDetalleMovimientoConfig,
  detalleMovimientoConfig,
} from "@/lib/config/detalle-movimiento";
import { verDetalleDeMovimientoSchema } from "@/lib/types/detalle-movimiento";

/**
 * Ficha 344 (T2.1, design §3.6) — el tamano de pagina del DETALLE de un movimiento y su tope
 * salen de la CONFIGURACION. Cubre **R26 y R27**.
 *
 * POR QUE ESTE ARCHIVO Y NO `paginacion-dominios.test.ts`: ese archivo es el censo de los TRECE
 * listados del Anexo III de la ficha 170 y cierra con un `toHaveLength(13)` que significa eso
 * literalmente. Este desplegable no es uno de ellos —es un panel por fila, como el de la ficha
 * 339, que por el mismo motivo tampoco esta alli—. Meterlo falsearia aquella afirmacion.
 *
 * Los valores por defecto se escriben A MANO (25 y 100) y no se leen de la propia config: una
 * asercion contra su propia fuente esta siempre verde y no distingue nada.
 */

const ENV_DEFAULT = "DETALLE_MOVIMIENTO_DEFAULT_PAGE_SIZE";
const ENV_MAX = "DETALLE_MOVIMIENTO_MAX_PAGE_SIZE";

const UN_MOVIMIENTO = "11111111-2222-4333-8444-555555555555";

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

describe("lib/config/detalle-movimiento (R26/R27)", () => {
  it("el tamano y el tope salen de la configuracion, con los valores de la ficha (25 y 100)", () => {
    conEntorno({ [ENV_DEFAULT]: undefined, [ENV_MAX]: undefined }, () => {
      const cfg = loadDetalleMovimientoConfig();
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
      expect(cfg.MAX_PAGE_SIZE).toBe(100);
    });
  });

  it("R26: el default NO supera al tope (una pagina que la propia config recortaria)", () => {
    const cfg = loadDetalleMovimientoConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
    expect(cfg.MAX_PAGE_SIZE).toBeGreaterThan(0);
    expect(cfg.DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(cfg.MAX_PAGE_SIZE);
  });

  it("respeta el override de entorno e ignora el valor basura", () => {
    conEntorno({ [ENV_DEFAULT]: "4", [ENV_MAX]: "9" }, () => {
      const cfg = loadDetalleMovimientoConfig();
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(4);
      expect(cfg.MAX_PAGE_SIZE).toBe(9);
      // Y son valores DISTINTOS de los de por defecto: si el override no se aplicara, esta
      // comparacion lo diria en vez de pasar por casualidad.
      expect(cfg.DEFAULT_PAGE_SIZE).not.toBe(25);
      expect(cfg.MAX_PAGE_SIZE).not.toBe(100);
    });

    for (const basura of ["abc", "-5", "0", "", "   "]) {
      conEntorno({ [ENV_DEFAULT]: basura, [ENV_MAX]: basura }, () => {
        const cfg = loadDetalleMovimientoConfig();
        expect(cfg.DEFAULT_PAGE_SIZE, basura).toBe(25);
        expect(cfg.MAX_PAGE_SIZE, basura).toBe(100);
      });
    }
  });

  it("el limite CONOCIDO del molde: `parseInt` acepta el prefijo numerico («12abc» -> 12)", () => {
    // Medido, no supuesto. `readPositiveInt` es el molde COMPARTIDO por los dominios de
    // configuracion de paginacion de este repo, y `Number.parseInt("12abc", 10)` vale 12. Queda
    // escrito aqui —en vez de fingir que un valor asi cae al default— porque endurecerlo solo en
    // este dominio abriria dos criterios distintos de «que es un entero valido» para la misma
    // clase de variable de entorno.
    conEntorno({ [ENV_DEFAULT]: "12abc", [ENV_MAX]: "60xyz" }, () => {
      const cfg = loadDetalleMovimientoConfig();
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(12);
      expect(cfg.MAX_PAGE_SIZE).toBe(60);
    });
  });

  it("R26/R29: el BORDE toma de esta config su default y su tope — no de un literal propio", () => {
    // Que la config exista no sirve de nada si el schema escribiera sus propios numeros. Se mide
    // por COMPORTAMIENTO del schema, que es lo que corre en produccion.
    const sinPagina = verDetalleDeMovimientoSchema.parse({ movimientoId: UN_MOVIMIENTO });
    expect(sinPagina.pageSize).toBe(detalleMovimientoConfig.DEFAULT_PAGE_SIZE);
    expect(sinPagina.pageSize).toBe(25);
    expect(sinPagina.page).toBe(1);

    // El tope, en sus dos lados: justo en el maximo pasa, uno por encima es ZodError.
    const enElTope = verDetalleDeMovimientoSchema.parse({
      movimientoId: UN_MOVIMIENTO,
      pageSize: detalleMovimientoConfig.MAX_PAGE_SIZE,
    });
    expect(enElTope.pageSize).toBe(100);
    expect(() =>
      verDetalleDeMovimientoSchema.parse({
        movimientoId: UN_MOVIMIENTO,
        pageSize: detalleMovimientoConfig.MAX_PAGE_SIZE + 1,
      }),
    ).toThrow();
  });
});
