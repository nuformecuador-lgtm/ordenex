// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { FORMA_UUID, UUID_TIENDA, estado } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.2; R17, R81) — `/wallet/tiendas/[tiendaId]` Y EL ENLACE DESDE EL LISTADO.
//
//  - R81: solo acceso total (maestro, admin). Cualquier otro rol o sin sesión → «no encontrado» SIN
//    leer el estado de cuenta; una cuenta inexistente, de otro papel o un segmento sin forma de id →
//    «no encontrado» igual.
//  - La página baja la primera página del servidor por props y se titula con el NOMBRE (H6/D1).
//  - R17 (y D14): la fila del listado ENLAZA al estado de cuenta y ya NO despliega el desglose.
// Sustituye a `tests/integration/wallet-tiendas-desglose.test.tsx` y `wallet-tiendas-pago.test.tsx`
// en lo que decían del listado (rol, props, desplegar).
// =================================================================================================

vi.mock("@/lib/auth/resolve-actor", () => ({ resolveActorFromSession: vi.fn() }));
vi.mock("@/lib/actions/estado-cuenta", () => ({ verEstadoCuentaAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasPaginadoAction: vi.fn(),
  listarSaldosTiendasCompletoAction: vi.fn(),
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
vi.mock("@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda", () => ({
  EstadoCuentaTienda: (props: unknown) => {
    moduloProps.push(props);
    return <div data-testid="estado-cuenta-tienda" />;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { verEstadoCuentaAction } from "@/lib/actions/estado-cuenta";
import { listarSaldosTiendasPaginadoAction } from "@/lib/actions/wallet-tienda";
import EstadoCuentaTiendaPage from "@/app/(app)/wallet/tiendas/[tiendaId]/page";
import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";

const actorMock = vi.mocked(resolveActorFromSession);
const verMock = vi.mocked(verEstadoCuentaAction);
const saldosMock = vi.mocked(listarSaldosTiendasPaginadoAction);

function pagina(id = UUID_TIENDA) {
  return EstadoCuentaTiendaPage({ params: Promise.resolve({ tiendaId: id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  moduloProps.length = 0;
  verMock.mockResolvedValue({ status: "ok", estado: estado() });
});
afterEach(() => cleanup());

describe("R81 — solo acceso total; los demás, «no encontrado» sin leer nada", () => {
  it.each<RolValue>(["adminTienda", "mensajero", "adminSatelite", "apiKey"])("%s → notFound, sin leer", async (rol) => {
    actorMock.mockResolvedValue({ usuarioId: "u1", rol });
    await expect(pagina()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(verMock).not.toHaveBeenCalled();
  });

  it("sin sesión → notFound, sin leer", async () => {
    actorMock.mockResolvedValue(null);
    await expect(pagina()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(verMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no_encontrado", { status: "no_encontrado" as const }],
    ["validation_error (segmento sin forma de id)", { status: "validation_error" as const, fieldErrors: {} }],
    ["forbidden", { status: "forbidden" as const }],
  ])("la acción responde %s → notFound", async (_caso, r) => {
    actorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    verMock.mockResolvedValue(r);
    await expect(pagina("no-es-un-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("maestro y admin: la página con el estado de cuenta de ESA tienda", () => {
  it.each<RolValue>(["maestro", "admin"])("%s: lee SOLO esa cuenta y baja la primera página por props", async (rol) => {
    actorMock.mockResolvedValue({ usuarioId: "u1", rol });
    const inicial = estado({ nombre: "Tania Tienda" });
    verMock.mockResolvedValue({ status: "ok", estado: inicial });
    render(<ToastProvider>{await pagina()}</ToastProvider>);
    expect(verMock).toHaveBeenCalledWith({ cuenta: { tipo: "tienda", id: UUID_TIENDA } });
    expect(moduloProps).toEqual([{ inicial, puedeRegistrar: true }]);
    expect(screen.getByRole("heading", { name: "Estado de cuenta de Tania Tienda" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver a los saldos por tienda" }).getAttribute("href")).toBe("/wallet/tiendas");
    expect(document.body.textContent ?? "").not.toMatch(FORMA_UUID);
  });
});

describe("R17 / D14 — el listado enlaza al estado de cuenta y ya no despliega", () => {
  it("cada fila lleva «Ver estado de cuenta» con el id SOLO en el href; ningún «Ver desglose»", () => {
    saldosMock.mockResolvedValue({ status: "ok", page: 1, ...paginaInicial([]) } as never);
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <SaldosTiendasTable
            initialData={paginaInicial([
              { tiendaId: UUID_TIENDA, tiendaNombre: "Tania Tienda", saldo: "-2500.00", signo: "negativo" },
            ])}
          />
        </ToastProvider>
      </SWRConfig>,
    );
    const tabla = screen.getByRole("table", { name: "Saldos de tiendas" });
    const enlace = within(tabla).getByRole("link", { name: "Ver estado de cuenta de Tania Tienda" });
    expect(enlace.getAttribute("href")).toBe(`/wallet/tiendas/${UUID_TIENDA}`);
    expect(enlace.textContent).toBe("Ver estado de cuenta");
    expect(within(tabla).queryByRole("button", { name: /Ver desglose/ })).toBeNull();
    expect(tabla.textContent ?? "").not.toMatch(FORMA_UUID);
  });
});
