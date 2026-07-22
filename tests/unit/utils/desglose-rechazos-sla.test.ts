import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  desglosarIngresoBodegaPorOrigen,
  type GestionDesgloseRechazo,
} from "@/lib/utils/desglose-rechazos-sla";

// Feature 102 (T4) — util puro `desglosarIngresoBodegaPorOrigen` (design §4.2). Cubre R4
// (particion SLA/manual money-safe, STRING escala 2), R5 (sla + manual === total) y R18 (nunca
// number/parseFloat; todo cruza como STRING de dos decimales).

function g(ingresoBodegaRechazo: string | null, esRechazoSla: boolean): GestionDesgloseRechazo {
  return { ingresoBodegaRechazo, esRechazoSla };
}

describe("desglosarIngresoBodegaPorOrigen (R4/R5/R18)", () => {
  it("R4: separa el subtotal SLA del manual con montos snapshoteados", () => {
    const d = desglosarIngresoBodegaPorOrigen([
      g("3.00", true), // SLA (cron 99)
      g("2.50", true), // SLA
      g("5.25", false), // manual (mensajero)
    ]);
    expect(d.totalSla).toBe("5.50");
    expect(d.totalManual).toBe("5.25");
    expect(d.total).toBe("10.75");
  });

  it("R18: los tres subtotales cruzan como STRING de dos decimales (nunca number)", () => {
    const d = desglosarIngresoBodegaPorOrigen([g("1.1", true), g("2", false)]);
    expect(typeof d.totalSla).toBe("string");
    expect(typeof d.totalManual).toBe("string");
    expect(typeof d.total).toBe("string");
    // Escala 2 fija.
    expect(d.totalSla).toBe("1.10");
    expect(d.totalManual).toBe("2.00");
    expect(d.total).toBe("3.10");
  });

  it("R5: subtotal SLA + subtotal manual === total (la particion no crea ni pierde dinero)", () => {
    const gestiones = [
      g("100.33", true),
      g("0.01", true),
      g("250.66", false),
      g("9.99", false),
    ];
    const d = desglosarIngresoBodegaPorOrigen(gestiones);
    const suma = new Prisma.Decimal(d.totalSla).plus(d.totalManual).toFixed(2);
    expect(suma).toBe(d.total);
  });

  it("R4: una gestion manual con ingreso != 0 NO suma al subtotal SLA (R2 aplicado al desglose)", () => {
    const d = desglosarIngresoBodegaPorOrigen([g("7.00", false)]);
    expect(d.totalSla).toBe("0.00");
    expect(d.totalManual).toBe("7.00");
    expect(d.total).toBe("7.00");
  });

  it("ingreso null (pendiente de cierre / pre-migracion) no aporta a ningun subtotal", () => {
    const d = desglosarIngresoBodegaPorOrigen([g(null, true), g(null, false), g("4.00", true)]);
    expect(d.totalSla).toBe("4.00");
    expect(d.totalManual).toBe("0.00");
    expect(d.total).toBe("4.00");
  });

  it("lista vacia -> subtotales en 0.00", () => {
    const d = desglosarIngresoBodegaPorOrigen([]);
    expect(d).toEqual({ totalSla: "0.00", totalManual: "0.00", total: "0.00" });
  });
});
