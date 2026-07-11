// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, act } from "react";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { ZonaDTO } from "@/lib/types/zona";

// Actions mockeadas (no se toca el backend real).
const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
const listarProvinciasMock = vi.fn();
const listarCantonesMock = vi.fn();
const listarDistritosMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
  listarProvincias: (...a: unknown[]) => listarProvinciasMock(...a),
  listarCantones: (...a: unknown[]) => listarCantonesMock(...a),
  listarDistritos: (...a: unknown[]) => listarDistritosMock(...a),
}));

import {
  ZonaForm,
  type ZonaFormHandle,
} from "@/app/(app)/configuracion/_components/ZonaForm";

const PROVINCIAS = [{ id: "p1", nombre: "San José" }];
const CANTONES = [{ id: "c1", nombre: "Central" }];
const DISTRITOS = [
  { id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null },
  { id: "d2", nombre: "Merced", zonaId: null, zonaNombre: null },
  { id: "d3", nombre: "Hospital", zonaId: "zx", zonaNombre: "Otra Zona" },
];

function renderIsolated(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

async function navegarHastaDistritos(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(listarProvinciasMock).toHaveBeenCalled());
  await user.click(screen.getByRole("combobox", { name: "Provincia" }));
  await user.click(
    within(await screen.findByRole("listbox")).getByRole("option", {
      name: "San José",
    }),
  );
  await waitFor(() => expect(listarCantonesMock).toHaveBeenCalled());
  await user.click(screen.getByRole("combobox", { name: "Cantón" }));
  await user.click(
    within(await screen.findByRole("listbox")).getByRole("option", {
      name: "Central",
    }),
  );
  await waitFor(() => expect(listarDistritosMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  listarProvinciasMock.mockResolvedValue({ status: "ok", items: PROVINCIAS });
  listarCantonesMock.mockResolvedValue({ status: "ok", items: CANTONES });
  listarDistritosMock.mockResolvedValue({ status: "ok", items: DISTRITOS });
});

afterEach(() => {
  cleanup();
});

describe("ZonaForm — navegación del catálogo y selección de distritos (R31)", () => {
  it("navega provincia→cantón→distrito y marca/desmarca distritos", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({
      status: "ok",
      zona: { id: "z1" },
    });

    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await navegarHastaDistritos(user);

    // Aparecen los distritos del cantón; el asignado a otra zona está deshabilitado.
    expect(await screen.findByLabelText("Carmen")).toBeInTheDocument();
    expect(screen.getByLabelText("Hospital")).toBeDisabled();
    expect(screen.getByText(/asignado a Otra Zona/)).toBeInTheDocument();

    // Marca dos distritos libres.
    await user.click(screen.getByLabelText("Carmen"));
    await user.click(screen.getByLabelText("Merced"));
    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 2",
    );

    // Desmarca uno.
    await user.click(screen.getByLabelText("Merced"));
    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 1",
    );

    // Completa nombre y envía: el payload lleva el distrito marcado.
    await user.type(screen.getByLabelText("Nombre"), "Zona Nueva");
    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearZonaMock).toHaveBeenCalledTimes(1);
    const enviado = crearZonaMock.mock.calls[0][0] as {
      nombre: string;
      distritoIds: string[];
      esGam: boolean;
    };
    expect(enviado.nombre).toBe("Zona Nueva");
    expect(enviado.distritoIds).toEqual(["d1"]);
    expect(enviado.esGam).toBe(false);
  }, 20000);

  it("el toggle esGam viaja en el payload (R31)", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z1" } });

    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await navegarHastaDistritos(user);
    await user.click(screen.getByLabelText("Carmen"));
    await user.type(screen.getByLabelText("Nombre"), "GAM");
    await user.click(
      screen.getByRole("switch", { name: "Marcar como zona central / GAM" }),
    );

    await act(async () => {
      await ref.current!.submit();
    });

    const enviado = crearZonaMock.mock.calls[0][0] as { esGam: boolean };
    expect(enviado.esGam).toBe(true);
  }, 20000);
});

describe("ZonaForm — validación cliente sin distritos (R31)", () => {
  it("crear sin distritos devuelve validation_error sin llamar a la acción", async () => {
    const user = userEvent.setup();
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Zona Vacía");

    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });

    expect(result.status).toBe("validation_error");
    expect(crearZonaMock).not.toHaveBeenCalled();
  });
});

describe("ZonaForm — errores y conflictos junto a los campos (R33)", () => {
  it("conflicto de nombre se muestra bajo el campo nombre sin perder valores", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "conflict", reason: "nombre" });

    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await navegarHastaDistritos(user);
    await user.click(screen.getByLabelText("Carmen"));
    await user.type(screen.getByLabelText("Nombre"), "Zona Repetida");

    await act(async () => {
      await ref.current!.submit();
    });

    expect(screen.getByText(/Ya existe una zona con ese nombre/)).toBeInTheDocument();
    // Los valores ingresados se conservan.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona Repetida");
    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 1",
    );
  }, 20000);

  it("conflicto de distrito ya asignado se muestra junto al selector (R33)", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({
      status: "conflict",
      reason: "distrito",
      distritoIds: ["d1"],
    });

    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await navegarHastaDistritos(user);
    await user.click(screen.getByLabelText("Carmen"));
    await user.type(screen.getByLabelText("Nombre"), "Zona X");

    await act(async () => {
      await ref.current!.submit();
    });

    // El mensaje referencia el nombre del distrito en conflicto.
    const err = screen.getByText(/ya pertenecen a otra zona/i);
    expect(err).toBeInTheDocument();
    expect(err).toHaveTextContent("Carmen");
    // No se pierde la selección ni el nombre.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona X");
  }, 20000);

  it("validation_error del backend se muestra bajo pagoEntrega (R33)", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { pagoEntrega: ["Debe ser mayor o igual a 0"] },
    });

    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await navegarHastaDistritos(user);
    await user.click(screen.getByLabelText("Carmen"));
    await user.type(screen.getByLabelText("Nombre"), "Zona Y");

    await act(async () => {
      await ref.current!.submit();
    });

    expect(screen.getByText(/mayor o igual a 0/)).toBeInTheDocument();
  }, 20000);
});

describe("ZonaForm — edición (R31)", () => {
  it("prefila nombre/pagos/esGam desde la zona", () => {
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      pagoEntrega: 1200,
      pagoRechazo: 600,
      esGam: true,
      distritosCount: 3,
    };
    renderIsolated(<ZonaForm mode="editar" zona={zona} />);

    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona Sur");
    expect(screen.getByLabelText("Pago por entrega")).toHaveValue(1200);
    expect(
      screen.getByRole("switch", { name: "Marcar como zona central / GAM" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("editar sin tocar el selector NO envía distritoIds (R22)", async () => {
    const user = userEvent.setup();
    actualizarZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z1" } });
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      pagoEntrega: 1200,
      pagoRechazo: 600,
      esGam: false,
      distritosCount: 3,
    };
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="editar" zona={zona} />);

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Zona Sur 2");

    await act(async () => {
      await ref.current!.submit();
    });

    expect(actualizarZonaMock).toHaveBeenCalledTimes(1);
    const enviado = actualizarZonaMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado.id).toBe("z1");
    expect(enviado).not.toHaveProperty("distritoIds");
  }, 20000);
});
