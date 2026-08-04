// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import type { WalletModuleProps } from "@/app/(app)/wallet/_components/WalletModule";

// Feature 42 (T11, R18/R19/R21) — la página `/wallet` resuelve el rol SOLO server-side;
// rol ≠ maestro (o sin sesión) → `notFound` (R19). El módulo cliente se stubbea para
// capturar sus props y verificar que los montos cruzan como STRING (R21). El page.tsx
// (Server Component real) se importa sin mockear: se ejercita su lógica.
//
// Feature 173 (T G.3, R59/R62/R64/R65): el pre-fetch de la cabecera pasa a
// `verResumenCajaAction` —las DOS cifras— y la descripción de la página deja de rotular
// ninguna cifra con la palabra que mentía. El cambio de estas aserciones es DELIBERADO y
// está declarado en `design.md §11`.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: vi.fn(),
  verResumenCajaAction: vi.fn(),
  registrarMovimientoManualAction: vi.fn(),
}));

// Feature 45: la página también pre-obtiene el desglose de egresos y las plantillas.
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  // Feature 170 — FASE 2 (T I.2): la página pre-carga la PÁGINA 1 de las plantillas, no el
  // conjunto entero. El listado sin paginar sigue existiendo: lo usa la DESCARGA del panel.
  listarPlantillasPaginadoAction: vi.fn(),
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

// Stub del módulo cliente: captura las props que le pasa el Server Component.
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

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarMovimientosAction);
const resumenMock = vi.mocked(verResumenCajaAction);
const desgloseMock = vi.mocked(verDesgloseEgresosAction);
const plantillasMock = vi.mocked(listarPlantillasPaginadoAction);

const MOVIMIENTOS_OK = {
  status: "ok" as const,
  data: {
    movimientos: [
      {
        id: "m1",
        tipo: "ingreso" as const,
        categoria: "ingreso_flete" as const,
        monto: "1500.00",
        origenTipo: "cierre_dia" as const,
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
      // Feature 173 (R62): un movimiento de una de las categorías NUEVAS viaja por el mismo
      // camino, con la misma forma y sin ningún campo de más.
      {
        id: "m2",
        tipo: "ingreso" as const,
        categoria: "ingreso_cod_recaudado" as const,
        monto: "10000.00",
        origenTipo: "cierre_dia" as const,
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  },
};

/**
 * Feature 173 — las DOS cifras, con dinero de las dos naturalezas: `enCaja` (11 500) y
 * `ganancia` (1 500) son DISTINTAS a propósito, para que ninguna aserción de este archivo
 * pueda pasar por casualidad confundiendo una con la otra.
 */
const RESUMEN_OK = {
  status: "ok" as const,
  resumen: {
    entradas: "11500.00",
    salidas: "0.00",
    enCaja: "11500.00",
    signoEnCaja: "positivo" as const,
    ingresosPropios: "1500.00",
    egresosPropios: "0.00",
    ganancia: "1500.00",
    signoGanancia: "positivo" as const,
    deTerceros: "10000.00",
    periodoFiltrado: false,
  },
};

const DESGLOSE_OK = {
  status: "ok" as const,
  desglose: {
    gastoFijo: "0.00",
    gastoVariable: "0.00",
    sueldo: "0.00",
    indemnizacion: "0.00", // feature 158/R32
    total: "0.00",
  },
};

const PLANTILLAS_OK = {
  status: "ok" as const,
  page: 1,
  pageSize: 25,
  total: 1,
  items: [
    {
      id: "p1",
      concepto: "Alquiler",
      monto: "300.00",
      activa: true,
      periodicidadUnidad: "meses" as const,
      periodicidadCantidad: 1,
      fechaCobro: "2026-07-01",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  listarMock.mockResolvedValue(MOVIMIENTOS_OK);
  resumenMock.mockResolvedValue(RESUMEN_OK);
  desgloseMock.mockResolvedValue(DESGLOSE_OK);
  plantillasMock.mockResolvedValue(PLANTILLAS_OK);
});

afterEach(() => {
  cleanup();
});

describe("WalletPage — control de acceso por rol (R19 / feature 173 R65)", () => {
  it("roles sin acceso total NO ven la wallet (notFound), sin pre-fetch de datos", async () => {
    // Feature 94: `admin` YA no está aquí (ve la wallet, test aparte). Siguen excluidos
    // mensajero, adminTienda y adminSatelite.
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: WalletPage } = await import("@/app/(app)/wallet/page");
      await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R19 / R65: no expone movimientos ni NINGUNA de las dos cifras a un rol no autorizado.
    // Ni siquiera se piden: el guardia está antes del pre-fetch, no después.
    expect(listarMock).not.toHaveBeenCalled();
    expect(resumenMock).not.toHaveBeenCalled();
  });

  it("feature 94 (paridad adm↔maestro): el admin ve la wallet y pre-fetch de datos igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "a", rol: "admin" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wallet-module-stub")).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(resumenMock).toHaveBeenCalledTimes(1);
  });

  it("sin sesión tampoco ve la wallet (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("si una action responde forbidden, no renderiza el módulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R65: si el RESUMEN niega, tampoco se pinta el libro (ni media pantalla)", async () => {
    // La otra mitad de la defensa en profundidad, ahora que la cabecera es otra action: un
    // `forbidden` del resumen no puede dejar la página en pie mostrando el listado.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    resumenMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");
    await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(moduleCalls).toHaveLength(0);
  });
});

describe("WalletPage — pre-fetch del maestro (R18/R21)", () => {
  it("renderiza el libro + las dos cifras y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    // R18: título de la página + módulo del libro/cifras montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wallet-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side con filtros por defecto (page 1).
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(resumenMock).toHaveBeenCalledTimes(1);
    // Feature 45: también pre-obtiene desglose de egresos y plantillas.
    expect(desgloseMock).toHaveBeenCalledTimes(1);
    expect(plantillasMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(2);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("1500.00");
    expect(props.total).toBe(2);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);

    // R64 (feature 173): el DTO de las DOS cifras cruza ENTERO y con todos sus importes como
    // STRING. Se barre el objeto completo, no tres campos elegidos a mano: cualquier importe
    // que alguien añada mañana como `number` cae aquí. `periodoFiltrado` es el único
    // no-STRING y no es dinero.
    for (const [clave, valor] of Object.entries(props.resumen)) {
      if (clave === "periodoFiltrado") {
        expect(typeof valor).toBe("boolean");
        continue;
      }
      expect(typeof valor, `resumen.${clave}`).toBe("string");
    }
    // Y son las DOS, distintas: la pantalla no recibe una cifra repetida dos veces.
    expect(props.resumen.enCaja).toBe("11500.00");
    expect(props.resumen.ganancia).toBe("1500.00");
    expect(props.resumen.enCaja).not.toBe(props.resumen.ganancia);

    // Feature 45 (R11/R12/R26): desglose y plantillas cruzan por props como STRING.
    expect(typeof props.desglose.total).toBe("string");
    expect(props.desglose.total).toBe("0.00");
    // Feature 170 — FASE 2 (T I.2): la prop es la PÁGINA (`items` + `total`), no el array.
    expect(props.plantillas.items).toHaveLength(1);
    expect(props.plantillas.total).toBe(1);
    expect(props.plantillas.items[0].concepto).toBe("Alquiler");
    expect(typeof props.plantillas.items[0].monto).toBe("string");
  });

  it("R62: los movimientos de las categorías NUEVAS llegan al listado como los demás", async () => {
    // Sin campo de más, sin forma distinta y sin filtrarse por el camino: el libro es uno.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    const props = moduleCalls[0];
    const nuevo = props.movimientos.find((m) => m.categoria === "ingreso_cod_recaudado");
    expect(nuevo, "el contra-entrega no llegó al listado").toBeDefined();
    expect(Object.keys(nuevo ?? {}).sort()).toEqual(
      Object.keys(props.movimientos[0]).sort(),
    );
    expect(typeof nuevo?.monto).toBe("string");
  });
});

describe("WalletPage — la descripción de la página (R59)", () => {
  it("R59: la descripción ya no rotula ninguna cifra con la palabra que mentía", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    // El módulo va stubbeado, así que lo que queda en el documento es EXACTAMENTE lo que
    // pone la página: su título y su descripción. Es el sitio preciso donde medir R59.
    expect(document.body.textContent?.toLowerCase()).not.toContain("balance");
  });

  it("R59: y nombra las dos cifras con los mismos nombres que la tarjeta", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    const texto = (document.body.textContent ?? "").toLowerCase();
    expect(texto).toContain("dinero en caja");
    expect(texto).toContain("ganancia de ordenex");
  });
});
