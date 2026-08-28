// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

// Se mockean las Server Actions del ciclo de vida; el Modal/Toast reales para
// ejercitar la composición sin DB ni sesión.
const rotarApiKeyMock = vi.fn();
const activarApiKeyMock = vi.fn();
const desactivarApiKeyMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  rotarApiKey: (...a: unknown[]) => rotarApiKeyMock(...a),
  activarApiKey: (...a: unknown[]) => activarApiKeyMock(...a),
  desactivarApiKey: (...a: unknown[]) => desactivarApiKeyMock(...a),
}));

import { ApiKeyAccionCell } from "@/app/(app)/configuracion/api/_components/ApiKeyAccionCell";

const ROW_ACTIVA: ApiKeyListItemDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  identificador: "integracion-erp",
  keyPrefix: "ordx_ab12cd3",
  estado: "activa",
  usuarioId: "u1",
  usuarioEmail: "apikey+integracion-erp@apikey.invalid",
  tiendaDestinoId: null, // feature 302: sin tienda destino (comportamiento historico)
  tiendaDestinoNombre: null,
  createdAt: new Date("2026-01-01T12:00:00Z"),
};

const ROW_INACTIVA: ApiKeyListItemDTO = { ...ROW_ACTIVA, estado: "inactiva" };

// Secreto NUEVO que `rotarApiKey` devuelve UNA sola vez.
const PLAIN_KEY = "ordx_zz99yy8EF456ghIJ789klMN012opQR345stUV678wx";

function apiKeyPublico(estado: "activa" | "inactiva" = "activa") {
  return {
    id: ROW_ACTIVA.id,
    identificador: ROW_ACTIVA.identificador,
    keyPrefix: "ordx_zz99yy8",
    estado,
    usuarioId: "u1",
    createdAt: new Date("2026-02-02T10:00:00Z"),
  };
}

function renderCell(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

let onMutated: ReturnType<typeof vi.fn> & (() => Promise<void>);

beforeEach(() => {
  vi.clearAllMocks();
  onMutated = vi.fn().mockResolvedValue(undefined) as typeof onMutated;
  rotarApiKeyMock.mockResolvedValue({
    status: "ok",
    apiKey: apiKeyPublico(),
    plainKey: PLAIN_KEY,
  });
  activarApiKeyMock.mockResolvedValue({ status: "ok", apiKey: apiKeyPublico("activa") });
  desactivarApiKeyMock.mockResolvedValue({
    status: "ok",
    apiKey: apiKeyPublico("inactiva"),
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Rotar
// ---------------------------------------------------------------------------
describe("ApiKeyAccionCell — rotar", () => {
  it("rotar pide confirmación y, tras ok, refresca el listado y revela el secreto nuevo", async () => {
    const user = userEvent.setup();
    renderCell(<ApiKeyAccionCell row={ROW_ACTIVA} onMutated={onMutated} />);

    await user.click(
      screen.getByRole("button", { name: "Rotar la API key integracion-erp" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/El secreto actual dejará de funcionar/i),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Sí, rotar" }));

    await waitFor(() =>
      expect(rotarApiKeyMock).toHaveBeenCalledWith({ id: ROW_ACTIVA.id }),
    );
    expect(onMutated).toHaveBeenCalled();

    // El secreto nuevo se revela UNA vez en el modal de revelado.
    const secreto = await screen.findByLabelText("Clave de API generada");
    expect(secreto).toHaveValue(PLAIN_KEY);
  });

  it("rotar con error del backend muestra un toast y no revela secreto", async () => {
    rotarApiKeyMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderCell(<ApiKeyAccionCell row={ROW_ACTIVA} onMutated={onMutated} />);

    await user.click(
      screen.getByRole("button", { name: "Rotar la API key integracion-erp" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Sí, rotar",
      }),
    );

    expect(
      (await screen.findAllByText("No tienes permiso para esta acción.")).length,
    ).toBeGreaterThan(0);
    expect(onMutated).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Clave de API generada")).toBeNull();
  });

  it("anti-doble-submit: un segundo click de confirmar no dispara otra rotación", async () => {
    let resolver!: (v: unknown) => void;
    rotarApiKeyMock.mockImplementation(
      () => new Promise((res) => (resolver = res)),
    );
    const user = userEvent.setup();
    renderCell(<ApiKeyAccionCell row={ROW_ACTIVA} onMutated={onMutated} />);

    await user.click(
      screen.getByRole("button", { name: "Rotar la API key integracion-erp" }),
    );
    const confirmar = within(await screen.findByRole("dialog")).getByRole(
      "button",
      { name: "Sí, rotar" },
    );
    await user.click(confirmar);
    await user.click(confirmar);

    expect(rotarApiKeyMock).toHaveBeenCalledTimes(1);
    resolver({ status: "ok", apiKey: apiKeyPublico(), plainKey: PLAIN_KEY });
    await screen.findByLabelText("Clave de API generada");
  });
});

// ---------------------------------------------------------------------------
// Activar / Desactivar según estado
// ---------------------------------------------------------------------------
describe("ApiKeyAccionCell — activar/desactivar", () => {
  it("con estado activa muestra 'Desactivar' y llama desactivarApiKey", async () => {
    const user = userEvent.setup();
    renderCell(<ApiKeyAccionCell row={ROW_ACTIVA} onMutated={onMutated} />);

    await user.click(
      screen.getByRole("button", {
        name: "Desactivar la API key integracion-erp",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Sí, desactivar",
      }),
    );

    await waitFor(() =>
      expect(desactivarApiKeyMock).toHaveBeenCalledWith({ id: ROW_ACTIVA.id }),
    );
    expect(activarApiKeyMock).not.toHaveBeenCalled();
    expect(onMutated).toHaveBeenCalled();
  });

  it("con estado inactiva muestra 'Activar' y llama activarApiKey", async () => {
    const user = userEvent.setup();
    renderCell(<ApiKeyAccionCell row={ROW_INACTIVA} onMutated={onMutated} />);

    await user.click(
      screen.getByRole("button", {
        name: "Activar la API key integracion-erp",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Sí, activar",
      }),
    );

    await waitFor(() =>
      expect(activarApiKeyMock).toHaveBeenCalledWith({ id: ROW_INACTIVA.id }),
    );
    expect(desactivarApiKeyMock).not.toHaveBeenCalled();
    expect(onMutated).toHaveBeenCalled();
  });

  it("cambiar estado con error del backend muestra un toast y no refresca", async () => {
    desactivarApiKeyMock.mockResolvedValue({ status: "not_found" });
    const user = userEvent.setup();
    renderCell(<ApiKeyAccionCell row={ROW_ACTIVA} onMutated={onMutated} />);

    await user.click(
      screen.getByRole("button", {
        name: "Desactivar la API key integracion-erp",
      }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Sí, desactivar",
      }),
    );

    expect(
      (await screen.findAllByText(/Esta API key ya no existe/i)).length,
    ).toBeGreaterThan(0);
    expect(onMutated).not.toHaveBeenCalled();
  });
});
