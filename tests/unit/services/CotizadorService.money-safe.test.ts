import { describe, expect, it, vi } from "vitest";

import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CotizadorService } from "@/lib/services/CotizadorService";
import type { CotizacionApiEntrada, CotizacionConCostos } from "@/lib/types/cotizador";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// Feature 248 (T5, R29) — MONEY-SAFE DE PUNTA A PUNTA.
//
// Todo importe de la respuesta es un STRING de escala 2 derivado de `Prisma.Decimal` con
// `ROUND_HALF_UP`. Ningun `number` cruza la salida: un importe en `number` viaja a JSON como
// `3474.75` y el primer consumidor que lo sume en JavaScript hereda el error de binario que esta
// feature existe para no cometer (`ingreso-ordenex.ts:121-146`). Aplica IGUAL al neto NEGATIVO
// del escenario devuelta, que es donde un formateo descuidado suele colar un `-0` o un `-1695`.
//
// El recorrido es EXHAUSTIVO sobre el subarbol `escenarios` (no una lista de claves escrita a
// mano): una clave nueva que naciera en `number` caeria en este test sin que nadie lo actualice.

const IMPORTE = /^-?\d+\.\d{2}$/;

const TARIFA: TarifaVigente = {
  valorFlete: "1999.99",
  valorFleteGam: "2200.005", // fuerza HALF_UP en el flete: 2200,005 -> 2200,01
  valorFleteDevuelto: "1400.00",
  valorFleteDevueltoGam: "1500.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

const ACTOR: Actor = { usuarioId: "tienda-de-la-key", rol: "apiKey" };

function service(tarifa: TarifaVigente | null = TARIFA): CotizadorService {
  const cobertura: ICoberturaService = {
    consultar: vi.fn().mockResolvedValue({
      estado: "cubierto",
      distritoId: "d1",
      zonaId: "z1",
      zonaNombre: "GAM",
      esCentral: true,
    }),
  };
  const tarifas: ITarifaVigentePorTiendaRepository = {
    resolveTarifaPorTienda: vi.fn().mockResolvedValue(tarifa),
    resolveTarifasPorTiendas: vi.fn(),
  };
  return new CotizadorService(cobertura, tarifas);
}

function entrada(over: Partial<CotizacionApiEntrada> = {}): CotizacionApiEntrada {
  return {
    provincia: "San José",
    canton: "Central",
    distrito: "Carmen",
    monto_cobrar: "16618.40",
    cantidad: 7,
    cobra_comision: true,
    ...over,
  };
}

/** Recorre un subarbol y devuelve `ruta -> valor` de TODAS sus hojas. */
function hojas(valor: unknown, ruta = ""): Array<[string, unknown]> {
  if (valor === null || typeof valor !== "object") return [[ruta, valor]];
  return Object.entries(valor as Record<string, unknown>).flatMap(([clave, hijo]) =>
    hojas(hijo, ruta === "" ? clave : `${ruta}.${clave}`),
  );
}

describe("CotizadorService: money-safe (R29)", () => {
  it("R29: todo importe es string de escala 2 con ROUND_HALF_UP, incluido el negativo, y ningún number cruza la salida", async () => {
    const respuesta = (await service().cotizar(ACTOR, entrada())) as CotizacionConCostos;

    const importes = hojas(respuesta.escenarios);
    // Control de no-vacuidad: si el recorrido no encontrara hojas, el `for` de abajo pasaria en
    // verde sin haber mirado nada. 6 claves de entregada x2 (unitario/total) + 4 de devuelta x2.
    expect(importes).toHaveLength(20);

    for (const [ruta, valor] of importes) {
      expect(typeof valor, `${ruta} debe ser string`).toBe("string");
      expect(valor as string, `${ruta} debe tener escala 2`).toMatch(IMPORTE);
    }

    // El eco del monto tambien es money-safe (normalizado a escala 2, sin aritmetica).
    expect(respuesta.montoCobrar).toMatch(IMPORTE);

    // HALF_UP de verdad, no truncado: 2200,005 -> 2200,01 (y su IVA sobre el flete redondeado).
    expect(respuesta.escenarios.entregada.unitario.flete).toBe("2200.01");

    // El NEGATIVO tambien: escala 2, con signo, y multiplicado por N sin perder un centimo.
    expect(respuesta.escenarios.devuelta.unitario.netoTienda).toBe("-1695.00");
    expect(respuesta.escenarios.devuelta.total.netoTienda).toBe("-11865.00");
  });

  it("R29: negar un cero da '0.00', nunca '-0.00'", async () => {
    // Sin tarifa vigente todos los conceptos son cero (R30); el neto de devuelta niega un cero.
    const respuesta = (await service(null).cotizar(ACTOR, entrada())) as CotizacionConCostos;

    for (const [ruta, valor] of hojas(respuesta.escenarios)) {
      expect(valor as string, `${ruta}`).toMatch(IMPORTE);
      expect(valor, `${ruta} no puede ser un cero con signo`).not.toBe("-0.00");
    }
    expect(respuesta.escenarios.devuelta.unitario.netoTienda).toBe("0.00");
  });

  it("R29: el fuente del service no usa number, parseFloat ni punto flotante para dinero", async () => {
    const fuente = codigoSinComentarios("lib/services/CotizadorService.ts");
    expect(fuente.length).toBeGreaterThan(0); // control de no-vacuidad
    expect(fuente).not.toMatch(/parseFloat|parseInt|Number\s*\(|toLocaleString|Math\./);
    // Todo importe nace y muere como `Prisma.Decimal` -> STRING escala 2.
    expect(fuente).toMatch(/Prisma\.Decimal/);
    expect(fuente).toMatch(/toFixed\(2\)/);
  });
});
