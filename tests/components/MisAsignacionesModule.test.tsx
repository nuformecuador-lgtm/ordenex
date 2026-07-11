// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MisAsignacionesModule } from "@/app/(app)/mis-asignaciones/_components/MisAsignacionesModule";
import {
  recogerAsignaciones,
  escogerParaGestion,
  gestionar,
} from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 36 (T15-T17) — módulo del mensajero. Se mockean las Server Actions
// (recoger / escoger / gestionar), el toast y el router (refresh) para afirmar la
// composición y los envíos sin DB ni sesión.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const recogerMock = vi.mocked(recogerAsignaciones);
const escogerMock = vi.mocked(escogerParaGestion);
const gestionarMock = vi.mocked(gestionar);

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_espera_aceptacion",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    ...over,
  };
}

function renderModule(props?: Partial<Parameters<typeof MisAsignacionesModule>[0]>) {
  render(
    <MisAsignacionesModule
      porRecoger={props?.porRecoger ?? []}
      porGestionar={props?.porGestionar ?? []}
      ordenEnGestionId={props?.ordenEnGestionId ?? null}
    />,
  );
}

/** Sube un File válido (image/jpeg, size>0) al input de evidencia dado. */
async function subirEvidencia(user: ReturnType<typeof userEvent.setup>, label: string) {
  const file = new File(["evidencia-bytes"], "evidencia.jpg", {
    type: "image/jpeg",
  });
  await user.upload(screen.getByLabelText(label), file);
  return file;
}

/** Selecciona una opción en un Select de base-ui por su nombre accesible. */
async function elegirEnSelect(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: comboboxName }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: optionName }));
}

beforeEach(() => {
  vi.clearAllMocks();
  escogerMock.mockResolvedValue({ status: "ok", ordenId: "g1" });
  gestionarMock.mockResolvedValue({
    status: "ok",
    ordenId: "g1",
    estado: "entregada",
  });
  recogerMock.mockResolvedValue({ status: "ok", recogidas: ["r1"] });
});

afterEach(() => {
  cleanup();
});

describe("MisAsignacionesModule", () => {
  it("R10: muestra DOS apartados separados 'Por recoger' y 'En reparto / por gestionar'", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-R1" })],
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getByRole("region", { name: "Por recoger" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();
  });

  it("R11: muestra el detalle completo de la orden (guía, dirección, monto, ubicación, notas...)", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numGuia: 2002,
          numRemision: "REM-DETALLE",
          destinatario: "Beto Ruiz",
          telefonoDest: "70001111",
          direccion: "Av. Central 100",
          producto: "Sobre",
          montoCobrar: 1250.5,
          notas: "Llamar antes",
          tiendaNombre: "Tienda Norte",
          zonaNombre: "Cartago",
          provinciaNombre: "Cartago",
          cantonNombre: "Oreamuno",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recoger" });
    expect(within(region).getByText("2002")).toBeInTheDocument();
    expect(within(region).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(region).getByText("70001111")).toBeInTheDocument();
    expect(within(region).getByText("Av. Central 100")).toBeInTheDocument();
    expect(within(region).getByText("Sobre")).toBeInTheDocument();
    expect(within(region).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(region).getByText("Llamar antes")).toBeInTheDocument();
    // Monto formateado en colones.
    expect(within(region).getByText("₡1,250.50")).toBeInTheDocument();
    // Ubicación jerárquica en una línea.
    expect(
      within(region).getByText("Cartago · Cartago · Oreamuno · San Rafael"),
    ).toBeInTheDocument();
  });

  it("R14: 'Por recoger' ofrece ÚNICAMENTE la acción 'Recoger' (no existe 'Rechazar')", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recoger" });
    expect(within(region).getAllByRole("button", { name: "Recoger" })).toHaveLength(2);
    expect(
      within(region).queryByRole("button", { name: /rechazar/i }),
    ).toBeNull();
  });

  it("R16: 'Recoger todas' dispara la acción en LOTE con todos los ordenIds", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["r1", "r2"] });
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Recoger todas" }));
    const dialog = await screen.findByRole("dialog", { name: "Recoger órdenes" });
    await user.click(within(dialog).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() => expect(recogerMock).toHaveBeenCalledTimes(1));
    expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["r1", "r2"] });
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R16: 'Recoger' de una fila envía solo ese ordenId", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recoger" });
    await user.click(within(region).getAllByRole("button", { name: "Recoger" })[1]);
    const dialog = await screen.findByRole("dialog", { name: "Recoger órdenes" });
    await user.click(within(dialog).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() => expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["r2"] }));
  });

  it("R19/R20: con una orden activa (ordenEnGestionId), las DEMÁS quedan bloqueadas", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2" }),
      ],
      ordenEnGestionId: "g2",
    });

    // g2 es la activa: su botón está habilitado ("Continuar gestión").
    const activa = screen.getByRole("button", { name: "Continuar gestión" });
    expect(activa).toBeEnabled();
    // g1 queda bloqueada.
    const bloqueada = screen.getByRole("button", { name: "Gestionar" });
    expect(bloqueada).toBeDisabled();
  });

  it("R17: al 'Gestionar' se fija el puntero (escogerParaGestion) y se abre el modal", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() =>
      expect(escogerMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Gestionar orden" }),
    ).toBeInTheDocument();
  });

  it("R21: si escoger devuelve conflict, muestra Toast y NO abre el modal", async () => {
    const user = userEvent.setup();
    escogerMock.mockResolvedValue({ status: "conflict", motivo: "otra activa" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("dialog", { name: "Gestionar orden" }),
    ).toBeNull();
  });

  it("R22/R23: ENTREGADA envía foto + monto + método de pago en el FormData", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 150 })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));
    await screen.findByRole("dialog", { name: "Gestionar orden" });

    // Resultado por defecto: Entregada. Monto viene prellenado con montoCobrar.
    await elegirEnSelect(user, "Método de pago", "Efectivo");
    await subirEvidencia(user, "Foto de evidencia de entrega");

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("entregada");
    expect(fd.get("ordenId")).toBe("g1");
    expect(fd.get("montoRecibido")).toBe("150");
    expect(fd.get("metodoPago")).toBe("efectivo");
    expect(fd.get("evidencia")).toBeInstanceOf(File);
  });

  it("R25/R26: REPROGRAMAR envía fecha futura + motivo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "ok",
      ordenId: "g1",
      estado: "reprogramada",
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));
    await screen.findByRole("dialog", { name: "Gestionar orden" });
    await elegirEnSelect(user, "Resultado de la gestión", "Reprogramar");

    fireEvent.change(screen.getByLabelText("Nueva fecha de reprogramación"), {
      target: { value: "2030-12-31" },
    });
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Cliente ausente" },
    });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("reprogramada");
    expect(fd.get("fechaReprogramacion")).toBe("2030-12-31");
    expect(fd.get("motivo")).toBe("Cliente ausente");
  });

  it("R27/R28: DEVOLUCIÓN envía solo el motivo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "ok",
      ordenId: "g1",
      estado: "devuelta",
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));
    await screen.findByRole("dialog", { name: "Gestionar orden" });
    await elegirEnSelect(user, "Resultado de la gestión", "Devolución");

    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Rechazo del producto" },
    });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("devuelta");
    expect(fd.get("motivo")).toBe("Rechazo del producto");
    expect(fd.get("evidencia")).toBeNull();
  });

  it("R29/R30: RECHAZO envía foto + motivo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "ok",
      ordenId: "g1",
      estado: "rechazada",
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));
    await screen.findByRole("dialog", { name: "Gestionar orden" });
    await elegirEnSelect(user, "Resultado de la gestión", "Rechazo");

    await subirEvidencia(user, "Foto de evidencia del rechazo");
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Dirección inexistente" },
    });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("rechazada");
    expect(fd.get("motivo")).toBe("Dirección inexistente");
    expect(fd.get("evidencia")).toBeInstanceOf(File);
  });

  it("R22 (cliente): ENTREGADA sin foto ni método NO envía y muestra errores por campo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 150 })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));
    await screen.findByRole("dialog", { name: "Gestionar orden" });

    // Sin elegir método ni subir foto → la validación de borde bloquea el envío.
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    expect(gestionarMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("R22/R24: un validation_error del servidor (p. ej. monto no cuadra) se muestra por campo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { montoRecibido: ["el monto debe cuadrar con el monto a cobrar"] },
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 150 })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar" }));
    await screen.findByRole("dialog", { name: "Gestionar orden" });
    await elegirEnSelect(user, "Método de pago", "Efectivo");
    await subirEvidencia(user, "Foto de evidencia de entrega");

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("el monto debe cuadrar con el monto a cobrar"),
    ).toBeInTheDocument();
  });
});
