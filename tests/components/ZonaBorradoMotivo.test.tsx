// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

/**
 * ⭑ FICHA 376 / T12 — R24: EL BORRADO RECHAZADO DICE CUÁL DE LOS DOS RECHAZOS FUE.
 *
 * Hasta esta ficha, `ZonasTarifasModule` pintaba «No se puede eliminar: la zona está en uso.»
 * para CUALQUIER `conflict`. Con la guarda de R10 esa frase pasó a ser falsa en un caso: la zona
 * central se rechaza aunque no tenga ni una orden ni un usuario apuntando. Y los dos rechazos
 * piden salidas OPUESTAS —vaciar la zona frente a marcar otra como central—, así que decirlos con
 * la misma palabra obliga a quien lo lee a adivinar.
 *
 * Los dos textos se afirman como LITERALES, y el caso de `en_uso` está aquí a propósito: sin él,
 * cambiar el mensaje de la central podría llevarse por delante el que ya funcionaba.
 */

const borrarZonaMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: vi.fn().mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
  }),
  obtenerZona: vi.fn(),
  borrarZona: (...a: unknown[]) => borrarZonaMock(...a),
  crearZona: vi.fn(),
  actualizarZona: vi.fn(),
  impactoZonaCentral: vi.fn().mockResolvedValue({ status: "ok", impacto: [] }),
}));

vi.mock("@/lib/actions/tarifas", () => ({
  listarTarifas: vi.fn().mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 100,
    total: 0,
  }),
  borrarTarifa: vi.fn(),
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: vi.fn().mockResolvedValue({ status: "ok", usuarios: [] }),
  listarUsuariosPorRol: vi.fn().mockResolvedValue({ status: "ok", usuarios: [] }),
}));

vi.mock("@/lib/actions/geografia", () => ({
  listarArbolGeografico: vi.fn().mockResolvedValue({ status: "ok", provincias: [] }),
  actualizarDistritosEspeciales: vi.fn(),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const { ZonasTarifasModule } = await import(
  "@/app/(app)/configuracion/tarifas/_components/ZonasTarifasModule"
);

const TEXTO_CENTRAL =
  "No se puede eliminar la zona central. Marca otra zona como central antes de eliminarla.";
const TEXTO_EN_USO = "No se puede eliminar: la zona está en uso.";

function provincias(): ProvinciaArbolDTO[] {
  return [];
}

function renderModulo() {
  return render(
    <ZonasTarifasModule
      initialZonas={[
        {
          id: "z-gam",
          nombre: "GAM",
          cobroVehiculo: false,
          distritosCount: 3,
          esCentral: true,
        },
      ]}
      provincias={provincias()}
      vehiculos={[]}
    />,
  );
}

/** Abre el modal de borrado de la zona GAM y pulsa Aceptar. */
async function intentarBorrar(user: ReturnType<typeof userEvent.setup>) {
  const fila = screen.getByText("GAM").closest("li");
  expect(fila).not.toBeNull();
  await user.click(within(fila as HTMLElement).getByRole("button", { name: "Eliminar" }));
  await screen.findByText("Eliminar zona");
  await user.click(screen.getByRole("button", { name: "Aceptar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("R24 — el rechazo por zona central tiene texto propio", () => {
  it("motivo `es_central` dice que hay que marcar otra zona, no que esté en uso", async () => {
    borrarZonaMock.mockResolvedValue({ status: "conflict", motivo: "es_central" });
    const user = userEvent.setup();
    renderModulo();

    await intentarBorrar(user);

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(TEXTO_CENTRAL));
    expect(errorMock).not.toHaveBeenCalledWith(TEXTO_EN_USO);
    expect(successMock).not.toHaveBeenCalled();
  });

  it("motivo `en_uso` conserva EXACTAMENTE el texto de antes de esta ficha", async () => {
    borrarZonaMock.mockResolvedValue({ status: "conflict", motivo: "en_uso" });
    const user = userEvent.setup();
    renderModulo();

    await intentarBorrar(user);

    await waitFor(() => expect(errorMock).toHaveBeenCalledWith(TEXTO_EN_USO));
    expect(errorMock).not.toHaveBeenCalledWith(TEXTO_CENTRAL);
  });

  it("un rechazo que no es `conflict` sigue con el mensaje genérico", async () => {
    borrarZonaMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderModulo();

    await intentarBorrar(user);

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("No se pudo eliminar la zona."),
    );
  });

  it("un borrado que sí funciona no pinta ningún rechazo", async () => {
    borrarZonaMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    renderModulo();

    await intentarBorrar(user);

    await waitFor(() => expect(successMock).toHaveBeenCalledWith("Zona eliminada"));
    expect(errorMock).not.toHaveBeenCalled();
  });
});
