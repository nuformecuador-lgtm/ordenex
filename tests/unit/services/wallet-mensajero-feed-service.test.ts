import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import type { WalletMensajeroFeedTxClient } from "@/lib/interfaces/services/IWalletMensajeroFeedService";

// Feature 44/T9 — tests unit del WalletMensajeroFeedService (CORAZON). Cubre R5/R8/R9/R10/R13/
// R15/R17. Consume los snapshots del cierre (P = total_pago_mensajero, E = total_efectivo); NO
// re-deriva tarifas. Regla money-safe pagado = min(P,E); pendiente = P - pagado (saldo derivado).
// Ademas (Qa=SI, R17) emite el EGRESO egreso_pago_mensajero = P en la caja 42.

// tx con un solo cierre en memoria (findUnique por id).
function buildTx(cierre: { mensajeroId: string; totalPagoMensajero: string; totalEfectivo: string } | null) {
  return {
    cierreDia: {
      findUnique: vi.fn(async () =>
        cierre === null
          ? null
          : {
              mensajeroId: cierre.mensajeroId,
              totalPagoMensajero: new Prisma.Decimal(cierre.totalPagoMensajero),
              totalEfectivo: new Prisma.Decimal(cierre.totalEfectivo),
            },
      ),
    },
  } as unknown as WalletMensajeroFeedTxClient;
}

function libroMap(movs: { categoria: string; monto: string; tipo: string; mensajeroId: string }[]) {
  return Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
}

describe("WalletMensajeroFeedService — E >= P (pago cubierto integro, R9/R10)", () => {
  it("pagado = P, sin cuenta por pagar (pendiente 0); egreso 42 = P", async () => {
    const tx = buildTx({ mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "1500.00" });
    const svc = new WalletMensajeroFeedService();
    const { libro, egresoCaja } = await svc.construirMovimientosDePago("c1", tx);

    const map = libroMap(libro);
    expect(map.pago_devengado).toBe("1000.00");
    expect(map.pago_efectivo).toBe("1000.00"); // pagado = min(1000, 1500) = 1000
    // pendiente = 1000 - 1000 = 0 (no es fila; es el saldo derivado).
    for (const m of libro) {
      expect(m.mensajeroId).toBe("m1");
      expect(m.origenTipo).toBe("cierre_dia");
      expect(m.origenId).toBe("c1");
      expect(typeof m.monto).toBe("string");
      expect(m.tipo).toBe(m.categoria === "pago_devengado" ? "devengo" : "pago");
    }
    // R17 (Qa): egreso completo P en la caja 42.
    expect(egresoCaja).toHaveLength(1);
    expect(egresoCaja[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_pago_mensajero",
      monto: "1000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
    });
  });
});

describe("WalletMensajeroFeedService — E < P (cuenta por pagar, R9/R10)", () => {
  it("pagado = E, pendiente = P - E (queda como cuenta por pagar derivada); egreso 42 = P", async () => {
    const tx = buildTx({ mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "300.00" });
    const svc = new WalletMensajeroFeedService();
    const { libro, egresoCaja } = await svc.construirMovimientosDePago("c1", tx);

    const map = libroMap(libro);
    expect(map.pago_devengado).toBe("1000.00");
    expect(map.pago_efectivo).toBe("300.00"); // pagado = min(1000, 300) = 300
    // R14: cuenta por pagar derivada = 1000 - 300 = 700.
    const devengado = new Prisma.Decimal(map.pago_devengado);
    const pagado = new Prisma.Decimal(map.pago_efectivo);
    expect(devengado.sub(pagado).toFixed(2)).toBe("700.00");
    // R17: egreso 42 refleja el COSTO total (accrual) = P, no lo pagado.
    expect(egresoCaja[0].monto).toBe("1000.00");
  });
});

describe("WalletMensajeroFeedService — E = 0 (todo pendiente, R9/R10)", () => {
  it("sin pago_efectivo (pagado 0); solo devengo; cuenta por pagar = P; egreso 42 = P", async () => {
    const tx = buildTx({ mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "0.00" });
    const svc = new WalletMensajeroFeedService();
    const { libro, egresoCaja } = await svc.construirMovimientosDePago("c1", tx);

    const cats = libro.map((m) => m.categoria);
    expect(cats).toContain("pago_devengado");
    expect(cats).not.toContain("pago_efectivo"); // pagado = 0 -> omitido (R10)
    expect(libro).toHaveLength(1);
    expect(egresoCaja[0].monto).toBe("1000.00");
  });
});

describe("WalletMensajeroFeedService — P = 0 (sin movimientos, R10)", () => {
  it("cierre sin entregas que paguen -> libro vacio Y sin egreso en la caja 42", async () => {
    const tx = buildTx({ mensajeroId: "m1", totalPagoMensajero: "0.00", totalEfectivo: "5000.00" });
    const svc = new WalletMensajeroFeedService();
    const { libro, egresoCaja } = await svc.construirMovimientosDePago("c1", tx);
    expect(libro).toEqual([]);
    expect(egresoCaja).toEqual([]); // R10/R17: sin P no hay costo que reflejar
  });

  it("cierre inexistente (defensivo) -> listas vacias", async () => {
    const tx = buildTx(null);
    const svc = new WalletMensajeroFeedService();
    const r = await svc.construirMovimientosDePago("c-x", tx);
    expect(r).toEqual({ libro: [], egresoCaja: [] });
  });
});

describe("WalletMensajeroFeedService — netting POR CIERRE (R13)", () => {
  it("dos cierres del mismo mensajero NO cruzan su efectivo: cada uno neta lo suyo", async () => {
    const svc = new WalletMensajeroFeedService();
    // Cierre 1: P=1000, E=300 -> pagado 300, pendiente 700.
    const r1 = await svc.construirMovimientosDePago(
      "c1",
      buildTx({ mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "300.00" }),
    );
    // Cierre 2: P=500, E=2000 -> pagado 500, pendiente 0 (el sobrante de c2 NO cubre c1).
    const r2 = await svc.construirMovimientosDePago(
      "c2",
      buildTx({ mensajeroId: "m1", totalPagoMensajero: "500.00", totalEfectivo: "2000.00" }),
    );

    const m1 = libroMap(r1.libro);
    const m2 = libroMap(r2.libro);
    expect(m1.pago_efectivo).toBe("300.00"); // c1 acotado por SU efectivo
    expect(m2.pago_efectivo).toBe("500.00"); // c2 acotado por SU pago (min(500,2000))
    // el pendiente de c1 (700) NO se reduce con el sobrante de c2: cada cierre es independiente.
    expect(new Prisma.Decimal(m1.pago_devengado).sub(new Prisma.Decimal(m1.pago_efectivo)).toFixed(2)).toBe("700.00");
    expect(r1.libro[0].origenId).toBe("c1");
    expect(r2.libro[0].origenId).toBe("c2");
  });
});

describe("WalletMensajeroFeedService — INVARIANTE de cuadre (R15)", () => {
  it("por (mensajero, cierre): pago_devengado = pago_efectivo + cuenta_por_pagar", async () => {
    for (const [P, E] of [
      ["1000.00", "1500.00"],
      ["1000.00", "300.00"],
      ["1000.00", "0.00"],
    ] as const) {
      const svc = new WalletMensajeroFeedService();
      const { libro } = await svc.construirMovimientosDePago(
        "c1",
        buildTx({ mensajeroId: "m1", totalPagoMensajero: P, totalEfectivo: E }),
      );
      const map = libroMap(libro);
      const devengado = new Prisma.Decimal(map.pago_devengado ?? "0.00");
      const pagado = new Prisma.Decimal(map.pago_efectivo ?? "0.00");
      const cuentaPorPagar = devengado.sub(pagado);
      // devengado = pagado + cuenta_por_pagar (por construccion, con montos reales).
      expect(pagado.add(cuentaPorPagar).toFixed(2)).toBe(devengado.toFixed(2));
      // ningun peso devengado sin representar: pagado >= 0 y cuenta_por_pagar >= 0.
      expect(pagado.gte(0)).toBe(true);
      expect(cuentaPorPagar.gte(0)).toBe(true);
    }
  });

  it("agregado: Σ(pago_devengado) = Σ(total_pago_mensajero) de los cierres aprobados; y egreso 42 cuadra", async () => {
    const svc = new WalletMensajeroFeedService();
    const cierres = [
      { id: "c1", mensajeroId: "m1", totalPagoMensajero: "1000.00", totalEfectivo: "300.00" },
      { id: "c2", mensajeroId: "m2", totalPagoMensajero: "500.00", totalEfectivo: "500.00" },
      { id: "c3", mensajeroId: "m1", totalPagoMensajero: "250.00", totalEfectivo: "0.00" },
    ];
    let sumDevengado = new Prisma.Decimal(0);
    let sumEgreso42 = new Prisma.Decimal(0);
    let sumSnapshot = new Prisma.Decimal(0);
    for (const c of cierres) {
      const { libro, egresoCaja } = await svc.construirMovimientosDePago(c.id, buildTx(c));
      const dev = libro.find((m) => m.categoria === "pago_devengado");
      if (dev) sumDevengado = sumDevengado.add(new Prisma.Decimal(dev.monto));
      for (const e of egresoCaja) sumEgreso42 = sumEgreso42.add(new Prisma.Decimal(e.monto));
      sumSnapshot = sumSnapshot.add(new Prisma.Decimal(c.totalPagoMensajero));
    }
    expect(sumDevengado.toFixed(2)).toBe(sumSnapshot.toFixed(2)); // Σ devengo = Σ snapshot
    expect(sumEgreso42.toFixed(2)).toBe(sumSnapshot.toFixed(2)); // Σ egreso 42 = Σ snapshot (Qa cuadre)
  });
});
