import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import type {
  ITarifaVigentePorZonaRepository,
  TarifaVigentePorZona,
} from "@/lib/interfaces/repositories/ITarifaVigentePorZonaRepository";
import type { WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";

// Feature 42 — tests unit del WalletFeedService (R5/R8/R9/R10). Construye hasta 6
// movimientos por concepto, omite conceptos en 0.00, cachea la tarifa por zona.

const TARIFA: TarifaVigentePorZona = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

function gestion(
  resultado: string,
  opts: { esCentral?: boolean; montoCobrar?: string | null; cobraComision?: boolean; zonaId?: string } = {},
) {
  return {
    resultado,
    orden: {
      zonaId: opts.zonaId ?? "z1",
      montoCobrar: opts.montoCobrar === undefined ? new Prisma.Decimal("10000.00") : opts.montoCobrar === null ? null : new Prisma.Decimal(opts.montoCobrar),
      cobraComision: opts.cobraComision ?? true,
      zona: { esCentral: opts.esCentral ?? false },
    },
  };
}

function buildTx(gestiones: unknown[]): WalletFeedTxClient {
  return {
    gestionOrden: { findMany: vi.fn().mockResolvedValue(gestiones) },
  } as unknown as WalletFeedTxClient;
}

function buildTarifaRepo(tarifa: TarifaVigentePorZona | null = TARIFA): ITarifaVigentePorZonaRepository {
  return { resolveTarifaPorZona: vi.fn().mockResolvedValue(tarifa) };
}

describe("WalletFeedService.construirMovimientosDeIngreso (R5/R10)", () => {
  it("cierre solo-entregada con comision: 4 conceptos, todos origen cierre_dia + tipo ingreso", async () => {
    const tx = buildTx([gestion("entregada"), gestion("entregada")]);
    const svc = new WalletFeedService(buildTarifaRepo());
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);

    const map = Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
    expect(map.ingreso_flete).toBe("2000.00");
    expect(map.ingreso_iva_flete).toBe("260.00");
    expect(map.ingreso_comision_cod).toBe("1000.00");
    expect(map.ingreso_iva_comision_cod).toBe("130.00");
    expect(map.ingreso_flete_devolucion).toBeUndefined();
    for (const m of movs) {
      expect(m.tipo).toBe("ingreso");
      expect(m.origenTipo).toBe("cierre_dia");
      expect(m.origenId).toBe("c1");
      expect(typeof m.monto).toBe("string");
    }
  });

  it("R10: cierre con devoluciones -> emite conceptos de devolucion (hasta 6 categorias mixtas)", async () => {
    const tx = buildTx([gestion("entregada"), gestion("devuelta"), gestion("rechazada")]);
    const svc = new WalletFeedService(buildTarifaRepo());
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const cats = movs.map((m) => m.categoria);
    expect(cats).toEqual(
      expect.arrayContaining([
        "ingreso_flete",
        "ingreso_iva_flete",
        "ingreso_comision_cod",
        "ingreso_iva_comision_cod",
        "ingreso_flete_devolucion",
        "ingreso_iva_flete_devolucion",
      ]),
    );
  });

  it("R10: cierre sin comision (cobraComision=false) -> NO emite comision ni su IVA", async () => {
    const tx = buildTx([gestion("entregada", { cobraComision: false })]);
    const svc = new WalletFeedService(buildTarifaRepo());
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const cats = movs.map((m) => m.categoria);
    expect(cats).toContain("ingreso_flete");
    expect(cats).not.toContain("ingreso_comision_cod");
    expect(cats).not.toContain("ingreso_iva_comision_cod");
  });

  it("R10: cierre solo reprogramadas -> ningun movimiento", async () => {
    const tx = buildTx([gestion("reprogramada"), gestion("reprogramada")]);
    const svc = new WalletFeedService(buildTarifaRepo());
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    expect(movs).toEqual([]);
  });

  it("R9: zona sin tarifa vigente -> ningun movimiento (todos 0.00), sin lanzar", async () => {
    const tx = buildTx([gestion("entregada"), gestion("devuelta")]);
    const svc = new WalletFeedService(buildTarifaRepo(null));
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    expect(movs).toEqual([]);
  });

  it("cachea la tarifa por zonaId: 3 gestiones misma zona -> 1 sola resolucion", async () => {
    const tx = buildTx([gestion("entregada"), gestion("entregada"), gestion("devuelta")]);
    const tarifaRepo = buildTarifaRepo();
    const svc = new WalletFeedService(tarifaRepo);
    await svc.construirMovimientosDeIngreso("c1", tx);
    expect((tarifaRepo.resolveTarifaPorZona as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(tarifaRepo.resolveTarifaPorZona).toHaveBeenCalledWith("z1");
  });

  it("central (esCentral) usa flete GAM", async () => {
    const tx = buildTx([gestion("entregada", { esCentral: true, cobraComision: false })]);
    const svc = new WalletFeedService(buildTarifaRepo());
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const map = Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
    expect(map.ingreso_flete).toBe("1500.00");
  });
});
