import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { tarifaDe, detalleDe, CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import type { CierreDetalleRow } from "@/lib/utils/cierre-detalle";

// Feature 69 — tests unit de la lectura COMPARTIDA del snapshot. `tarifaDe` no tenia test
// propio y por ahi se colo la desviacion de R11 (`toString()` en vez de `toFixed(2)`): un
// Decimal("1000.00") salia "1000". Este archivo fija el CONTRATO de formato, que es lo que
// R11 pide y lo que hace que las dos procedencias de la tarifa (resolver vivo y snapshot)
// sean indistinguibles para el consumidor.

function detalleRow(overrides: Partial<CierreDetalleRow> = {}): CierreDetalleRow {
  return {
    ordenId: "o1",
    montoCobrar: new Prisma.Decimal("12500.00"),
    cobraComision: true,
    esCentral: false,
    tiendaId: "t1",
    tarifaId: "tar1",
    tarifaValorFlete: new Prisma.Decimal("1000.00"),
    tarifaValorFleteGam: new Prisma.Decimal("1200.5"),
    tarifaValorFleteDevuelto: new Prisma.Decimal("500"),
    tarifaValorFleteDevueltoGam: new Prisma.Decimal("600.00"),
    tarifaComisionCod: new Prisma.Decimal("3"),
    tarifaIvaFlete: new Prisma.Decimal("13"),
    tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
    ...overrides,
  } as CierreDetalleRow;
}

describe("tarifaDe (R11)", () => {
  it("R11: los 7 campos salen como STRING escala 2 FIJA (toFixed(2), no toString)", () => {
    const t = tarifaDe(detalleRow());

    // El caso que la desviacion rompia: "1000.00", no "1000".
    expect(t).toEqual({
      valorFlete: "1000.00",
      valorFleteGam: "1200.50",
      valorFleteDevuelto: "500.00",
      valorFleteDevueltoGam: "600.00",
      comisionCod: "3.00",
      ivaFlete: "13.00",
      ivaComisionCod: "13.00",
    });
    // Escala 2 en TODOS, sea cual sea la escala con que Postgres devuelva el Decimal.
    const valores = Object.values(t ?? {});
    expect(valores).toHaveLength(7);
    for (const v of valores) {
      expect(typeof v).toBe("string");
      expect(v).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("R11: mismo formato que el resolver vivo para el MISMO valor (no divergen)", () => {
    // El resolver (`TarifaVigentePorTiendaRepository`) emite `toFixed(2)`. Si el snapshot
    // emitiera otro texto para el mismo Decimal, un cierre backfilleado y uno nuevo
    // liquidarian "igual" pero con entradas distintas al ojo: eso es lo que se prohibe.
    const valor = new Prisma.Decimal("1000.00");
    expect(tarifaDe(detalleRow({ tarifaValorFlete: valor }))?.valorFlete).toBe(valor.toFixed(2));
  });

  it("R9/decision (c): tarifa_id null -> null (gap preservado, no se inventa tarifa 0)", () => {
    expect(tarifaDe(detalleRow({ tarifaId: null }))).toBeNull();
  });
});

describe("detalleDe (R14)", () => {
  it("R14: fila presente -> se devuelve", () => {
    const d = detalleRow();
    const byOrden = new Map([["o1", d]]);
    expect(detalleDe(byOrden, "c1", "o1")).toBe(d);
  });

  it("R14/decision (a): fila ausente -> error DURO, sin fallback a datos vivos", () => {
    const byOrden = new Map<string, CierreDetalleRow>();
    expect(() => detalleDe(byOrden, "c1", "o-huerfana")).toThrow(CierreDetalleFaltanteError);
    // El error dice QUE cierre y QUE orden: una aprobacion abortada tiene que ser accionable.
    expect(() => detalleDe(byOrden, "c1", "o-huerfana")).toThrow(/o-huerfana/);
    expect(() => detalleDe(byOrden, "c1", "o-huerfana")).toThrow(/c1/);
  });
});
