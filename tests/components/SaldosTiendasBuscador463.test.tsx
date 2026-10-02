// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

// FICHA 463 (T9, R45) — `/wallet/tiendas` gana el buscador CANÓNICO por nombre de tienda, resuelto en el
// SERVIDOR: el término viaja a la lectura paginada, vuelve a la página 1, entra en la clave de caché y
// viaja también a la descarga. Molde: `/wallet/mensajeros`.

const H = vi.hoisted(() => ({ pagina: vi.fn(), completo: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => H.pagina(...a),
  listarSaldosTiendasCompletoAction: (...a: unknown[]) => H.completo(...a),
  listarSaldosTiendasAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { claveSaldosTiendas, esClaveSaldosTiendas } from "@/app/(app)/wallet/tiendas/_components/saldos-tiendas-clave";

function tienda(n: number, nombre: string): SaldoTiendaResumenDTO {
  return { tiendaId: `t-${n}`, tiendaNombre: nombre, saldo: `${n}000.00`, signo: "positivo" };
}

const PAGINA = Array.from({ length: 10 }, (_, i) => tienda(i + 1, `Tienda ${i + 1}`));

function montar() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <SaldosTiendasTable initialData={{ items: PAGINA, total: 35, pageSize: 10 }} />
      </ToastProvider>
    </SWRConfig>,
  );
  return userEvent.setup();
}

const buscador = () => screen.getByRole("searchbox", { name: "Buscar por tienda" });
const paginacion = () => screen.getByRole("navigation", { name: "Paginación de los saldos por tienda" });

beforeEach(() => {
  vi.clearAllMocks();
  H.pagina.mockImplementation(async (input: { page: number; busqueda?: string }) => ({
    status: "ok",
    items: input.busqueda ? [tienda(77, "Tania Tienda")] : PAGINA,
    total: input.busqueda ? 1 : 35,
    page: input.page,
    pageSize: 10,
  }));
  H.completo.mockResolvedValue({ status: "ok", items: [tienda(77, "Tania Tienda")], total: 1 });
});
afterEach(() => cleanup());

describe("463 R45 — el buscador de `/wallet/tiendas`", () => {
  it("es el canónico, con su placeholder, en la cabecera de la tabla; al entrar no lee nada", () => {
    montar();
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por nombre de la tienda");
    expect(H.pagina).not.toHaveBeenCalled();
  });

  it("el término se busca en el SERVIDOR y vuelve a la página 1", async () => {
    const user = montar();
    await user.click(within(paginacion()).getByRole("button", { name: /siguiente/i }));
    await waitFor(() => expect(H.pagina).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 }));

    await user.type(buscador(), "tania");
    await waitFor(() => expect(H.pagina).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, busqueda: "tania" }), {
      timeout: 3000,
    });
    await waitFor(() => expect(screen.getByText("Tania Tienda")).toBeInTheDocument());
  });

  it("la descarga lleva el término aplicado (y sin término, la llamada de siempre)", async () => {
    const user = montar();
    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));
    await waitFor(() => expect(H.completo).toHaveBeenCalledTimes(1));
    expect(H.completo.mock.calls[0]).toEqual([]);

    await user.type(buscador(), "tania");
    await waitFor(() => expect(H.pagina).toHaveBeenLastCalledWith(expect.objectContaining({ busqueda: "tania" })), {
      timeout: 3000,
    });
    await user.click(screen.getByRole("button", { name: "Descargar Saldos de tiendas" }));
    await waitFor(() => expect(H.completo).toHaveBeenCalledTimes(2));
    expect(H.completo).toHaveBeenLastCalledWith({ busqueda: "tania" });
  });

  it("el término va en la clave de caché; el refresco por predicado la sigue alcanzando", () => {
    const sin = claveSaldosTiendas(1, 10);
    const con = claveSaldosTiendas(1, 10, "tania");
    expect(JSON.stringify(sin)).not.toBe(JSON.stringify(con));
    expect(esClaveSaldosTiendas(sin)).toBe(true);
    expect(esClaveSaldosTiendas(con)).toBe(true);
  });
});
