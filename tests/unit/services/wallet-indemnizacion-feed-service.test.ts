import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import type { WalletIndemnizacionFeedTxClient } from "@/lib/interfaces/services/IWalletIndemnizacionFeedService";

// Feature 158 (T1.13, R26/R27) — el feed del EGRESO de indemnizacion, con un doble de `tx`
// (sin DB). Lo que se afirma es el MOVIMIENTO emitido y, sobre todo, que el feed LEE de la base
// en vez de recibir el monto por parametro (design §9.3): esa es la propiedad que impide que el
// libro y el detalle digan cosas distintas sobre la misma plata.

function txConGestiones(
  filas: Array<{ indemnizacion: Prisma.Decimal | null }>,
): { tx: WalletIndemnizacionFeedTxClient; findMany: ReturnType<typeof vi.fn> } {
  const findMany = vi.fn(async () => filas);
  return { tx: { gestionOrden: { findMany } } as unknown as WalletIndemnizacionFeedTxClient, findMany };
}

const feed = new WalletIndemnizacionFeedService();

describe("R26 — el movimiento emitido", () => {
  it("suma los montos de las gestiones `incidente` del cierre y emite UN egreso", async () => {
    const { tx } = txConGestiones([
      { indemnizacion: new Prisma.Decimal("12500.75") },
      { indemnizacion: new Prisma.Decimal("300.25") },
    ]);

    const movs = await feed.construirEgresoIndemnizacion("c1", tx);

    expect(movs).toEqual([
      {
        tipo: "egreso",
        categoria: "egreso_indemnizacion",
        monto: "12801.00", // 12500.75 + 300.25, exacto al centavo
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
      },
    ]);
  });

  it("R26/R28: `origen_tipo`+`origen_id`+`categoria` son la clave de idempotencia de la 42", async () => {
    const { tx } = txConGestiones([{ indemnizacion: new Prisma.Decimal("1.00") }]);
    const movs = await feed.construirEgresoIndemnizacion("c-abc", tx);
    // El indice unico parcial es (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT
    // NULL: con `origen_id` poblado, un segundo insert del MISMO cierre es no-op.
    expect(movs[0].origenId).toBe("c-abc");
    expect(movs[0].origenTipo).toBe("cierre_dia");
    expect(movs[0].categoria).toBe("egreso_indemnizacion");
  });

  it("R26: lee POR CIERRE y SOLO las gestiones `incidente` (mismo predicado que la escritura)", async () => {
    const { tx, findMany } = txConGestiones([{ indemnizacion: new Prisma.Decimal("5.00") }]);
    await feed.construirEgresoIndemnizacion("c1", tx);
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0] as unknown as { where: unknown; select: unknown };
    expect(arg.where).toEqual({ cierreId: "c1", resultado: "incidente" });
    expect(arg.select).toEqual({ indemnizacion: true });
  });

  it("R24/R26: money-safe — suma con Decimal, salida STRING escala 2, sin coma flotante", async () => {
    // 0.1 + 0.2 en float da 0.30000000000000004. Con Decimal da exactamente 0.30.
    const { tx } = txConGestiones([
      { indemnizacion: new Prisma.Decimal("0.10") },
      { indemnizacion: new Prisma.Decimal("0.20") },
    ]);
    const movs = await feed.construirEgresoIndemnizacion("c1", tx);
    expect(movs[0].monto).toBe("0.30");
    expect(typeof movs[0].monto).toBe("string");
  });

  it("R24: un monto con muchos sumandos no acumula error de redondeo", async () => {
    const { tx } = txConGestiones(
      Array.from({ length: 10 }, () => ({ indemnizacion: new Prisma.Decimal("0.07") })),
    );
    const movs = await feed.construirEgresoIndemnizacion("c1", tx);
    expect(movs[0].monto).toBe("0.70");
  });
});

describe("R27 — sin incidentes NO se emite ni una fila en 0.00", () => {
  it("cierre sin gestiones `incidente` -> lista VACIA", async () => {
    const { tx } = txConGestiones([]);
    expect(await feed.construirEgresoIndemnizacion("c1", tx)).toEqual([]);
  });

  it("gestiones `incidente` con montos AUSENTES -> lista VACIA (no inventa un monto)", async () => {
    const { tx } = txConGestiones([{ indemnizacion: null }, { indemnizacion: null }]);
    expect(await feed.construirEgresoIndemnizacion("c1", tx)).toEqual([]);
  });

  it("la suma en 0.00 tampoco emite fila", async () => {
    const { tx } = txConGestiones([{ indemnizacion: new Prisma.Decimal("0.00") }]);
    expect(await feed.construirEgresoIndemnizacion("c1", tx)).toEqual([]);
  });

  it("un monto ausente entre montos validos NO rompe: aporta 0 y el resto suma", async () => {
    const { tx } = txConGestiones([
      { indemnizacion: new Prisma.Decimal("10.00") },
      { indemnizacion: null },
      { indemnizacion: new Prisma.Decimal("5.00") },
    ]);
    const movs = await feed.construirEgresoIndemnizacion("c1", tx);
    // Emite de MENOS, nunca de mas: el feed no inventa el monto que falta.
    expect(movs[0].monto).toBe("15.00");
  });
});

describe("R26 — el feed suma SOLO los incidentes, no cualquier gestion del cierre", () => {
  /**
   * Doble que HONRA `where.resultado`, como la base. Con el se puede afirmar el
   * COMPORTAMIENTO (la suma) y no solo la forma del WHERE: si el feed dejara de filtrar por
   * resultado, sumaria tambien la fila `entregada` y el monto emitido cambiaria.
   */
  function txMixto(
    filas: Array<{ resultado: string; indemnizacion: Prisma.Decimal | null }>,
  ): WalletIndemnizacionFeedTxClient {
    return {
      gestionOrden: {
        findMany: vi.fn(async (args?: { where?: { resultado?: string } }) =>
          filas.filter((f) =>
            args?.where?.resultado === undefined ? true : f.resultado === args.where.resultado,
          ),
        ),
      },
    } as unknown as WalletIndemnizacionFeedTxClient;
  }

  it("una fila `entregada` con un monto colado NO entra en la suma", async () => {
    const tx = txMixto([
      { resultado: "incidente", indemnizacion: new Prisma.Decimal("100.00") },
      // Fila corrupta/legada: no deberia tener monto, pero si lo tuviera NO debe sumarse.
      { resultado: "entregada", indemnizacion: new Prisma.Decimal("999999.00") },
    ]);

    const movs = await feed.construirEgresoIndemnizacion("c1", tx);

    expect(movs[0].monto).toBe("100.00");
  });

  it("un cierre sin incidentes pero con otras gestiones con monto NO emite nada", async () => {
    const tx = txMixto([
      { resultado: "entregada", indemnizacion: new Prisma.Decimal("500.00") },
      { resultado: "rechazada", indemnizacion: new Prisma.Decimal("300.00") },
    ]);

    expect(await feed.construirEgresoIndemnizacion("c1", tx)).toEqual([]);
  });
});

describe("design §9.3 — el feed NO recibe el monto por parametro", () => {
  it("su firma es (cierreId, tx): el monto solo puede salir de la base", () => {
    // Si un dia alguien le pasara los montos del request, el libro podria divergir de lo
    // persistido cuando la escritura fallara parcialmente. La aridad lo fija.
    expect(feed.construirEgresoIndemnizacion.length).toBe(2);
  });
});
