// @vitest-environment jsdom
// FICHA 373/R35 — LA PAGINACIÓN DESPUÉS DEL BORRADO, sobre `ApiKeysModule`.
//
// El caso: se está viendo la página 2, que tiene UNA sola fila, y esa fila se elimina. Quedarse
// ahí deja una tabla vacía con una paginación que dice que hay datos —el usuario cree que se
// borró todo—. La regla vive en el MÓDULO y no en la celda: la celda no conoce la paginación.
//
// Se ejercita el módulo REAL con SWR real; lo mockeado es el borde (Server Actions) y el toast.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

const listarApiKeysMock = vi.fn();
const eliminarApiKeyMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  listarApiKeys: (...a: unknown[]) => listarApiKeysMock(...a),
  listarApiKeysCompleto: vi.fn(),
  generarApiKey: vi.fn(),
  rotarApiKey: vi.fn(),
  activarApiKey: vi.fn(),
  desactivarApiKey: vi.fn(),
  eliminarApiKey: (...a: unknown[]) => eliminarApiKeyMock(...a),
}));

vi.mock("@/lib/actions/webhooks", () => ({
  obtenerWebhook: vi.fn().mockResolvedValue({ status: "ok", webhook: null }),
  registrarWebhook: vi.fn(),
  desactivarWebhook: vi.fn(),
  rotarSecretoWebhook: vi.fn(),
}));

vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: vi.fn().mockResolvedValue({ status: "ok", usuarios: [] }),
  listarUsuariosPorRol: vi.fn(),
}));

import { ApiKeysModule } from "@/app/(app)/configuracion/api/_components/ApiKeysModule";

/** Fila ELIMINABLE (desactivada y sin rastro): es el único estado desde el que se borra. */
function fila(n: number): ApiKeyListItemDTO {
  return {
    id: `k-${n}`,
    identificador: `integracion-${n}`,
    keyPrefix: `ordx_ab12cd${n}`,
    estado: "inactiva",
    usuarioId: `u-${n}`,
    usuarioEmail: `apikey+integracion-${n}@apikey.invalid`,
    tiendaDestinoId: null,
    tiendaDestinoNombre: null,
    eliminable: true,
    motivoNoEliminable: null,
    createdAt: new Date("2026-01-01T12:00:00Z"),
  };
}

const PAGE_SIZE = 10;
/** 11 keys: la página 2 tiene EXACTAMENTE una fila, que es el caso de R35. */
const TODAS = Array.from({ length: 11 }, (_, i) => fila(i + 1));

function paginaDe(page: number, total = TODAS.length) {
  const items = TODAS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { status: "ok", items, page, pageSize: PAGE_SIZE, total };
}

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Va a la página 2 y espera a que su única fila esté pintada. */
async function irAPagina2(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Página siguiente" }));
  await screen.findByText("integracion-11");
}

/** Abre la confirmación de la fila y confirma el borrado. */
async function eliminarFila(
  user: ReturnType<typeof userEvent.setup>,
  identificador: string,
) {
  await user.click(
    await screen.findByRole("button", {
      name: `Eliminar la API key ${identificador}`,
    }),
  );
  const dialogo = await screen.findByRole("dialog");
  await user.click(within(dialogo).getByRole("button", { name: "Sí, eliminar" }));
}

/** Las páginas que el módulo pidió al servidor, en orden. */
function paginasPedidas(): number[] {
  return listarApiKeysMock.mock.calls.map(
    (args) => (args[0] as { page: number }).page,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarApiKeysMock.mockImplementation(
    async ({ page }: { page: number; pageSize: number }) => paginaDe(page),
  );
  eliminarApiKeyMock.mockResolvedValue({
    status: "ok",
    identificador: "integracion-11",
  });
});

afterEach(() => {
  cleanup();
});

describe("R35 — el borrado que vacía una página que no es la primera", () => {
  it("⭑ borrada la ÚNICA fila de la página 2, el módulo pide la página 1", async () => {
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule
        initialData={{ items: paginaDe(1).items, total: 11, pageSize: PAGE_SIZE }}
      />,
    );

    await irAPagina2(user);
    expect(listarApiKeysMock).toHaveBeenCalledWith({ page: 2, pageSize: PAGE_SIZE });

    // Tras el borrado ya no hay 11 keys sino 10: la página 2 deja de existir.
    listarApiKeysMock.mockImplementation(
      async ({ page }: { page: number; pageSize: number }) =>
        paginaDe(page, TODAS.length - 1),
    );

    await eliminarFila(user, "integracion-11");

    await waitFor(() => expect(eliminarApiKeyMock).toHaveBeenCalledWith({ id: "k-11" }));
    // El módulo vuelve a pedir la página 1 y la pinta: no se queda en una página vacía.
    await waitFor(() =>
      expect(listarApiKeysMock).toHaveBeenCalledWith({ page: 1, pageSize: PAGE_SIZE }),
    );
    expect(await screen.findByText("integracion-1")).toBeInTheDocument();
  });

  it("en la página 1 NO retrocede (no hay página anterior a la que ir)", async () => {
    // Borrar la última fila de la primera página deja el listado vacío, y ése es su estado
    // legítimo: el `emptyState` es la respuesta correcta, no un retroceso a la página 0.
    listarApiKeysMock.mockImplementation(async ({ page }: { page: number }) => ({
      status: "ok",
      items: page === 1 ? [fila(1)] : [],
      page,
      pageSize: PAGE_SIZE,
      total: 1,
    }));
    eliminarApiKeyMock.mockResolvedValue({ status: "ok", identificador: "integracion-1" });
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule initialData={{ items: [fila(1)], total: 1, pageSize: PAGE_SIZE }} />,
    );

    await eliminarFila(user, "integracion-1");

    await waitFor(() => expect(eliminarApiKeyMock).toHaveBeenCalled());
    const paginas = paginasPedidas();
    expect(paginas.every((p) => p >= 1)).toBe(true);
    expect(paginas).not.toContain(0);
  });

  it("con MÁS de una fila en la página 2, se queda donde está", async () => {
    // El retroceso es para la página que se QUEDA VACÍA. Con dos filas sigue habiendo qué ver, y
    // saltar a la 1 sería perder el sitio al usuario sin motivo.
    const doce = [...TODAS, fila(12)];
    listarApiKeysMock.mockImplementation(async ({ page }: { page: number }) => ({
      status: "ok",
      items: doce.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      page,
      pageSize: PAGE_SIZE,
      total: doce.length,
    }));
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule
        initialData={{ items: doce.slice(0, PAGE_SIZE), total: 12, pageSize: PAGE_SIZE }}
      />,
    );

    await irAPagina2(user);
    listarApiKeysMock.mockClear();

    await eliminarFila(user, "integracion-11");

    await waitFor(() => expect(eliminarApiKeyMock).toHaveBeenCalled());
    await waitFor(() => expect(listarApiKeysMock).toHaveBeenCalled());
    const paginas = paginasPedidas();
    expect(paginas).not.toContain(1);
  });

  it("un borrado que FALLA no mueve la página", async () => {
    // El retroceso cuelga del éxito. Con `bloqueada` la fila sigue ahí, y saltar de página
    // escondería justo la fila sobre la que el usuario acaba de recibir un aviso.
    eliminarApiKeyMock.mockResolvedValue({ status: "bloqueada", motivo: "ordenes" });
    const user = userEvent.setup();
    renderModule(
      <ApiKeysModule
        initialData={{ items: paginaDe(1).items, total: 11, pageSize: PAGE_SIZE }}
      />,
    );

    await irAPagina2(user);
    listarApiKeysMock.mockClear();

    await eliminarFila(user, "integracion-11");

    expect(
      (await screen.findAllByText("Tiene órdenes a su nombre. No se puede eliminar."))
        .length,
    ).toBeGreaterThan(0);
    const paginas = paginasPedidas();
    expect(paginas).not.toContain(1);
    expect(await screen.findByText("integracion-11")).toBeInTheDocument();
  });
});
