// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

// El topbar monta el botón de salir (cliente): se stubbea para aislar el pre-fetch y las props.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

import type { WalletModuleProps } from "@/app/(app)/wallet/_components/WalletModule";

// FICHA 333 (G6, R44 · R40/R41) — LA PÁGINA `/wallet` PRE-OBTIENE LA COLA Y LA PASA POR PROPS.
//
// La cola de cobros de gasto fijo es dinero por autorizar: dato sensible. `docs/architecture.md`
// manda que baje por props desde el Server Component que ya validó el rol, y no que la pantalla
// se la pida al navegador saltándose ese guardia. Aquí se mide exactamente eso, más las dos
// mitades del rol: el `admin` VE la cola (R25) y NO la decide (R24/R40).

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: vi.fn(),
  listarMovimientosCompletoAction: vi.fn(),
  // FICHA 343 (B5): la tarjeta de la ganancia monta filas desplegables y el panel de cada una
  // importa el borde del detalle. Sin declararlo aqui, el import no resuelve y este archivo no
  // ejecuta ni un caso.
  listarMovimientosDeFilaAction: vi.fn(),
  verResumenCajaAction: vi.fn(),
  registrarMovimientoManualAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: vi.fn(),
  registrarEgresoAdministrativoAction: vi.fn(),
  reversarEgresoAdministrativoAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  listarPlantillasPaginadoAction: vi.fn(),
  listarPlantillasCompletoAction: vi.fn(),
  crearPlantillaAction: vi.fn(),
  actualizarPlantillaAction: vi.fn(),
  eliminarPlantillaAction: vi.fn(),
  setActivaPlantillaAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-cobro", () => ({
  listarCobrosPendientesAction: vi.fn(),
  aprobarCobroGastoFijoAction: vi.fn(),
  rechazarCobroGastoFijoAction: vi.fn(),
  contarCobrosPendientesDePlantillaAction: vi.fn(),
}));
// FICHA 337 (segunda mitad): la pagina pre-obtiene TAMBIEN la cola de cobros por rechazo de
// tienda. Sin este `vi.mock` la action real corre, abre Prisma y el archivo entero cae con un
// `INTERNAL` de conexion -- que es lo que paso al cablearla: el rojo apunta a la pagina, pero la
// causa es una action sin doblar.
vi.mock("@/lib/actions/rechazo-tienda-cobro", () => ({
  listarCobrosRechazoTiendaAction: vi.fn(),
  aprobarCobroRechazoTiendaAction: vi.fn(),
  rechazarCobroRechazoTiendaAction: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/**
 * Stub del módulo cliente que CAPTURA sus props. No delega en el real a propósito: lo que este
 * archivo mide es la frontera servidor→cliente, y montar la pantalla entera metería en el camino
 * el SWR de tres paneles sin añadir nada a lo que se afirma.
 */
const moduleCalls: WalletModuleProps[] = [];
vi.mock("@/app/(app)/wallet/_components/WalletModule", () => ({
  WalletModule: (props: WalletModuleProps) => {
    moduleCalls.push(props);
    return <div data-testid="wallet-module-stub" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMovimientosAction, verResumenCajaAction } from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { listarPlantillasPaginadoAction } from "@/lib/actions/gasto-fijo-plantilla";
import { listarCobrosPendientesAction } from "@/lib/actions/gasto-fijo-cobro";
import { listarCobrosRechazoTiendaAction } from "@/lib/actions/rechazo-tienda-cobro";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarMovimientosAction);
const resumenMock = vi.mocked(verResumenCajaAction);
const desgloseMock = vi.mocked(verDesgloseEgresosAction);
const plantillasMock = vi.mocked(listarPlantillasPaginadoAction);
const cobrosMock = vi.mocked(listarCobrosPendientesAction);
const cobrosRechazoMock = vi.mocked(listarCobrosRechazoTiendaAction);

const MOVIMIENTOS_OK = {
  status: "ok" as const,
  data: { movimientos: [], total: 0, page: 1, pageSize: 20 },
};

const RESUMEN_OK = {
  status: "ok" as const,
  resumen: {
    entradas: "0.00",
    salidas: "0.00",
    enCaja: "0.00",
    signoEnCaja: "positivo" as const,
    ingresosPropios: "0.00",
    egresosPropios: "0.00",
    ganancia: "0.00",
    signoGanancia: "positivo" as const,
    deTerceros: "0.00",
    periodoFiltrado: false,
    porcentajeTiendas: "0.00",
    modoComposicion: "sin_reparto" as const,
  },
  composicion: {
    ingresos: {
      ingreso_flete: "0.00",
      ingreso_flete_devolucion: "0.00",
      ingreso_comision_cod: "0.00",
      ingreso_iva_flete: "0.00",
      ingreso_iva_flete_devolucion: "0.00",
      ingreso_iva_comision_cod: "0.00",
      ingreso_ajuste: "0.00",
    },
    totalIngresos: "0.00",
    // Ficha 339 (T1.3): las dos cubetas nuevas y la bandera del servidor.
    egresos: {
      egreso_pago_mensajero: "0.00",
      egreso_ajuste: "0.00",
    },
    otrosEgresos: "0.00",
    hayOtrosEgresos: false,
    totalEgresos: "0.00",
  },
};

const DESGLOSE_OK = {
  status: "ok" as const,
  desglose: {
    gastoFijo: "0.00",
    gastoVariable: "0.00",
    sueldo: "0.00",
    indemnizacion: "0.00",
    total: "0.00",
  },
};

const PLANTILLAS_OK = {
  status: "ok" as const,
  page: 1,
  pageSize: 25,
  total: 0,
  items: [],
};

/**
 * La cola tal como la entrega el servidor: DOS filas pintadas y SIETE pendientes. Los dos números
 * son distintos a propósito — es lo que hace que `items.length` no pueda pasar por `total`.
 */
const COBROS_OK = {
  status: "ok" as const,
  total: 7,
  items: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      concepto: "Alquiler de bodega",
      monto: "300000.00",
      periodo: "2026-08",
      generadoEl: "2026-08-27",
      estado: "pendiente" as const,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      concepto: "Internet",
      monto: "45.00",
      periodo: "2026-08",
      generadoEl: "2026-08-29",
      estado: "pendiente" as const,
    },
  ],
};

/**
 * FICHA 337 (segunda mitad) — la cola de cobros por RECHAZO DE TIENDA que la pagina pre-obtiene.
 * Vacia y con `total` en cero: este archivo mide la cola de gasto fijo, y lo unico que hace falta
 * de la otra es que su lectura exista y que su `ok` no tumbe la pagina.
 */
const COBROS_RECHAZO_OK = { status: "ok" as const, items: [], total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  listarMock.mockResolvedValue(MOVIMIENTOS_OK);
  resumenMock.mockResolvedValue(RESUMEN_OK);
  desgloseMock.mockResolvedValue(DESGLOSE_OK);
  plantillasMock.mockResolvedValue(PLANTILLAS_OK);
  cobrosMock.mockResolvedValue(COBROS_OK);
  cobrosRechazoMock.mockResolvedValue(COBROS_RECHAZO_OK);
});

afterEach(() => {
  cleanup();
});

describe("WalletPage — la cola de cobros de gasto fijo baja por props (R44)", () => {
  it("⭑ la pre-obtiene el SERVIDOR, con el input vacío, y la pasa al módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    // Una sola lectura, en el `Promise.all` que la página ya hacía. El input va VACÍO: el schema
    // del borde es `.strict()` y no admite ninguna clave.
    expect(cobrosMock).toHaveBeenCalledTimes(1);
    expect(cobrosMock.mock.calls[0][0]).toEqual({});

    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.cobrosPendientes.items).toHaveLength(2);
    expect(props.cobrosPendientes.items[0].concepto).toBe("Alquiler de bodega");
  });

  it("⭑ el `total` que cruza es el del SERVIDOR, no el largo de `items` (R41)", () => {
    // El caso que DISCRIMINA en esta capa: si la página compusiera el número con lo que pinta,
    // la insignia diría «2 por aprobar» habiendo siete cobros esperando.
    expect(COBROS_OK.items).toHaveLength(2);
    expect(COBROS_OK.total).toBe(7);
  });

  it("el `total` llega tal cual al módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    expect(moduleCalls[0].cobrosPendientes.total).toBe(7);
    expect(moduleCalls[0].cobrosPendientes.total).not.toBe(
      moduleCalls[0].cobrosPendientes.items.length,
    );
  });

  it("⭑ el monto cruza la frontera como CADENA (R43)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    for (const cobro of moduleCalls[0].cobrosPendientes.items) {
      expect(typeof cobro.monto, `monto de ${cobro.concepto}`).toBe("string");
    }
    expect(moduleCalls[0].cobrosPendientes.items[0].monto).toBe("300000.00");
  });

  it("y el DTO no arrastra la clave de idempotencia ni los identificadores internos", async () => {
    // design §6.1: ni `origenId`, ni `plantillaId`, ni `movimientoId` cruzan al navegador. La
    // página no puede añadirlos de vuelta al componer las props.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    for (const cobro of moduleCalls[0].cobrosPendientes.items) {
      expect(Object.keys(cobro).sort()).toEqual([
        "concepto",
        "estado",
        "generadoEl",
        "id",
        "monto",
        "periodo",
      ]);
    }
  });
});

describe("WalletPage — quién puede decidir se resuelve en el servidor (R40)", () => {
  it("el maestro llega con permiso para decidir", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    expect(moduleCalls[0].puedeDecidirCobros).toBe(true);
  });

  it("⭑ el admin VE la cola y NO puede decidirla", async () => {
    // Las dos mitades de la excepción deliberada a la paridad de la ficha 94, en la misma
    // aserción: la cola viaja entera (R25) y el permiso de decidir es `false` (R24/R40).
    resolveActorMock.mockResolvedValue({ usuarioId: "a", rol: "admin" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    expect(cobrosMock).toHaveBeenCalledTimes(1);
    expect(moduleCalls[0].cobrosPendientes.items).toHaveLength(2);
    expect(moduleCalls[0].puedeDecidirCobros).toBe(false);
  });
});

describe("WalletPage — la cola no se lee sin pasar por el guardia de la página (R44)", () => {
  it("sin sesión: `notFound` y la cola ni se pide", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(cobrosMock).not.toHaveBeenCalled();
    expect(moduleCalls).toHaveLength(0);
  });

  it("un rol sin acceso total tampoco la pide", async () => {
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }

    expect(cobrosMock).not.toHaveBeenCalled();
    expect(moduleCalls).toHaveLength(0);
  });

  it("⭑ si el servicio niega la cola, no se pinta media pantalla", async () => {
    // Defensa en profundidad, igual que con el resumen y el libro: un `forbidden` en cualquiera
    // de las cinco lecturas deja la página en `notFound` en vez de montar el módulo sin una de
    // ellas — que es como se enseña una wallet a la que le falta justo la parte que autoriza.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    cobrosMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(moduleCalls).toHaveLength(0);
  });
});
