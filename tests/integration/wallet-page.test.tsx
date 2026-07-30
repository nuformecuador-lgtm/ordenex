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
// capturar sus props y verificar que los montos/balance cruzan como STRING (R21). El
// page.tsx (Server Component real) se importa sin mockear: se ejercita su lógica.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: vi.fn(),
  verBalanceAction: vi.fn(),
  registrarMovimientoManualAction: vi.fn(),
}));

// Feature 45: la página también pre-obtiene el desglose de egresos y las plantillas.
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  listarPlantillasAction: vi.fn(),
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
import { listarMovimientosAction, verBalanceAction } from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import { listarPlantillasAction } from "@/lib/actions/gasto-fijo-plantilla";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarMovimientosAction);
const balanceMock = vi.mocked(verBalanceAction);
const desgloseMock = vi.mocked(verDesgloseEgresosAction);
const plantillasMock = vi.mocked(listarPlantillasAction);

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
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  },
};

const BALANCE_OK = {
  status: "ok" as const,
  balance: {
    ingresos: "1500.00",
    egresos: "0.00",
    balance: "1500.00",
    signo: "positivo" as const,
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
  plantillas: [
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
  balanceMock.mockResolvedValue(BALANCE_OK);
  desgloseMock.mockResolvedValue(DESGLOSE_OK);
  plantillasMock.mockResolvedValue(PLANTILLAS_OK);
});

afterEach(() => {
  cleanup();
});

describe("WalletPage — control de acceso por rol (R19)", () => {
  it("roles sin acceso total NO ven la wallet (notFound), sin pre-fetch de datos", async () => {
    // Feature 94: `admin` YA no está aquí (ve la wallet, test aparte). Siguen excluidos
    // mensajero, adminTienda y adminSatelite.
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: WalletPage } = await import("@/app/(app)/wallet/page");
      await expect(WalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R19: no expone movimientos ni balance para rol no autorizado.
    expect(listarMock).not.toHaveBeenCalled();
    expect(balanceMock).not.toHaveBeenCalled();
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
    expect(balanceMock).toHaveBeenCalledTimes(1);
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
});

describe("WalletPage — pre-fetch del maestro (R18/R21)", () => {
  it("renderiza el libro + balance y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletPage } = await import("@/app/(app)/wallet/page");

    render(await WalletPage());

    // R18: título de la página + módulo del libro/balance montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wallet-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side con filtros por defecto (page 1).
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(balanceMock).toHaveBeenCalledTimes(1);
    // Feature 45: también pre-obtiene desglose de egresos y plantillas.
    expect(desgloseMock).toHaveBeenCalledTimes(1);
    expect(plantillasMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(1);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("1500.00");
    expect(typeof props.balance.balance).toBe("string");
    expect(typeof props.balance.ingresos).toBe("string");
    expect(typeof props.balance.egresos).toBe("string");
    expect(props.balance.balance).toBe("1500.00");
    expect(props.total).toBe(1);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);

    // Feature 45 (R11/R12/R26): desglose y plantillas cruzan por props como STRING.
    expect(typeof props.desglose.total).toBe("string");
    expect(props.desglose.total).toBe("0.00");
    expect(props.plantillas).toHaveLength(1);
    expect(props.plantillas[0].concepto).toBe("Alquiler");
    expect(typeof props.plantillas[0].monto).toBe("string");
  });
});
