// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import type { MisPagosModuleProps } from "@/app/(app)/mis-pagos/_components/MisPagosModule";

// Feature 44 (T15, R20/R21) — la pagina `/mis-pagos` resuelve el rol SOLO server-side; rol
// != mensajero (o sin sesion) → `notFound` (R20). El backend acota SIEMPRE a `actor.usuarioId`
// = mensajero_id en el WHERE (R20): el mensajero solo ve lo suyo. El modulo cliente se stubbea
// para capturar sus props y verificar que los montos/cuenta cruzan como STRING (R21). El
// page.tsx (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  verMiCuentaPorPagarAction: vi.fn(),
  listarMisPagosAction: vi.fn(),
  listarCuentasPorPagarAction: vi.fn(),
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
const moduleCalls: MisPagosModuleProps[] = [];
vi.mock("@/app/(app)/mis-pagos/_components/MisPagosModule", () => ({
  MisPagosModule: (props: MisPagosModuleProps) => {
    moduleCalls.push(props);
    return <div data-testid="mis-pagos-module-stub" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMisPagosAction,
  verMiCuentaPorPagarAction,
} from "@/lib/actions/wallet-mensajero";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const cuentaMock = vi.mocked(verMiCuentaPorPagarAction);
const pagosMock = vi.mocked(listarMisPagosAction);

const CUENTA_OK = {
  status: "ok" as const,
  cuenta: {
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo" as const,
  },
};

const PAGOS_OK = {
  status: "ok" as const,
  data: {
    movimientos: [
      {
        id: "p1",
        mensajeroId: "u1",
        tipo: "devengo" as const,
        categoria: "pago_devengado" as const,
        monto: "5000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
      {
        id: "p2",
        mensajeroId: "u1",
        tipo: "pago" as const,
        categoria: "pago_efectivo" as const,
        monto: "3000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        fechaMovimiento: "2026-07-12T10:00:00.000Z",
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    cuenta: {
      devengado: "5000.00",
      pagado: "3000.00",
      cuentaPorPagar: "2000.00",
      signo: "positivo" as const,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  moduleCalls.length = 0;
  cuentaMock.mockResolvedValue(CUENTA_OK);
  pagosMock.mockResolvedValue(PAGOS_OK);
});

afterEach(() => {
  cleanup();
});

describe("MisPagosPage — control de acceso por rol (R20)", () => {
  it("roles != mensajero NO ven sus pagos (notFound), sin pre-fetch de datos", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
      await expect(MisPagosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R20: no expone cuenta ni pagos para rol no autorizado.
    expect(cuentaMock).not.toHaveBeenCalled();
    expect(pagosMock).not.toHaveBeenCalled();
  });

  it("sin sesion tampoco ve sus pagos (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
    await expect(MisPagosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(cuentaMock).not.toHaveBeenCalled();
    expect(pagosMock).not.toHaveBeenCalled();
  });

  it("si una action responde forbidden, no renderiza el modulo (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    pagosMock.mockResolvedValue({ status: "forbidden" });
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");
    await expect(MisPagosPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("MisPagosPage — pre-fetch del mensajero (R20/R21)", () => {
  it("renderiza el desglose + cuenta y pasa los datos por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");

    render(await MisPagosPage());

    // R20: titulo de la pagina + modulo del desglose/cuenta montado.
    expect(
      screen.getByRole("heading", { level: 1, name: "Mis pagos" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mis-pagos-module-stub")).toBeInTheDocument();

    // Pre-fetch server-side (cuenta total + desglose con filtros por defecto). El backend
    // acota al mensajero del actor; la pagina no pasa mensajero_id (R20).
    expect(cuentaMock).toHaveBeenCalledTimes(1);
    expect(pagosMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(moduleCalls).toHaveLength(1);
    const props = moduleCalls[0];
    expect(props.movimientos).toHaveLength(2);
    expect(typeof props.movimientos[0].monto).toBe("string");
    expect(props.movimientos[0].monto).toBe("5000.00");
    expect(typeof props.cuenta.cuentaPorPagar).toBe("string");
    expect(typeof props.cuenta.devengado).toBe("string");
    expect(typeof props.cuenta.pagado).toBe("string");
    expect(props.cuenta.cuentaPorPagar).toBe("2000.00");
    expect(props.total).toBe(2);
    expect(props.page).toBe(1);
    expect(props.pageSize).toBe(20);
  });

  it("la cuenta por pagar puede ser CERO (mensajero al dia) y cruza como STRING con signo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    cuentaMock.mockResolvedValue({
      status: "ok",
      cuenta: {
        devengado: "4000.00",
        pagado: "4000.00",
        cuentaPorPagar: "0.00",
        signo: "cero",
      },
    });
    const { default: MisPagosPage } = await import("@/app/(app)/mis-pagos/page");

    render(await MisPagosPage());

    const props = moduleCalls[0];
    expect(typeof props.cuenta.cuentaPorPagar).toBe("string");
    expect(props.cuenta.cuentaPorPagar).toBe("0.00");
    expect(props.cuenta.signo).toBe("cero");
  });
});
