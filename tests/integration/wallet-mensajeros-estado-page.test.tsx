// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { FORMA_UUID, UUID_MENSAJERO, estado } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.3; R17, R81) — `/wallet/mensajeros/[mensajeroId]` Y EL ENLACE DESDE EL LISTADO.
// Mismo contrato que el de la tienda (`wallet-tiendas-estado-page.test.tsx`). Sustituye, en lo que
// decían del listado, a los casos de «desplegar el desglose» de `CuentasPorPagarTable.test.tsx` y de
// `tests/integration/wallet-mensajeros-page.test.tsx`.
// =================================================================================================

vi.mock("@/lib/auth/resolve-actor", () => ({ resolveActorFromSession: vi.fn() }));
vi.mock("@/lib/actions/estado-cuenta", () => ({ verEstadoCuentaAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarPaginadoAction: vi.fn(async () => ({ status: "ok", items: [], total: 0, page: 1, pageSize: 25 })),
  listarCuentasPorPagarCompletoAction: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const moduloProps: unknown[] = [];
vi.mock("@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero", () => ({
  EstadoCuentaMensajero: (props: unknown) => {
    moduloProps.push(props);
    return <div data-testid="estado-cuenta-mensajero" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { verEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import EstadoCuentaMensajeroPage from "@/app/(app)/wallet/mensajeros/[mensajeroId]/page";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

const actorMock = vi.mocked(resolveActorFromSession);
const verMock = vi.mocked(verEstadoCuentaAction);

function pagina(id = UUID_MENSAJERO) {
  return EstadoCuentaMensajeroPage({ params: Promise.resolve({ mensajeroId: id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  moduloProps.length = 0;
});
afterEach(() => cleanup());

describe("R81 — solo acceso total", () => {
  it.each<RolValue>(["adminTienda", "mensajero", "adminSatelite"])("%s → notFound, sin leer", async (rol) => {
    actorMock.mockResolvedValue({ usuarioId: "u1", rol });
    await expect(pagina()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(verMock).not.toHaveBeenCalled();
  });

  it("un mensajero inexistente o de otro papel → notFound", async () => {
    actorMock.mockResolvedValue({ usuarioId: "u1", rol: "admin" });
    verMock.mockResolvedValue({ status: "no_encontrado" });
    await expect(pagina()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each<RolValue>(["maestro", "admin"])("%s: la página de ESE mensajero, titulada por su nombre", async (rol) => {
    actorMock.mockResolvedValue({ usuarioId: "u1", rol });
    const inicial = estado({ tipo: "mensajero", nombre: "Mario Mensajero" });
    verMock.mockResolvedValue({ status: "ok", estado: inicial });
    render(<ToastProvider>{await pagina()}</ToastProvider>);
    expect(verMock).toHaveBeenCalledWith({ cuenta: { tipo: "mensajero", id: UUID_MENSAJERO } });
    expect(moduloProps).toEqual([{ inicial, puedeRegistrar: true }]);
    expect(screen.getByRole("heading", { name: "Estado de cuenta de Mario Mensajero" })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(FORMA_UUID);
  });
});

describe("R17 / D14 — el listado enlaza y ya no despliega", () => {
  it("«Ver estado de cuenta de Mario Mensajero» lleva el id solo en el href", () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <CuentasPorPagarTable
            initialData={paginaInicial([
              {
                mensajeroId: UUID_MENSAJERO,
                mensajeroNombre: "Mario Mensajero",
                devengado: "5000.00",
                pagado: "0.00",
                cuentaPorPagar: "5000.00",
                signo: "positivo",
              },
            ])}
          />
        </ToastProvider>
      </SWRConfig>,
    );
    const enlace = screen.getByRole("link", { name: "Ver estado de cuenta de Mario Mensajero" });
    expect(enlace.getAttribute("href")).toBe(`/wallet/mensajeros/${UUID_MENSAJERO}`);
    expect(screen.queryByRole("button", { name: /Ver desglose/ })).toBeNull();
    const tabla = screen.getByRole("table");
    expect(within(tabla).getByText("Mario Mensajero")).toBeTruthy();
    expect(tabla.textContent ?? "").not.toMatch(FORMA_UUID);
  });
});
