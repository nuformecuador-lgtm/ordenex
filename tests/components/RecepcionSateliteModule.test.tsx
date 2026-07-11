// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 33 (T12) — módulo de la bodega satélite. Se mockean la Server Action de
// recepción, el toast, el router (refresh) y la lib de cámara (sin hardware en CI).
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
}));

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

// La cámara nunca se abre en estos tests; el mock evita cargar el módulo real.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_ruta_bodega_satelite",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...over,
  };
}

function renderModule(
  props?: Partial<Parameters<typeof RecepcionSateliteModule>[0]>,
) {
  render(
    <RecepcionSateliteModule
      porRecibir={props?.porRecibir ?? []}
      recibidas={props?.recibidas ?? []}
      zonaNombre={props?.zonaNombre ?? "Limón"}
      sinZona={props?.sinZona ?? false}
      mensajeros={props?.mensajeros ?? [{ id: "m1", nombre: "Ana Mensajera" }]}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RecepcionSateliteModule", () => {
  it("R6/R8: muestra DOS secciones separadas 'Por recibir' y 'Recibidas'", () => {
    renderModule({
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    expect(
      screen.getByRole("region", { name: "Por recibir" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recibidas" })).toBeInTheDocument();
  });

  it("R7: la sección 'Por recibir' NO expone acción de asignar/gestionar", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recibir" });
    // La única acción del módulo es la recepción por escaneo (fuera de esta región).
    expect(within(region).queryByRole("button")).toBeNull();
    expect(
      within(region).queryByRole("button", { name: /asignar|gestionar/i }),
    ).toBeNull();
  });

  it("R9: 'Recibidas' renderiza el estado legible 'En bodega satélite de <zona>'", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
          zonaNombre: "Limón",
        }),
      ],
      zonaNombre: "Limón",
    });

    const region = screen.getByRole("region", { name: "Recibidas" });
    expect(
      within(region).getByText("En bodega satélite de Limón"),
    ).toBeInTheDocument();
  });

  it("R8: 'Recibidas' lista las órdenes en_bodega_satelite de la zona", () => {
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-RECIBIDA",
          destinatario: "Beto Ruiz",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "Recibidas" });
    // El texto aparece tanto en el título de la card como en el detalle.
    expect(within(region).getAllByText(/REM-RECIBIDA/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Beto Ruiz/).length).toBeGreaterThan(0);
  });

  it("R5: si sinZona, muestra aviso accionable y NO ofrece el escáner", () => {
    renderModule({ sinZona: true, zonaNombre: null });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no tienes una zona asignada/i,
    );
    // Sin zona → sin recepción posible: no se monta el input de escaneo.
    expect(
      screen.queryByRole("textbox", { name: "Código de la orden" }),
    ).toBeNull();
  });

  it("R10: con zona, ofrece el escáner (input de recepción) como única acción", () => {
    renderModule({ sinZona: false });

    expect(
      screen.getByRole("region", { name: "Recepción por escaneo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Código de la orden" }),
    ).toBeInTheDocument();
  });

  // ---------- Feature 34 (T8) ----------

  it("R4 (34): 'Recibidas' permite seleccionar órdenes y habilita 'Asignar'", async () => {
    const user = userEvent.setup();
    renderModule({
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "Recibidas" });
    const asignar = within(region).getByRole("button", { name: "Asignar" });
    // Sin selección, la acción está deshabilitada.
    expect(asignar).toBeDisabled();

    const checkbox = within(region).getByRole("checkbox", {
      name: "Seleccionar REM-B1",
    });
    await user.click(checkbox);

    expect(asignar).toBeEnabled();
  });

  it("R7 (33, no regresión): 'Por recibir' NO ofrece seleccionar ni asignar", () => {
    renderModule({
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
      recibidas: [
        makeOrden({
          id: "b1",
          numRemision: "REM-B1",
          estatusValue: "en_bodega_satelite",
        }),
      ],
    });

    const porRecibir = screen.getByRole("region", { name: "Por recibir" });
    // Ni checkbox de selección ni botón de asignar en "Por recibir".
    expect(within(porRecibir).queryByRole("checkbox")).toBeNull();
    expect(
      within(porRecibir).queryByRole("button", { name: /asignar/i }),
    ).toBeNull();
  });
});
