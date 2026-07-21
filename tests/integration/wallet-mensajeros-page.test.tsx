// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import { SWRConfig } from "swr";

import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
import type { CuentasPorPagarTableProps } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import type {
  CuentaPorPagarResumenDTO,
  ListarPagosDeMensajeroResult,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (T14, R18/R19/R21) — la pagina `/wallet/mensajeros` resuelve el rol SOLO
// server-side; rol != maestro (o sin sesion) → `notFound` (R19). La tabla cliente se stubbea
// para capturar sus props y verificar que los montos (devengado/pagado/cuentaPorPagar) cruzan
// como STRING (R21). El page.tsx (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarAction: vi.fn(),
  verMiCuentaPorPagarAction: vi.fn(),
  listarMisPagosAction: vi.fn(),
  listarPagosDeMensajeroAction: vi.fn(),
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

// Stub de la tabla cliente: captura las props que le pasa el Server Component.
const tableCalls: CuentasPorPagarTableProps[] = [];
vi.mock("@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable", () => ({
  CuentasPorPagarTable: (props: CuentasPorPagarTableProps) => {
    tableCalls.push(props);
    return <div data-testid="cuentas-por-pagar-table-stub" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarCuentasPorPagarAction,
  listarPagosDeMensajeroAction,
} from "@/lib/actions/wallet-mensajero";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarCuentasPorPagarAction);
const desgloseMock = vi.mocked(listarPagosDeMensajeroAction);

const CUENTAS_OK = {
  status: "ok" as const,
  mensajeros: [
    {
      mensajeroId: "u1",
      mensajeroNombre: "Ana Mensajera",
      devengado: "5000.00",
      pagado: "3000.00",
      cuentaPorPagar: "2000.00",
      signo: "positivo" as const,
    },
    {
      mensajeroId: "u2",
      mensajeroNombre: "Beto Repartidor",
      devengado: "4000.00",
      pagado: "4000.00",
      cuentaPorPagar: "0.00",
      signo: "cero" as const,
    },
  ],
};

// Resumen agregado (saldo inicial antes de la primera carga del desglose).
const RESUMEN: CuentaPorPagarResumenDTO = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  devengado: "5000.00",
  pagado: "3000.00",
  cuentaPorPagar: "2000.00",
  signo: "positivo",
};

// Desglose por cierre SIN filtros (carga inicial). Dos movimientos, mas reciente primero (el
// backend ya los devuelve ordenados desc; la UI preserva ese orden).
const DESGLOSE_DATA: ListarPagosDeMensajeroResult = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  movimientos: [
    {
      id: "m2",
      mensajeroId: "u1",
      tipo: "pago",
      categoria: "pago_efectivo",
      monto: "3000.00",
      origenTipo: "cierre_dia",
      origenId: "c2",
      descripcion: null,
      fechaMovimiento: "2026-07-12T10:00:00.000Z",
    },
    {
      id: "m1",
      mensajeroId: "u1",
      tipo: "devengo",
      categoria: "pago_devengado",
      monto: "5000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      fechaMovimiento: "2026-07-05T10:00:00.000Z",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  cuenta: {
    devengado: "5000.00",
    pagado: "3000.00",
    cuentaPorPagar: "2000.00",
    signo: "positivo",
  },
};

// Desglose CON filtros aplicados: subconjunto + saldo del conjunto filtrado (R22).
const DESGLOSE_FILTRADO: ListarPagosDeMensajeroResult = {
  mensajeroId: "u1",
  mensajeroNombre: "Ana Mensajera",
  movimientos: [
    {
      id: "m1",
      mensajeroId: "u1",
      tipo: "devengo",
      categoria: "pago_devengado",
      monto: "2500.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      fechaMovimiento: "2026-07-05T10:00:00.000Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  cuenta: {
    devengado: "2500.00",
    pagado: "1000.00",
    cuentaPorPagar: "1500.00",
    signo: "positivo",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls.length = 0;
  listarMock.mockResolvedValue(CUENTAS_OK);
  desgloseMock.mockResolvedValue({ status: "ok", data: DESGLOSE_DATA });
});

afterEach(() => {
  cleanup();
});

describe("WalletMensajerosPage — control de acceso por rol (R19)", () => {
  it("roles sin acceso total NO ven las cuentas por pagar (notFound), sin pre-fetch de datos", async () => {
    // Feature 94: `admin` YA no está aquí (ve las cuentas, test aparte). Siguen excluidos
    // mensajero, adminTienda y adminSatelite.
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: WalletMensajerosPage } = await import(
        "@/app/(app)/wallet/mensajeros/page"
      );
      await expect(WalletMensajerosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // R19: no expone cuentas por pagar para rol no autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("feature 94 (paridad adm↔maestro): el admin ve las cuentas por pagar igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "a", rol: "admin" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    render(await WalletMensajerosPage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cuentas por pagar a mensajeros",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("cuentas-por-pagar-table-stub"),
    ).toBeInTheDocument();
    expect(listarMock).toHaveBeenCalledTimes(1);
  });

  it("sin sesion tampoco ve las cuentas por pagar (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );
    await expect(WalletMensajerosPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("si la action responde forbidden, no renderiza la tabla (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );
    await expect(WalletMensajerosPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("WalletMensajerosPage — pre-fetch del maestro (R18/R21)", () => {
  it("renderiza la tabla y pasa las cuentas por pagar por props como STRING", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletMensajerosPage } = await import(
      "@/app/(app)/wallet/mensajeros/page"
    );

    render(await WalletMensajerosPage());

    // R18: titulo de la pagina + tabla de cuentas por pagar montada.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Cuentas por pagar a mensajeros",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("cuentas-por-pagar-table-stub"),
    ).toBeInTheDocument();

    // Pre-fetch server-side (todas las cuentas por pagar; maestro no acotado, R19).
    expect(listarMock).toHaveBeenCalledTimes(1);

    // R21: los datos sensibles cruzan como props ya serializados (STRING), sin Decimal.
    expect(tableCalls).toHaveLength(1);
    const props = tableCalls[0];
    expect(props.mensajeros).toHaveLength(2);
    expect(typeof props.mensajeros[0].devengado).toBe("string");
    expect(typeof props.mensajeros[0].pagado).toBe("string");
    expect(typeof props.mensajeros[0].cuentaPorPagar).toBe("string");
    expect(props.mensajeros[0].cuentaPorPagar).toBe("2000.00");
    expect(props.mensajeros[1].cuentaPorPagar).toBe("0.00");
    expect(props.mensajeros[1].signo).toBe("cero");
  });
});

// El desglose por cierre del maestro (R18/R22) se monta al EXPANDIR una fila. Aqui se prueba el
// componente real que aparece en esa expansion (`DesglosePagosMensajero`), envuelto en un
// `SWRConfig` con cache aislada (provider nuevo + sin dedup) para que cada test observe sus
// propias llamadas a la Server Action del maestro (mockeada).
function renderDesglose(resumen: CuentaPorPagarResumenDTO = RESUMEN) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DesglosePagosMensajero resumen={resumen} id="desglose-u1" />
    </SWRConfig>,
  );
}

describe("DesglosePagosMensajero — desglose por cierre del maestro (R18)", () => {
  it("al expandir carga el desglose por cierre paginado, mas reciente primero", async () => {
    renderDesglose();

    // R18: carga client-side al montar (= al expandir), acotada al mensajeroId, pagina 1.
    await waitFor(() => expect(desgloseMock).toHaveBeenCalledTimes(1));
    expect(desgloseMock).toHaveBeenCalledWith({
      mensajeroId: "u1",
      page: 1,
      pageSize: 20,
    });

    const tabla = await screen.findByRole("table", {
      name: "Desglose por cierre de Ana Mensajera",
    });

    // Espera a que los movimientos se rendericen (sale del estado "Cargando…").
    await within(tabla).findByText("2026-07-12");

    // R18: los movimientos aparecen en el orden que devuelve el backend (mas reciente primero):
    // la fila del cierre del 2026-07-12 precede a la del 2026-07-05.
    const filas = within(tabla).getAllByRole("row");
    // filas[0] = cabecera; filas[1] = mas reciente; filas[2] = mas antiguo.
    expect(within(filas[1]).getByText("2026-07-12")).toBeInTheDocument();
    expect(within(filas[2]).getByText("2026-07-05")).toBeInTheDocument();

    // Money-safe (R21/R27): los montos se renderizan TAL CUAL (STRING con simbolo).
    expect(within(tabla).getByText("₡3000.00")).toBeInTheDocument();
    expect(within(tabla).getByText("₡5000.00")).toBeInTheDocument();
  });
});

describe("DesglosePagosMensajero — filtros server-side fecha/cierre (R22)", () => {
  it("aplica los filtros invocando la action con cierreId/desde/hasta y vuelve a la pagina 1", async () => {
    renderDesglose();

    // Espera la carga inicial (sin filtros) y que el desglose ya este renderizado.
    await screen.findByText("2026-07-12");
    expect(desgloseMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-07-31" },
    });

    const form = screen.getByRole("form", {
      name: "Filtros del desglose de Ana Mensajera",
    });
    fireEvent.submit(form);

    // R22: la action se invoca con los filtros de fecha/cierre en el WHERE server-side.
    await waitFor(() => expect(desgloseMock).toHaveBeenCalledTimes(2));
    expect(desgloseMock).toHaveBeenLastCalledWith({
      mensajeroId: "u1",
      page: 1, // nuevos filtros -> vuelve a la primera pagina
      pageSize: 20,
      cierreId: "c1",
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
  });

  it("el saldo mostrado refleja el CONJUNTO FILTRADO (result.data.cuenta), no el agregado", async () => {
    renderDesglose();

    // Espera a que la carga inicial (sin filtros) resuelva y renderice sus movimientos.
    await screen.findByText("2026-07-12");
    const saldo = screen.getByRole("region", { name: "Desglose de Ana Mensajera" });
    // Carga inicial: el saldo muestra el agregado (cuentaPorPagar ₡2000.00).
    expect(within(saldo).getByText("₡2000.00")).toBeInTheDocument();

    // La siguiente carga (al filtrar) devuelve el saldo del conjunto filtrado.
    desgloseMock.mockResolvedValueOnce({ status: "ok", data: DESGLOSE_FILTRADO });

    fireEvent.change(screen.getByLabelText("Cierre"), {
      target: { value: "c1" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Filtros del desglose de Ana Mensajera" }),
    );

    // R22: el saldo se recalcula desde result.data.cuenta (cuentaPorPagar ₡1500.00), y ya no
    // muestra el agregado (₡2000.00).
    await waitFor(() =>
      expect(within(saldo).getByText("₡1500.00")).toBeInTheDocument(),
    );
    expect(within(saldo).queryByText("₡2000.00")).not.toBeInTheDocument();
  });
});
