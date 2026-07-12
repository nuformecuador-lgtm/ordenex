// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, act } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { ZonaDTO } from "@/lib/types/zona";

// Actions mockeadas (no se toca el backend real). El ZonaForm está stubbeado en
// esta reconciliación (feature 54): sólo referencia crearZona/actualizarZona.
const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
}));

import {
  ZonaForm,
  type ZonaFormHandle,
} from "@/app/(app)/configuracion/_components/ZonaForm";

function renderIsolated(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("ZonaForm — campo nombre (crear)", () => {
  it("renderiza el campo Nombre editable y no expone campos de pago/central", async () => {
    const user = userEvent.setup();
    renderIsolated(<ZonaForm mode="crear" />);

    const nombre = screen.getByLabelText("Nombre");
    expect(nombre).toBeInTheDocument();
    await user.type(nombre, "Zona Nueva");
    expect(nombre).toHaveValue("Zona Nueva");

    // El modelo nuevo movió los pagos a tarifa_zona_mensajero; el stub no los tiene.
    expect(screen.queryByLabelText("Pago por entrega")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Pago por rechazo")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Central/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ZonaForm — submit stub (feature 54)", () => {
  it("submit devuelve validation_error sin invocar las acciones", async () => {
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });

    expect(result.status).toBe("validation_error");
    expect(crearZonaMock).not.toHaveBeenCalled();
    expect(actualizarZonaMock).not.toHaveBeenCalled();
  });

  it("tras submit muestra el mensaje de reconstrucción bajo el campo Nombre", async () => {
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await act(async () => {
      await ref.current!.submit();
    });

    expect(
      screen.getByText(/Formulario de zonas en reconstrucción/i),
    ).toBeInTheDocument();
  });
});

describe("ZonaForm — edición (prefill)", () => {
  it("prefila el nombre desde la zona en edición", () => {
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      cobroVehiculo: false,
      distritosCount: 3,
      esCentral: true,
    };
    renderIsolated(<ZonaForm mode="editar" zona={zona} />);

    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona Sur");
  });
});
