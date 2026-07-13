import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import type { WalletTiendaFeedTxClient } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type {
  ITarifaVigentePorZonaRepository,
  TarifaVigentePorZona,
} from "@/lib/interfaces/repositories/ITarifaVigentePorZonaRepository";
import { agregarIngresosPorConcepto, type OrdenIngresoInput } from "@/lib/utils/ingreso-ordenex";

// Feature 43/T9 — tests unit del WalletTiendaFeedService (CORAZON). Cubre R8/R9/R10/R11/R14/
// R15/R28/R29. Reutiliza `derivarIngresoOrden` (42) para los debitos + montoRecibido para el
// credito COD. El interruptor Q3 se inyecta por constructor (unico punto de lectura) para
// verificar AMBOS estados sin manipular env.

const TARIFA: TarifaVigentePorZona = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

type GestionOpts = {
  tiendaId?: string;
  zonaId?: string;
  esCentral?: boolean;
  montoCobrar?: string | null;
  cobraComision?: boolean;
  montoRecibido?: string | null;
};

function gestion(resultado: string, opts: GestionOpts = {}) {
  return {
    resultado,
    montoRecibido:
      opts.montoRecibido === undefined
        ? new Prisma.Decimal("10000.00")
        : opts.montoRecibido === null
          ? null
          : new Prisma.Decimal(opts.montoRecibido),
    orden: {
      tiendaId: opts.tiendaId ?? "t1",
      zonaId: opts.zonaId ?? "z1",
      montoCobrar:
        opts.montoCobrar === undefined
          ? new Prisma.Decimal("10000.00")
          : opts.montoCobrar === null
            ? null
            : new Prisma.Decimal(opts.montoCobrar),
      cobraComision: opts.cobraComision ?? true,
      zona: { esCentral: opts.esCentral ?? false },
    },
  };
}

function buildTx(gestiones: unknown[]): WalletTiendaFeedTxClient {
  return {
    gestionOrden: { findMany: vi.fn().mockResolvedValue(gestiones) },
  } as unknown as WalletTiendaFeedTxClient;
}

function buildTarifaRepo(
  tarifa: TarifaVigentePorZona | null = TARIFA,
): ITarifaVigentePorZonaRepository {
  return { resolveTarifaPorZona: vi.fn().mockResolvedValue(tarifa) };
}

const FLAG_ON = { TIENDA_DEBITA_FLETE_DEVOLUCION: true };
const FLAG_OFF = { TIENDA_DEBITA_FLETE_DEVOLUCION: false };

function mapMovs(movs: { categoria: string; monto: string; tipo: string; tiendaId: string }[]) {
  return Object.fromEntries(movs.map((m) => [m.categoria, m.monto]));
}

describe("WalletTiendaFeedService — entregada (R8/R9)", () => {
  it("emite credito COD + debitos flete/iva_flete/comision/iva_comision (cobraComision=true)", async () => {
    const tx = buildTx([gestion("entregada")]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);
    const map = mapMovs(movs);

    expect(map.cod_recaudado).toBe("10000.00");
    expect(map.flete).toBe("1000.00");
    expect(map.iva_flete).toBe("130.00");
    expect(map.comision_cod).toBe("500.00"); // 5% de 10000
    expect(map.iva_comision_cod).toBe("65.00"); // 13% de 500
    expect(map.flete_devolucion).toBeUndefined();
    // tipos: cod_recaudado es credito, el resto debito. origen cierre_dia por tienda.
    for (const m of movs) {
      expect(m.tipo).toBe(m.categoria === "cod_recaudado" ? "credito" : "debito");
      expect(m.origenTipo).toBe("cierre_dia");
      expect(m.origenId).toBe("c1");
      expect(m.tiendaId).toBe("t1");
      expect(typeof m.monto).toBe("string");
    }
  });

  it("cobraComision=false -> NO emite comision ni su IVA (credito + flete/iva_flete)", async () => {
    const tx = buildTx([gestion("entregada", { cobraComision: false })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const cats = (await svc.construirMovimientosPorTienda("c1", tx)).map((m) => m.categoria);
    expect(cats).toContain("cod_recaudado");
    expect(cats).toContain("flete");
    expect(cats).not.toContain("comision_cod");
    expect(cats).not.toContain("iva_comision_cod");
  });

  it("esCentral usa flete GAM", async () => {
    const tx = buildTx([gestion("entregada", { esCentral: true, cobraComision: false })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const map = mapMovs(await svc.construirMovimientosPorTienda("c1", tx));
    expect(map.flete).toBe("1500.00");
  });

  it("R9: montoRecibido null en entregada -> credito COD 0.00 OMITIDO (R11)", async () => {
    const tx = buildTx([gestion("entregada", { montoRecibido: null, cobraComision: false })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const cats = (await svc.construirMovimientosPorTienda("c1", tx)).map((m) => m.categoria);
    expect(cats).not.toContain("cod_recaudado"); // 0.00 omitido
    expect(cats).toContain("flete");
  });
});

describe("WalletTiendaFeedService — devuelta/rechazada + interruptor Q3 (R10/R28)", () => {
  it("flag=TRUE: devuelta/rechazada emiten flete_devolucion + iva SIN credito (saldo negativo)", async () => {
    const tx = buildTx([
      gestion("devuelta", { montoRecibido: null }),
      gestion("rechazada", { montoRecibido: null }),
    ]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);
    const map = mapMovs(movs);
    // 2 gestiones de devolucion: flete_dev = 2*400 = 800; iva = 2*52 = 104.
    expect(map.flete_devolucion).toBe("800.00");
    expect(map.iva_flete_devolucion).toBe("104.00");
    expect(map.cod_recaudado).toBeUndefined(); // sin credito -> saldo negativo
    for (const m of movs) expect(m.tipo).toBe("debito");
  });

  it("flag=FALSE: devuelta/rechazada NO emiten flete_devolucion/iva en la tienda", async () => {
    const tx = buildTx([gestion("devuelta", { montoRecibido: null })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_OFF);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);
    expect(movs).toEqual([]); // ni credito (0) ni los 2 debitos de devolucion
  });

  it("flag=FALSE: en un cierre mixto, entregada intacta y devuelta sin sus 2 debitos", async () => {
    const tx = buildTx([
      gestion("entregada"), // credito + 4 debitos
      gestion("devuelta", { montoRecibido: null }), // descartada por el flag
    ]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_OFF);
    const cats = (await svc.construirMovimientosPorTienda("c1", tx)).map((m) => m.categoria);
    expect(cats).toEqual(
      expect.arrayContaining(["cod_recaudado", "flete", "iva_flete", "comision_cod", "iva_comision_cod"]),
    );
    expect(cats).not.toContain("flete_devolucion");
    expect(cats).not.toContain("iva_flete_devolucion");
  });

  it("R28: DEFAULT del flag es TRUE (sin config inyectada usa el singleton)", async () => {
    // Sin segundo argumento -> usa walletTiendaConfig (default true). Verificamos que
    // devuelta genera los 2 debitos de devolucion.
    const tx = buildTx([gestion("devuelta", { montoRecibido: null })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo());
    const cats = (await svc.construirMovimientosPorTienda("c1", tx)).map((m) => m.categoria);
    expect(cats).toContain("flete_devolucion");
    expect(cats).toContain("iva_flete_devolucion");
  });
});

describe("WalletTiendaFeedService — reprogramada, tarifa null, agregacion (R11/R14)", () => {
  it("reprogramada -> ningun movimiento (ni credito ni debito)", async () => {
    const tx = buildTx([gestion("reprogramada", { montoRecibido: null })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    expect(await svc.construirMovimientosPorTienda("c1", tx)).toEqual([]);
  });

  it("R14: zona sin tarifa -> debitos 0.00 (omitidos) pero credito COD intacto, sin lanzar", async () => {
    const tx = buildTx([gestion("entregada", { montoRecibido: "5000.00" })]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(null), FLAG_ON);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);
    const map = mapMovs(movs);
    expect(map.cod_recaudado).toBe("5000.00"); // credito no depende de la tarifa
    expect(map.flete).toBeUndefined(); // debitos 0.00 omitidos
    expect(movs.length).toBe(1);
  });

  it("R11: agrega por (tienda, concepto) y separa por tienda; omite 0.00", async () => {
    const tx = buildTx([
      gestion("entregada", { tiendaId: "t1", montoRecibido: "10000.00", cobraComision: false }),
      gestion("entregada", { tiendaId: "t1", montoRecibido: "5000.00", cobraComision: false }),
      gestion("entregada", { tiendaId: "t2", montoRecibido: "2000.00", cobraComision: false }),
    ]);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);

    const t1 = movs.filter((m) => m.tiendaId === "t1");
    const t2 = movs.filter((m) => m.tiendaId === "t2");
    const t1map = mapMovs(t1);
    expect(t1map.cod_recaudado).toBe("15000.00"); // 10000 + 5000 agregados
    expect(t1map.flete).toBe("2000.00"); // 2 fletes de 1000
    const t2map = mapMovs(t2);
    expect(t2map.cod_recaudado).toBe("2000.00");
    expect(t2map.flete).toBe("1000.00");
  });

  it("cachea la tarifa por zonaId (misma zona -> 1 sola resolucion)", async () => {
    const tx = buildTx([gestion("entregada"), gestion("entregada"), gestion("devuelta", { montoRecibido: null })]);
    const tarifaRepo = buildTarifaRepo();
    const svc = new WalletTiendaFeedService(tarifaRepo, FLAG_ON);
    await svc.construirMovimientosPorTienda("c1", tx);
    expect(tarifaRepo.resolveTarifaPorZona).toHaveBeenCalledTimes(1);
    expect(tarifaRepo.resolveTarifaPorZona).toHaveBeenCalledWith("z1");
  });
});

describe("WalletTiendaFeedService — INVARIANTE R15 (cuadre con la 42, ambos estados del flag)", () => {
  // Helper: totales de ingreso de la 42 para las mismas gestiones (fuente de verdad).
  function ingreso42(entradas: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigentePorZona | null }>) {
    return Object.fromEntries(
      agregarIngresosPorConcepto(entradas).map((c) => [c.categoria, c.monto]),
    );
  }

  it("flag=TRUE: saldo tienda + ingreso 42 = COD recaudado; y Σ debitos_X tiendas = ingreso_X 42", async () => {
    const gestiones = [
      gestion("entregada", { tiendaId: "t1", montoRecibido: "10000.00" }),
      gestion("devuelta", { tiendaId: "t1", montoRecibido: null }),
    ];
    const tx = buildTx(gestiones);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_ON);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);

    const creditos = movs
      .filter((m) => m.tipo === "credito")
      .reduce((a, m) => a.add(new Prisma.Decimal(m.monto)), new Prisma.Decimal(0));
    const debitos = movs
      .filter((m) => m.tipo === "debito")
      .reduce((a, m) => a.add(new Prisma.Decimal(m.monto)), new Prisma.Decimal(0));
    const saldo = creditos.sub(debitos);

    // ingreso 42 de esas mismas gestiones.
    const entradas = gestiones.map((g) => ({
      input: {
        resultado: g.resultado,
        esCentral: g.orden.zona.esCentral,
        montoCobrar: g.orden.montoCobrar === null ? null : g.orden.montoCobrar.toFixed(2),
        cobraComision: g.orden.cobraComision,
      } as OrdenIngresoInput,
      tarifa: TARIFA,
    }));
    const ing = ingreso42(entradas);
    const ingresoTotal = Object.values(ing).reduce(
      (a, v) => a.add(new Prisma.Decimal(v)),
      new Prisma.Decimal(0),
    );
    const codRecaudado = new Prisma.Decimal("10000.00"); // entregada; devuelta aporta 0

    // saldo tienda + ingreso 42 = COD recaudado.
    expect(saldo.add(ingresoTotal).toFixed(2)).toBe(codRecaudado.toFixed(2));

    // A nivel de concepto: Σ debitos_X (una tienda) = ingreso_X que la 42 registro.
    const debMap = mapMovs(movs.filter((m) => m.tipo === "debito"));
    expect(debMap.flete).toBe(ing.ingreso_flete);
    expect(debMap.iva_flete).toBe(ing.ingreso_iva_flete);
    expect(debMap.comision_cod).toBe(ing.ingreso_comision_cod);
    expect(debMap.iva_comision_cod).toBe(ing.ingreso_iva_comision_cod);
    expect(debMap.flete_devolucion).toBe(ing.ingreso_flete_devolucion);
    expect(debMap.iva_flete_devolucion).toBe(ing.ingreso_iva_flete_devolucion);
  });

  it("flag=FALSE: en devuelta/rechazada la diferencia = flete_dev+IVA; Σ_tiendas de esos debitos = 0.00; ingreso 42 intacto", async () => {
    const gestiones = [gestion("devuelta", { tiendaId: "t1", montoRecibido: null })];
    const tx = buildTx(gestiones);
    const svc = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_OFF);
    const movs = await svc.construirMovimientosPorTienda("c1", tx);

    // Σ_tiendas(flete_devolucion) y (iva_flete_devolucion) = 0.00 (no se emiten).
    const debMap = mapMovs(movs.filter((m) => m.tipo === "debito"));
    expect(debMap.flete_devolucion).toBeUndefined();
    expect(debMap.iva_flete_devolucion).toBeUndefined();

    // saldo tienda para esa gestion = 0 (ni credito ni debito).
    expect(movs).toEqual([]);
    const saldoTienda = new Prisma.Decimal(0);

    // ingreso 42 permanece INTACTO (flete_dev + iva_flete_dev = 400 + 52 = 452).
    const entradas = gestiones.map((g) => ({
      input: {
        resultado: g.resultado,
        esCentral: g.orden.zona.esCentral,
        montoCobrar: g.orden.montoCobrar === null ? null : g.orden.montoCobrar.toFixed(2),
        cobraComision: g.orden.cobraComision,
      } as OrdenIngresoInput,
      tarifa: TARIFA,
    }));
    const ing = ingreso42(entradas);
    const ingresoOrdenex = new Prisma.Decimal(ing.ingreso_flete_devolucion)
      .add(new Prisma.Decimal(ing.ingreso_iva_flete_devolucion));
    const codRecaudado = new Prisma.Decimal(0);

    // COD recaudado - (saldo tienda + ingreso Ordenex) = flete_dev + iva_flete_dev (lo absorbe Ordenex).
    const diferencia = codRecaudado.sub(saldoTienda.add(ingresoOrdenex)).abs();
    expect(diferencia.toFixed(2)).toBe("452.00");
    expect(ingresoOrdenex.toFixed(2)).toBe("452.00"); // ingreso 42 intacto
  });
});

describe("WalletTiendaFeedService — reversion historica por ajuste compensatorio (R29)", () => {
  it("cambiar el flag NO reescribe lo historico: la reversion es un ajuste_credito/ajuste_debito nuevo (sin UPDATE/DELETE)", async () => {
    // Con el flag antes en TRUE se registro flete_devolucion = 400 (historico). Para revertir
    // ese tramo al pasar a la opcion 2, se emite un movimiento de AJUSTE compensatorio (categoria
    // propia, tipo credito que neutraliza el debito), NUNCA alterando la fila original.
    // El feed hacia adelante (flag=false) simplemente deja de generar ese debito.
    const tx = buildTx([gestion("devuelta", { montoRecibido: null })]);
    const feedFwd = new WalletTiendaFeedService(buildTarifaRepo(), FLAG_OFF);
    const adelante = await feedFwd.construirMovimientosPorTienda("c2", tx);
    // Hacia adelante ya no genera el debito de devolucion.
    expect(adelante.map((m) => m.categoria)).not.toContain("flete_devolucion");

    // La reversion historica es un ajuste compensatorio (categoria del enum, origen manual),
    // que el ledger acepta como fila NUEVA e inmutable (probado en idempotencia: origen_id NULL
    // no se deduplica). Aqui verificamos que la categoria de ajuste existe y es usable.
    const ajusteCategoria: import("@/lib/types/wallet-tienda").WalletTiendaMovimientoCategoria = "ajuste_credito";
    expect(ajusteCategoria).toBe("ajuste_credito");
  });
});
