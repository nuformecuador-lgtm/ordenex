// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// Feature 45 (T12, R22b/R24/R25/R26) — tests del panel CRUD de PLANTILLAS de gasto fijo.
// Las actions se mockean (no se toca el backend real). Verifica: lista concepto/monto STRING/
// estado; "Nueva plantilla" crea; "Editar" actualiza con id; "Desactivar"/"Activar" alternan
// `activa` (nunca borran); la nota deja claro que el egreso lo genera el cron.

const crearMock = vi.fn();
const actualizarMock = vi.fn();
const setActivaMock = vi.fn();
// Feature 170 - FASE 2 (T I.2): el panel pide su PAGINA al servidor (SWR revalida al montar)
// y relee el conjunto completo al descargar. Las dos se programan en `renderPanel`.
const listarPaginaMock = vi.fn();
const listarCompletoMock = vi.fn();
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  crearPlantillaAction: (...a: unknown[]) => crearMock(...a),
  actualizarPlantillaAction: (...a: unknown[]) => actualizarMock(...a),
  setActivaPlantillaAction: (...a: unknown[]) => setActivaMock(...a),
  listarPlantillasPaginadoAction: (...a: unknown[]) => listarPaginaMock(...a),
  listarPlantillasAction: (...a: unknown[]) => listarCompletoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { GastosFijosPlantillasPanel } from "@/app/(app)/wallet/_components/GastosFijosPlantillasPanel";

const ACTIVA: GastoFijoPlantillaDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  concepto: "Alquiler de bodega",
  monto: "300.00",
  activa: true,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const INACTIVA: GastoFijoPlantillaDTO = {
  id: "22222222-2222-2222-2222-222222222222",
  concepto: "Internet",
  monto: "45.00",
  activa: false,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function renderPanel(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/**
 * Feature 170 - FASE 2 (T I.2): monta el panel con su PAGINA y deja las dos lecturas
 * devolviendo el MISMO conjunto, para que la revalidacion de SWR no vacie la tabla.
 */
function montarPanel(plantillas: GastoFijoPlantillaDTO[]) {
  listarPaginaMock.mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(plantillas),
  });
  listarCompletoMock.mockResolvedValue({ status: "ok", plantillas });
  return renderPanel(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <GastosFijosPlantillasPanel initialData={paginaInicial(plantillas)} />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("GastosFijosPlantillasPanel — listado (R26)", () => {
  it("lista concepto, monto STRING y estado; muestra la nota del cron", () => {
    montarPanel([ACTIVA, INACTIVA]);

    expect(screen.getByText("Alquiler de bodega")).toBeInTheDocument();
    expect(screen.getByText("₡300.00")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Internet")).toBeInTheDocument();
    expect(screen.getByText("Inactiva")).toBeInTheDocument();
    // Deja explícito que el egreso lo emite el cron, no este panel.
    expect(screen.getByText(/automáticamente cada mes/i)).toBeInTheDocument();
  });
});

describe("GastosFijosPlantillasPanel — crear (R24)", () => {
  it("Nueva plantilla abre el diálogo y crea con concepto + monto", async () => {
    const user = userEvent.setup();
    crearMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA } });
    montarPanel([]);

    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nueva plantilla de gasto fijo")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Concepto"), "Luz");
    await user.type(within(dialog).getByLabelText("Monto mensual"), "60.00");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).toHaveBeenCalledTimes(1);
    expect(crearMock.mock.calls[0][0]).toEqual({ concepto: "Luz", monto: "60.00" });
    expect(actualizarMock).not.toHaveBeenCalled();
  }, 15000);

  it("no crea si el concepto está vacío o el monto es inválido", async () => {
    const user = userEvent.setup();
    montarPanel([]);

    await user.click(screen.getByRole("button", { name: "Nueva plantilla" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Monto mensual"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(crearMock).not.toHaveBeenCalled();
    expect(within(dialog).getByText("El concepto es obligatorio.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("El monto debe ser un número mayor que 0."),
    ).toBeInTheDocument();
  }, 15000);
});

describe("GastosFijosPlantillasPanel — editar (R25)", () => {
  it("Editar prefila los campos y actualiza con el id de la plantilla", async () => {
    const user = userEvent.setup();
    actualizarMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Editar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar plantilla de gasto fijo")).toBeInTheDocument();
    // Prefill desde la plantilla.
    expect(within(dialog).getByLabelText("Concepto")).toHaveValue("Alquiler de bodega");
    expect(within(dialog).getByLabelText("Monto mensual")).toHaveValue("300.00");

    await user.clear(within(dialog).getByLabelText("Monto mensual"));
    await user.type(within(dialog).getByLabelText("Monto mensual"), "350.00");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(actualizarMock).toHaveBeenCalledTimes(1);
    expect(actualizarMock.mock.calls[0][0]).toEqual({
      id: ACTIVA.id,
      concepto: "Alquiler de bodega",
      monto: "350.00",
    });
  }, 15000);
});

describe("GastosFijosPlantillasPanel — activar/desactivar (R25)", () => {
  it("Desactivar una plantilla activa llama setActiva con activa=false", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...ACTIVA, activa: false } });
    montarPanel([ACTIVA]);

    const fila = screen.getByRole("row", { name: /Alquiler de bodega/ });
    await user.click(within(fila).getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(setActivaMock).toHaveBeenCalledTimes(1));
    expect(setActivaMock.mock.calls[0][0]).toEqual({ id: ACTIVA.id, activa: false });
  }, 15000);

  it("Activar una plantilla inactiva llama setActiva con activa=true", async () => {
    const user = userEvent.setup();
    setActivaMock.mockResolvedValue({ status: "ok", plantilla: { ...INACTIVA, activa: true } });
    montarPanel([INACTIVA]);

    const fila = screen.getByRole("row", { name: /Internet/ });
    await user.click(within(fila).getByRole("button", { name: "Activar" }));

    await waitFor(() => expect(setActivaMock).toHaveBeenCalledTimes(1));
    expect(setActivaMock.mock.calls[0][0]).toEqual({ id: INACTIVA.id, activa: true });
  }, 15000);
});
