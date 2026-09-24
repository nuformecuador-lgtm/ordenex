import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import type { WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";
import { txVigilado } from "@/tests/fixtures/tx-una-consulta-a-la-vez";

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
      [gestion("entregado", "o1"), gestion("entregado", "o2")],
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
      [gestion("entregado", "o1"), gestion("novedad", "o2"), gestion("devolucion_a_origen_por_rechazo", "o3")],
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
    const tx = buildTx([gestion("entregado")], [detalle({ cobraComision: false })]);
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const cats = movs.map((m) => m.categoria);
    expect(cats).toContain("ingreso_flete");
    expect(cats).not.toContain("ingreso_comision_cod");
    expect(cats).not.toContain("ingreso_iva_comision_cod");
  });

  it("R10: cierre solo reprogramadas -> ningun movimiento", async () => {
    const tx = buildTx(
      [gestion("reprogramado", "o1"), gestion("reprogramado", "o2")],
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
      [gestion("entregado", "o1"), gestion("novedad", "o2")],
      [detalle({ ordenId: "o1", sinTarifa: true }), detalle({ ordenId: "o2", sinTarifa: true })],
    );
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    expect(movs).toEqual([]);
  });

  it("central (esCentral) usa flete GAM", async () => {
    const tx = buildTx([gestion("entregado")], [detalle({ esCentral: true, cobraComision: false })]);
    const svc = new WalletFeedService();
    const movs = await svc.construirMovimientosDeIngreso("c1", tx);
    const map = Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
    expect(map.ingreso_flete).toBe("1500.00");
  });
});

describe("Feature 69/R12 — el feed deriva del SNAPSHOT y no de los datos vivos", () => {
  it("R12: lee cierre_detail por cierreId y NO consulta orden, zona ni tarifas", async () => {
    const tx = buildTx([gestion("entregado")], [detalle()]);
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
    const tx = buildTx([gestion("entregado")], [detalle()]);
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
      [gestion("reprogramado", "o1"), gestion("entregado", "o1")],
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
    const tx = buildTx([gestion("entregado", "o1"), gestion("entregado", "o-huerfana")], [detalle({ ordenId: "o1" })]);
    const svc = new WalletFeedService();

    await expect(svc.construirMovimientosDeIngreso("c1", tx)).rejects.toThrow(
      CierreDetalleFaltanteError,
    );
  });

  it("R14: el error identifica el cierre y la orden sin snapshot", async () => {
    const tx = buildTx([gestion("entregado", "o-huerfana")], []);
    const svc = new WalletFeedService();

    await expect(svc.construirMovimientosDeIngreso("c1", tx)).rejects.toMatchObject({
      cierreId: "c1",
      ordenId: "o-huerfana",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 450 (T4.3, R3) — UNA CONSULTA A LA VEZ SOBRE EL CLIENTE DE LA TRANSACCION
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE BLOQUE USA OTRO DOBLE. El `buildTx` de arriba son `vi.fn().mockResolvedValue(...)`:
// resuelven al instante, asi que para el «las dos lecturas a la vez» y «una detras de otra» son la
// MISMA cosa. Esa ceguera es la razon exacta de que el `Promise.all` que esta ficha retira llevara
// meses aqui con los 14 casos de arriba en verde.
//
// `txVigilado` cuenta llamadas EN VUELO y anota los solapes; su propio control positivo y negativo
// vive en `tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts`, sin el cual esto seria un verde
// vacio. Comprobado revirtiendo T3.1 (volviendo al `Promise.all`): el primer caso se pone ROJO con
// `maximoEnVuelo` = 2 y un solape `cierreDetail.findMany || gestionOrden.findMany`.
describe("FICHA 450/R3 · el feed de ingreso no lanza dos consultas a la vez", () => {
  const RESPUESTAS = {
    "cierreDetail.findMany": [detalle({ ordenId: "o1" })],
    "gestionOrden.findMany": [gestion("entregado", "o1")],
  };

  it("no hay ningun solape sobre el cliente de la transaccion", async () => {
    const vigilado = txVigilado<WalletFeedTxClient>(RESPUESTAS);

    const movs = await new WalletFeedService().construirMovimientosDeIngreso("c1", vigilado.tx);

    // ANTI-VACIO: las DOS lecturas se emitieron de verdad y el feed produjo movimientos. Sin
    // esto, un feed que no leyera nada pasaria este caso sin despeinarse.
    expect(vigilado.llamadas.sort()).toEqual(["cierreDetail.findMany", "gestionOrden.findMany"]);
    expect(movs.length).toBeGreaterThan(0);

    expect(vigilado.maximoEnVuelo()).toBe(1);
    expect(vigilado.solapes).toEqual([]);
  });

  it("R5: con el doble vigilado emite EXACTAMENTE los mismos movimientos que con el doble normal", async () => {
    const vigilado = txVigilado<WalletFeedTxClient>(RESPUESTAS);
    const svc = new WalletFeedService();

    const conVigilado = await svc.construirMovimientosDeIngreso("c1", vigilado.tx);
    const conNormal = await svc.construirMovimientosDeIngreso(
      "c1",
      buildTx([gestion("entregado", "o1")], [detalle({ ordenId: "o1" })]),
    );

    // Mismos conceptos, mismos montos y MISMO ORDEN de emision: secuenciar las lecturas no
    // puede mover ni un centimo ni una posicion.
    expect(conVigilado).toEqual(conNormal);
  });

  it("R4: las dos lecturas siguen saliendo POR EL `tx`, no por un cliente suelto", async () => {
    const vigilado = txVigilado<WalletFeedTxClient>(RESPUESTAS);

    await new WalletFeedService().construirMovimientosDeIngreso("c1", vigilado.tx);

    // El doble no expone ningun otro cliente: si el feed hubiera leido fuera de la tx, no
    // habria registrado estas dos llamadas.
    expect(vigilado.llamadas).toHaveLength(2);
  });
});
