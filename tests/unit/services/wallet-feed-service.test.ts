import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import type { WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";

// Feature 42 — tests unit del WalletFeedService (R5/R8/R9/R10). Construye hasta 6 movimientos
// por concepto y omite los conceptos en 0.00.
//
// Feature 69 (R12/R14): el feed deriva del SNAPSHOT `cierre_detail`, NO de `orden`/`zona`/
// `tarifas` vivas. Los IMPORTES de la 42 no cambian (misma formula, R21): lo que cambia es de
// DONDE salen las entradas. Por eso los numeros de abajo son los mismos que antes de la 69.

// La tarifa CONGELADA en la fila del snapshot (misma que usaba la 42 via el resolver vivo).
const TARIFA_CONGELADA = {
  tarifaId: "ta1",
  tarifaValorFlete: new Prisma.Decimal("1000.00"),
  tarifaValorFleteGam: new Prisma.Decimal("1500.00"),
  tarifaValorFleteDevuelto: new Prisma.Decimal("400.00"),
  tarifaValorFleteDevueltoGam: new Prisma.Decimal("600.00"),
  tarifaComisionCod: new Prisma.Decimal("5.00"),
  tarifaIvaFlete: new Prisma.Decimal("13.00"),
  tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
};

// R9: tienda sin tarifa vigente AL SOLICITAR -> las 8 columnas NULL (gap preservado).
const SIN_TARIFA = {
  tarifaId: null,
  tarifaValorFlete: null,
  tarifaValorFleteGam: null,
  tarifaValorFleteDevuelto: null,
  tarifaValorFleteDevueltoGam: null,
  tarifaComisionCod: null,
  tarifaIvaFlete: null,
  tarifaIvaComisionCod: null,
};

// Fila de `cierre_detail` (lo de la ORDEN, congelado).
function detalle(
  opts: {
    ordenId?: string;
    esCentral?: boolean;
    montoCobrar?: string | null;
    cobraComision?: boolean;
    tiendaId?: string;
    sinTarifa?: boolean;
  } = {},
) {
  return {
    ordenId: opts.ordenId ?? "o1",
    tiendaId: opts.tiendaId ?? "t1",
    montoCobrar:
      opts.montoCobrar === undefined
        ? new Prisma.Decimal("10000.00")
        : opts.montoCobrar === null
          ? null
          : new Prisma.Decimal(opts.montoCobrar),
    cobraComision: opts.cobraComision ?? true,
    esCentral: opts.esCentral ?? false,
    ...(opts.sinTarifa ? SIN_TARIFA : TARIFA_CONGELADA),
  };
}

// Gestion: aporta SOLO lo que es de la GESTION (el `resultado`).
function gestion(resultado: string, ordenId = "o1") {
  return { ordenId, resultado };
}

function buildTx(gestiones: unknown[], detalles: unknown[]) {
  const tx = {
    gestionOrden: { findMany: vi.fn().mockResolvedValue(gestiones) },
    cierreDetail: { findMany: vi.fn().mockResolvedValue(detalles) },
    // Feature 69/R12: si el feed volviera a mirar datos VIVOS, estos dobles lo delatan.
    // No estan en el tipo del tx client: existen solo para que la asercion sea posible.
    orden: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    zona: { findMany: vi.fn(), findFirst: vi.fn() },
    tarifa: { findMany: vi.fn(), findFirst: vi.fn() },
  };
  return tx as unknown as WalletFeedTxClient & typeof tx;
}

describe("WalletFeedService.construirMovimientosDeIngreso (R5/R10)", () => {
  it("cierre solo-entregada con comision: 4 conceptos, todos origen cierre_dia + tipo ingreso", async () => {
    // 2 ordenes distintas, ambas entregadas (los importes se duplican, como antes de la 69).
    const tx = buildTx(
      [gestion("entregada", "o1"), gestion("entregada", "o2")],
      [detalle({ ordenId: "o1" }), detalle({ ordenId: "o2" })],
    );
    const svc = new WalletFeedService();
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
    const tx = buildTx(
      [gestion("entregada", "o1"), gestion("devuelta", "o2"), gestion("rechazada", "o3")],
      [detalle({ ordenId: "o1" }), detalle({ ordenId: "o2" }), detalle({ ordenId: "o3" })],
    );
    const svc = new WalletFeedService();
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
    const tx = buildTx([gestion("entregada")], [detalle({ cobraComision: false })]);
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const cats = movs.map((m) => m.categoria);
    expect(cats).toContain("ingreso_flete");
    expect(cats).not.toContain("ingreso_comision_cod");
    expect(cats).not.toContain("ingreso_iva_comision_cod");
  });

  it("R10: cierre solo reprogramadas -> ningun movimiento", async () => {
    const tx = buildTx(
      [gestion("reprogramada", "o1"), gestion("reprogramada", "o2")],
      [detalle({ ordenId: "o1" }), detalle({ ordenId: "o2" })],
    );
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    expect(movs).toEqual([]);
  });

  it("R9: tarifa congelada ausente (tienda sin tarifa al solicitar) -> ningun movimiento, sin lanzar", async () => {
    // El gap (c) se PRESERVA tal cual: conceptos 0.00, no bloquea. Lo que cambia con la 69 es
    // que ahora queda RASTRO consultable (`tarifa_* IS NULL` en la fila).
    const tx = buildTx(
      [gestion("entregada", "o1"), gestion("devuelta", "o2")],
      [detalle({ ordenId: "o1", sinTarifa: true }), detalle({ ordenId: "o2", sinTarifa: true })],
    );
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    expect(movs).toEqual([]);
  });

  it("central (esCentral) usa flete GAM", async () => {
    const tx = buildTx([gestion("entregada")], [detalle({ esCentral: true, cobraComision: false })]);
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const map = Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
    expect(map.ingreso_flete).toBe("1500.00");
  });
});

describe("Feature 69/R12 — el feed deriva del SNAPSHOT y no de los datos vivos", () => {
  it("R12: lee cierre_detail por cierreId y NO consulta orden, zona ni tarifas", async () => {
    const tx = buildTx([gestion("entregada")], [detalle()]);
    const svc = new WalletFeedService();

    await svc.construirMovimientosDeIngreso("c1", tx);

    expect(tx.cierreDetail.findMany).toHaveBeenCalledTimes(1);
    expect(
      (tx.cierreDetail.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ where: { cierreId: "c1" } });
    // El corazon de R12: ninguna tabla viva se toca al APROBAR.
    expect(tx.orden.findMany).not.toHaveBeenCalled();
    expect(tx.orden.findFirst).not.toHaveBeenCalled();
    expect(tx.zona.findMany).not.toHaveBeenCalled();
    expect(tx.tarifa.findMany).not.toHaveBeenCalled();
    expect(tx.tarifa.findFirst).not.toHaveBeenCalled();
  });

  it("R12: de gestion_orden solo toma ordenId y resultado (lo que ES de la gestion)", async () => {
    const tx = buildTx([gestion("entregada")], [detalle()]);
    const svc = new WalletFeedService();

    await svc.construirMovimientosDeIngreso("c1", tx);

    const arg = (tx.gestionOrden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ where: { cierreId: "c1" } });
    // Sin `orden: {...}`: la relacion viva desaparece del select.
    expect(arg.select).toEqual({ ordenId: true, resultado: true });
  });

  it("el GRANO: una orden con 2 gestiones (entregada + reprogramada) usa la MISMA fila congelada", async () => {
    // Reintentos 46/47: la orden aporta UNA fila de detalle y N entradas. La `reprogramada` no
    // aporta conceptos; la `entregada` si. Si el feed exigiera 1 gestion por fila, esto
    // reventaria; si duplicara la fila, cobraria el flete dos veces.
    const tx = buildTx(
      [gestion("reprogramada", "o1"), gestion("entregada", "o1")],
      [detalle({ ordenId: "o1", cobraComision: false })],
    );
    const svc = new WalletFeedService();

    const movs = await svc.construirMovimientosDeIngreso("c1", tx);

    const map = Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
    expect(map.ingreso_flete).toBe("1000.00"); // UNA vez, no dos
  });
});

describe("Feature 69/R14 — falta la fila congelada: aborta, sin fallback", () => {
  it("R14: lanza CierreDetalleFaltanteError y NO devuelve ningun movimiento", async () => {
    // Sin fallback a datos vivos (decision (a)): preferimos una aprobacion ABORTADA Y VISIBLE
    // a un descuadre silencioso en un libro append-only. El backfill (R26/R27) hace que este
    // caso no deba ocurrir en produccion.
    const tx = buildTx([gestion("entregada", "o1"), gestion("entregada", "o-huerfana")], [detalle({ ordenId: "o1" })]);
    const svc = new WalletFeedService();

    await expect(svc.construirMovimientosDeIngreso("c1", tx)).rejects.toThrow(
      CierreDetalleFaltanteError,
    );
  });

  it("R14: el error identifica el cierre y la orden sin snapshot", async () => {
    const tx = buildTx([gestion("entregada", "o-huerfana")], []);
    const svc = new WalletFeedService();

    await expect(svc.construirMovimientosDeIngreso("c1", tx)).rejects.toMatchObject({
      cierreId: "c1",
      ordenId: "o-huerfana",
    });
  });
});
