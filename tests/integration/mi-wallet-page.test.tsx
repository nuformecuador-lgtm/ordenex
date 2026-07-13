// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import type { MiWalletModuleProps } from "@/app/(app)/mi-wallet/_components/MiWalletModule";

// Feature 43 (T14, R18/R19/R21) — la pagina `/mi-wallet` resuelve el rol SOLO server-side;
// rol != adminTienda (o sin sesion) → `notFound` (R19). El backend acota SIEMPRE a
// `actor.usuarioId` = tienda_id en el WHERE (R19): la tienda solo ve lo suyo. El modulo
// cliente se stubbea para capturar sus props y verificar que los montos/saldo cruzan como
// STRING (R21). El page.tsx (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-tienda", () => ({
  verMiSaldoAction: vi.fn(),
  listarMisMovimientosAction: vi.fn(),
  listarSaldosTiendasAction: vi.fn(),
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

// Stub del modulo cliente: captura las props que le pasa el Server Component.
const moduleCalls: MiWalletModuleProps[] = [];
vi.mock("@/app/(app)/mi-wallet/_components/MiWalletModule", () => ({
  MiWalletModule: (props: MiWalletModuleProps) => {
    moduleCalls.push(props);
    return <div data-testid="mi-wallet-module-stub" />;
  },
}));

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMisMovimientosAction,
  verMiSaldoAction,
} from "@/lib/actions/wallet-tienda";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const saldoMock = vi.mocked(verMiSaldoAction);
const listarMock = vi.mocked(listarMisMovimientosAction);

const SALDO_OK = {
  status: "ok" as const,
  saldo: {
    creditos: "5000.00",
    debitos: "1200.00",
    saldo: "3800.00",
    signo: "positivo" as const,
  },
};

const MOVIMIENTOS_OK = {
  status: "ok" as const,
  data: {
    movimientos: [
      {
        id: "m1",
        tiendaId: "t1",
        tipo: "credito" as const,
        categoria: "cod_recaudado" as const,
        monto: "5000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
      {
        id: "m2",
        tiendaId: "t1",
        tipo: "debito" as const,
        categoria: "flete" as const,
        monto: "1000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    saldo: {
      creditos: "5000.00",
      debitos: "1200.00",
      saldo: "3800.00",
      signo: "positivo" as const,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  saldoMock.mockResolvedValue(SALDO_OK);
  listarMock.mockResolvedValue(MOVIMIENTOS_OK);
});

afterEach(() => {
  cleanup();
});

describe("MiWalletPage — control de acceso por rol (R19)", () => {
  it("roles != adminTienda NO ven su wallet (notFound), sin pre-fetch de datos", async () => {
    const otros: RolValue[] = ["mensajero", "admin", "maestro", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
      await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R19: no expone saldo ni movimientos para rol no autorizado.
    expect(saldoMock).not.toHaveBeenCalled();
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("sin sesion tampoco ve su wallet (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(saldoMock).not.toHaveBeenCalled();
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("si una action responde forbidden, no renderiza el modulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");
    await expect(MiWalletPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("MiWalletPage — pre-fetch del adminTienda (R18/R21)", () => {
  it("renderiza el desglose + saldo y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");

    render(await MiWalletPage());

    // R18: titulo de la pagina + modulo del desglose/saldo montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Mi wallet" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mi-wallet-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side (saldo total + desglose con filtros por defecto).
    expect(saldoMock).toHaveBeenCalledTimes(1);
    expect(listarMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(2);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("5000.00");
    expect(typeof props.saldo.saldo).toBe("string");
    expect(typeof props.saldo.creditos).toBe("string");
    expect(typeof props.saldo.debitos).toBe("string");
    expect(props.saldo.saldo).toBe("3800.00");
    expect(props.total).toBe(2);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);
  });

  it("el saldo puede ser NEGATIVO (la tienda debe a Ordenex) y cruza como STRING con signo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    saldoMock.mockResolvedValue({
      status: "ok",
      saldo: {
        creditos: "0.00",
        debitos: "450.00",
        saldo: "-450.00",
        signo: "negativo",
      },
    });
    const { default: MiWalletPage } = await import("@/app/(app)/mi-wallet/page");

    render(await MiWalletPage());

    const props = moduleCalls[0];
    expect(typeof props.saldo.saldo).toBe("string");
    expect(props.saldo.saldo).toBe("-450.00");
    expect(props.saldo.signo).toBe("negativo");
  });
});
