// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import type { SaldosTiendasTableProps } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";

// Feature 171 (T2.8, R6/R30) — la página `/wallet/tiendas` NO existía como test hasta ahora,
// y la 171 le cuelga un desplegable a su tabla. Antes de tocar nada hay que poder afirmar lo
// que la 171 promete NO cambiar: quién entra, quién no, y que los saldos siguen cruzando la
// frontera ya serializados.
//
// El rol se resuelve SOLO server-side (`resolveActorFromSession`): cualquier rol sin acceso
// total —y la falta de sesión— acaba en `notFound` y SIN pre-fetch, que es lo que impide que
// los saldos de todas las tiendas salgan siquiera de la base. La tabla cliente se stubbea
// para capturar sus props; el `page.tsx` (Server Component real) se importa sin mockear.

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-tienda", () => ({
  // Feature 170 — FASE 2 (T I.2): la página pre-carga la PÁGINA 1 de los saldos. El listado
  // sin paginar sigue existiendo: lo usa la DESCARGA de la tabla (R52).
  listarSaldosTiendasAction: vi.fn(),
  listarSaldosTiendasPaginadoAction: vi.fn(),
  listarMovimientosDeTiendaAction: vi.fn(),
  listarMovimientosDeTiendaCompletoAction: vi.fn(),
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

// Feature 57: el PageHeader del topbar monta el LogoutButton (client: useRouter/useToast).
// Se stubbea para aislar el pre-fetch/props de la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

// Stub de la tabla cliente: captura las props que le pasa el Server Component.
const tableCalls: SaldosTiendasTableProps[] = [];
vi.mock("@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable", () => ({
  SaldosTiendasTable: (props: SaldosTiendasTableProps) => {
    tableCalls.push(props);
    return <div data-testid="saldos-tiendas-table-stub" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarMovimientosDeTiendaAction,
  listarSaldosTiendasPaginadoAction,
} from "@/lib/actions/wallet-tienda";

const resolveActorMock = vi.mocked(resolveActorFromSession);
const saldosMock = vi.mocked(listarSaldosTiendasPaginadoAction);
const desgloseMock = vi.mocked(listarMovimientosDeTiendaAction);

const SALDOS_OK = {
  status: "ok" as const,
  page: 1,
  pageSize: 25,
  total: 2,
  items: [
    {
      tiendaId: "t1",
      tiendaNombre: "Tienda Norte",
      saldo: "9000.00",
      signo: "positivo" as const,
    },
    {
      tiendaId: "t2",
      tiendaNombre: "Tienda Sur",
      saldo: "-452.00",
      signo: "negativo" as const,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls.length = 0;
  saldosMock.mockResolvedValue(SALDOS_OK);
});

afterEach(() => {
  cleanup();
});

describe("WalletTiendasPage — alcance por rol, conservado (R30)", () => {
  it("los roles sin acceso total NO ven los saldos (notFound), y no se pre-obtiene nada", async () => {
    const otros: RolValue[] = ["mensajero", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const { default: WalletTiendasPage } = await import(
        "@/app/(app)/wallet/tiendas/page"
      );
      await expect(WalletTiendasPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // Lo que importa no es solo que no se pinte: es que el dato NO SALE de la base.
    expect(saldosMock).not.toHaveBeenCalled();
  });

  it("`adminTienda` tampoco entra por aquí, ni siquiera siendo una tienda (R28/R30)", async () => {
    // Contraprueba explícita del caso que más se juega la feature: la tienda tiene su propio
    // detalle en `/mi-wallet`, acotado a su `tienda_id`. Esta pantalla es la de TODAS las
    // tiendas, y el alcance lo fija el ROL, no un dato de la petición.
    resolveActorMock.mockResolvedValue({ usuarioId: "t1", rol: "adminTienda" });
    const { default: WalletTiendasPage } = await import("@/app/(app)/wallet/tiendas/page");
    await expect(WalletTiendasPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(saldosMock).not.toHaveBeenCalled();
  });

  it("sin sesión tampoco ve los saldos (notFound), sin pre-fetch", async () => {
    resolveActorMock.mockResolvedValue(null);
    const { default: WalletTiendasPage } = await import("@/app/(app)/wallet/tiendas/page");
    await expect(WalletTiendasPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(saldosMock).not.toHaveBeenCalled();
  });

  it("si la action responde forbidden, no renderiza la tabla (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    saldosMock.mockResolvedValue({ status: "forbidden" });
    const { default: WalletTiendasPage } = await import("@/app/(app)/wallet/tiendas/page");
    await expect(WalletTiendasPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(tableCalls).toHaveLength(0);
  });
});

describe("WalletTiendasPage — pre-fetch del acceso total (R6/R30)", () => {
  it.each<RolValue>(["maestro", "admin"])(
    "%s ve la tabla de saldos montada, con una sola lectura server-side",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u", rol });
      const { default: WalletTiendasPage } = await import(
        "@/app/(app)/wallet/tiendas/page"
      );

      render(await WalletTiendasPage());

      expect(
        screen.getByRole("heading", { level: 1, name: "Saldos por tienda" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("saldos-tiendas-table-stub")).toBeInTheDocument();
      expect(saldosMock).toHaveBeenCalledTimes(1);
    },
  );

  it("los saldos cruzan por props ya serializados como STRING, sin Decimal (R6)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletTiendasPage } = await import("@/app/(app)/wallet/tiendas/page");

    render(await WalletTiendasPage());

    expect(tableCalls).toHaveLength(1);
    const props = tableCalls[0];
    // Feature 170 — FASE 2 (T I.2): la prop es la PÁGINA (`items` + `total`), no el array.
    expect(props.initialData.items).toHaveLength(2);
    expect(props.initialData.total).toBe(2);
    expect(typeof props.initialData.items[0].saldo).toBe("string");
    expect(props.initialData.items[0].saldo).toBe("9000.00");
    expect(props.initialData.items[0].tiendaNombre).toBe("Tienda Norte");
    // Un saldo NEGATIVO (la tienda le debe a Ordenex) viaja con su signo y sin parsear.
    expect(props.initialData.items[1].saldo).toBe("-452.00");
    expect(props.initialData.items[1].signo).toBe("negativo");
  });

  it("R32: montar la página no dispara NINGUNA lectura de desglose, haya las tiendas que haya", async () => {
    // El desglose se carga al DESPLEGAR una fila, no al listar. Si esta afirmación cayera,
    // abrir la pantalla costaría una consulta por tienda antes de que nadie pida nada.
    resolveActorMock.mockResolvedValue({ usuarioId: "m", rol: "maestro" });
    const { default: WalletTiendasPage } = await import("@/app/(app)/wallet/tiendas/page");

    render(await WalletTiendasPage());

    expect(desgloseMock).not.toHaveBeenCalled();
  });
});
