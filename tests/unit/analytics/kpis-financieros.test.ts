import { describe, it, expect, vi, beforeEach } from "vitest";

import { sumarMontos } from "@/lib/utils/kpis-financieros";

vi.mock("@/lib/actions/wallet", () => ({ verResumenCajaAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({ listarSaldosTiendasCompletoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarCompletoAction: vi.fn(),
}));

const { verResumenCajaAction } = await import("@/lib/actions/wallet");
const { listarSaldosTiendasCompletoAction } = await import("@/lib/actions/wallet-tienda");
const { listarCuentasPorPagarCompletoAction } = await import("@/lib/actions/wallet-mensajero");
const { cargarKpisFinancieros, kpisDenegados } = await import(
  "@/app/(app)/analitica/_components/finanzas/cargar-kpis"
);

const cajaMock = vi.mocked(verResumenCajaAction);
const tiendasMock = vi.mocked(listarSaldosTiendasCompletoAction);
const mensajerosMock = vi.mocked(listarCuentasPorPagarCompletoAction);

const RESUMEN = {
  entradas: "1000.00",
  salidas: "400.00",
  enCaja: "600.00",
  signoEnCaja: "positivo",
  ingresosPropios: "500.00",
  egresosPropios: "200.00",
  ganancia: "300.00",
  signoGanancia: "positivo",
  deTerceros: "300.00",
  periodoFiltrado: false,
};

function todoOk() {
  cajaMock.mockResolvedValue({ status: "ok", resumen: RESUMEN } as never);
  tiendasMock.mockResolvedValue({
    status: "ok",
    items: [{ saldo: "100.10" }, { saldo: "200.20" }, { saldo: "-50.30" }],
    total: 3,
  } as never);
  mensajerosMock.mockResolvedValue({
    status: "ok",
    items: [{ cuentaPorPagar: "75.55" }, { cuentaPorPagar: "24.45" }],
    total: 2,
  } as never);
}

/** El KPI de un id, para no repetir el `find` en cada caso. */
const kpiDe = (kpis: readonly { id: string }[], id: string) => kpis.find((k) => k.id === id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("La suma de importes es money-safe", () => {
  // Con `number`, `0.1 + 0.2` ya no es `0.3`: sobre mil saldos de dos decimales el binario
  // devuelve céntimos que no existen. Por eso se suma con `Prisma.Decimal`.
  it("suma decimales sin arrastrar error binario", () => {
    expect(sumarMontos(["0.10", "0.20"])).toBe("0.30");
    expect(sumarMontos(Array.from({ length: 10 }, () => "0.10"))).toBe("1.00");
  });

  // Los signos YA vienen dentro del string: una tienda que DEBE trae "-123.45". Aquí no se
  // consulta el campo `signo` ni se cambia ningún signo.
  it("respeta los negativos que ya trae el ledger", () => {
    expect(sumarMontos(["100.00", "-30.00"])).toBe("70.00");
  });

  it("una lista vacía suma cero, no vacío", () => {
    expect(sumarMontos([])).toBe("0.00");
  });

  it("siempre devuelve escala 2", () => {
    expect(sumarMontos(["1", "2.5"])).toBe("3.50");
  });
});

describe("El cargador de los seis KPIs", () => {
  it("trae las seis tarjetas, en orden y con su cifra", async () => {
    todoOk();

    const kpis = await cargarKpisFinancieros();

    expect(kpis.map((k) => k.id)).toEqual([
      "ingresos",
      "egresos",
      "enCaja",
      "ganancia",
      "porPagarTiendas",
      "porPagarMensajeros",
    ]);
    expect(kpis.every((k) => k.estado === "ok")).toBe(true);
  });

  // Las cuatro primeras salen ENTERAS del resumen de la caja: aquí no se recalcula la ganancia
  // ni el dinero en caja. Si se recalcularan, habría dos definiciones de la ganancia — y dos
  // definiciones de la ganancia acaban dando dos ganancias.
  it("las cuatro cifras de caja son las del wallet, tal cual", async () => {
    todoOk();

    const kpis = await cargarKpisFinancieros();

    expect(kpiDe(kpis, "ingresos")).toMatchObject({ monto: RESUMEN.entradas });
    expect(kpiDe(kpis, "egresos")).toMatchObject({ monto: RESUMEN.salidas });
    expect(kpiDe(kpis, "enCaja")).toMatchObject({ monto: RESUMEN.enCaja });
    expect(kpiDe(kpis, "ganancia")).toMatchObject({ monto: RESUMEN.ganancia });
  });

  it("las dos cuentas por pagar son la suma de cada ledger", async () => {
    todoOk();

    const kpis = await cargarKpisFinancieros();

    expect(kpiDe(kpis, "porPagarTiendas")).toMatchObject({ monto: "250.00" });
    expect(kpiDe(kpis, "porPagarMensajeros")).toMatchObject({ monto: "100.00" });
  });

  // «No recibe filtros» es contrato, no un detalle: con filtros, «Dinero en caja» dejaría de
  // ser el dinero que hay para ser el neto de un periodo, con el mismo rótulo.
  it("pide las tres fuentes SIN filtros", async () => {
    todoOk();

    await cargarKpisFinancieros();

    expect(cajaMock).toHaveBeenCalledWith({});
    expect(tiendasMock).toHaveBeenCalledWith({});
    expect(mensajerosMock).toHaveBeenCalledWith({});
  });

  it("un fallo de una fuente NO tumba a las otras", async () => {
    todoOk();
    tiendasMock.mockResolvedValue({ status: "error", code: "INTERNAL" } as never);

    const kpis = await cargarKpisFinancieros();

    expect(kpiDe(kpis, "porPagarTiendas")).toMatchObject({ estado: "error" });
    expect(kpiDe(kpis, "ganancia")).toMatchObject({ estado: "ok" });
    expect(kpiDe(kpis, "porPagarMensajeros")).toMatchObject({ estado: "ok" });
  });

  // «Prohibido» y «se rompió» son dos hechos distintos y la tarjeta los pinta distinto: uno es
  // el estado normal de ese rol y el otro un fallo que anunciar.
  it("un denegado no se presenta como error ni como cero", async () => {
    todoOk();
    cajaMock.mockResolvedValue({ status: "forbidden" } as never);

    const kpis = await cargarKpisFinancieros();

    for (const id of ["ingresos", "egresos", "enCaja", "ganancia"]) {
      expect(kpiDe(kpis, id)).toEqual({
        estado: "denegado",
        id,
        etiqueta: expect.any(String),
      });
    }
  });

  // Sumar lo que cupo daría un total CORTO con pinta de completo, que es peor que no darlo.
  it("con el dataset por encima del tope no se enseña media suma", async () => {
    todoOk();
    mensajerosMock.mockResolvedValue({
      status: "limite_excedido",
      total: 99_999,
      limite: 10_000,
    } as never);

    const kpi = kpiDe(await cargarKpisFinancieros(), "porPagarMensajeros");

    expect(kpi).toMatchObject({ estado: "error" });
    expect(kpi).not.toHaveProperty("monto");
  });
});

describe("El atajo de los roles sin acceso total", () => {
  // ⚠ NO DEBE TOCAR LA BASE. Un rol denegado no llega al dinero ni una sola vez, tampoco para
  // que le digan que no: sin esto, cada carga de la pantalla de un adminTienda dispararía tres
  // consultas que solo pueden responder «no».
  it("produce las seis tarjetas denegadas sin consultar nada", () => {
    const kpis = kpisDenegados();

    expect(kpis).toHaveLength(6);
    expect(kpis.every((k) => k.estado === "denegado")).toBe(true);
    expect(cajaMock).not.toHaveBeenCalled();
    expect(tiendasMock).not.toHaveBeenCalled();
    expect(mensajerosMock).not.toHaveBeenCalled();
  });

  // Las mismas seis y en el mismo orden que el camino feliz: si fueran otras, un rol sin acceso
  // vería una rejilla de otro tamaño que la del maestro.
  it("son los mismos seis ids que trae el cargador", async () => {
    todoOk();

    expect(kpisDenegados().map((k) => k.id)).toEqual(
      (await cargarKpisFinancieros()).map((k) => k.id),
    );
  });
});
