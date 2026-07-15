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
  liberarGestion,
} from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 36 (T15-T17) — módulo del mensajero. Se mockean las Server Actions
// (recoger / escoger / gestionar / liberar), el toast y el router (refresh) para
// afirmar la composición y los envíos sin DB ni sesión.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
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
const liberarMock = vi.mocked(liberarGestion);

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

/**
 * Abre el detalle grande de una card y avanza hasta los 4 botones de resultado:
 * (1) click en la card → detalle; (2) "Gestionar pedido" → fija el puntero y
 * revela los 4 botones; (3) opcionalmente elige un resultado (muestra sus campos).
 */
async function iniciarGestion(
  user: ReturnType<typeof userEvent.setup>,
  { card, resultado }: { card: string; resultado?: string },
) {
  await user.click(screen.getByRole("button", { name: `Gestionar orden ${card}` }));
  await screen.findByRole("dialog", { name: "Detalle de la orden" });
  await user.click(screen.getByRole("button", { name: "Gestionar pedido" }));
  if (resultado) {
    await user.click(await screen.findByRole("button", { name: resultado }));
  }
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
  liberarMock.mockResolvedValue({ status: "ok" });
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

  it("Feature 63: 'Por recoger' muestra el banner con el contador de órdenes nuevas asignadas", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recoger" });
    expect(
      within(region).getByText("2 Órdenes nuevas asignadas"),
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

  it("Rediseño: las cards se muestran en GRILLA y se seleccionan (una card por orden)", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "En reparto / por gestionar" });
    // Una card seleccionable por orden (button con aria-label descriptivo).
    expect(
      within(region).getByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
    // Grilla compacta: NO abre ningún detalle hasta seleccionar.
    expect(
      screen.queryByRole("dialog", { name: "Detalle de la orden" }),
    ).toBeNull();
  });

  it("R19/R20: con una orden activa (ordenEnGestionId), las DEMÁS cards quedan bloqueadas y OCULTAN sus detalles", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Bloqueada Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Activa Dos" }),
      ],
      ordenEnGestionId: "g2",
    });

    // g2 es la activa: su card sigue seleccionable y muestra sus detalles.
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeEnabled();
    expect(screen.getByText("Activa Dos")).toBeInTheDocument();
    // g1 queda bloqueada.
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeDisabled();
    // ...y oculta sus detalles (destinatario), mostrando solo el aviso.
    expect(screen.queryByText("Bloqueada Uno")).toBeNull();
    expect(
      screen.getByText(/Termina la gestión en curso/),
    ).toBeInTheDocument();
  });

  it("Rediseño: seleccionar una card abre el DETALLE grande (sin fijar el puntero aún)", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G1/ }));

    expect(
      await screen.findByRole("dialog", { name: "Detalle de la orden" }),
    ).toBeInTheDocument();
    // El puntero SOLO se fija al pulsar "Gestionar pedido".
    expect(escogerMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Gestionar pedido" }),
    ).toBeInTheDocument();
  });

  it("R17: 'Gestionar pedido' fija el puntero (escogerParaGestion) y revela los 4 botones", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G1/ }));
    await screen.findByRole("dialog", { name: "Detalle de la orden" });
    await user.click(screen.getByRole("button", { name: "Gestionar pedido" }));

    await vi.waitFor(() =>
      expect(escogerMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    // Se revelan los 4 botones de resultado y desaparece "Gestionar pedido".
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devolver" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gestionar pedido" }),
    ).toBeNull();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R21: si escoger devuelve conflict, muestra Toast y NO revela los 4 botones", async () => {
    const user = userEvent.setup();
    escogerMock.mockResolvedValue({ status: "conflict", motivo: "otra activa" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G1/ }));
    await screen.findByRole("dialog", { name: "Detalle de la orden" });
    await user.click(screen.getByRole("button", { name: "Gestionar pedido" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Sigue en el paso de detalle: "Gestionar pedido" visible, sin los 4 botones.
    expect(
      screen.getByRole("button", { name: "Gestionar pedido" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entregar" })).toBeNull();
  });

  it("Rediseño: reabrir la orden ACTIVA arranca en los 4 botones (puntero ya fijado)", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ordenEnGestionId: "g1",
    });

    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G1/ }));
    await screen.findByRole("dialog", { name: "Detalle de la orden" });

    // No se re-fija el puntero al reabrir; se muestran los 4 botones directamente.
    expect(escogerMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gestionar pedido" }),
    ).toBeNull();
  });

  it("R22/R23: ENTREGAR muestra sus campos y envía foto + monto + método en el FormData", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 150 })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Entregar" });

    // Monto viene prellenado con montoCobrar al elegir "Entregar".
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

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Reprogramar" });

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

  it("R27/R28: DEVOLVER envía solo el motivo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "ok",
      ordenId: "g1",
      estado: "devuelta",
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Devolver" });

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

  it("R29/R30: RECHAZAR envía foto + motivo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "ok",
      ordenId: "g1",
      estado: "rechazada",
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Rechazar" });

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

  it("Rediseño: desde los campos, 'Atrás' vuelve a los 4 botones sin perder el puntero", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Devolver" });
    expect(screen.getByLabelText("Motivo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Atrás" }));

    // Vuelven los 4 botones; el puntero NO se libera (escoger no se re-llama).
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
    expect(liberarMock).not.toHaveBeenCalled();
    expect(escogerMock).toHaveBeenCalledTimes(1);
  });

  it("R22 (cliente): ENTREGAR sin foto ni método NO envía y muestra errores por campo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 150 })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Entregar" });

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

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Entregar" });
    await elegirEnSelect(user, "Método de pago", "Efectivo");
    await subirEvidencia(user, "Foto de evidencia de entrega");

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("el monto debe cuadrar con el monto a cobrar"),
    ).toBeInTheDocument();
  });

  it("R35: cerrar tras 'Gestionar pedido' libera el puntero (liberarGestion) y refresca", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G1/ }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle de la orden" });
    await user.click(within(dialog).getByRole("button", { name: "Gestionar pedido" }));
    await screen.findByRole("button", { name: "Entregar" });

    // Cerrar/cancelar SIN registrar resultado → onOpenChange(false).
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await vi.waitFor(() =>
      expect(liberarMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    expect(liberarMock).toHaveBeenCalledTimes(1);
    // La gestión NO se registró en este path.
    expect(gestionarMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R35: cerrar el detalle SIN pulsar 'Gestionar pedido' NO libera el puntero", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G1/ }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle de la orden" });

    // Solo se miró el detalle: nunca se fijó el puntero.
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(liberarMock).not.toHaveBeenCalled();
    expect(escogerMock).not.toHaveBeenCalled();
  });

  it("R35: en el path de ÉXITO (onSuccess) NO se llama a liberarGestion", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 150 })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Entregar" });

    // Entrega válida: método + evidencia + monto prellenado.
    await elegirEnSelect(user, "Método de pago", "Efectivo");
    await subirEvidencia(user, "Foto de evidencia de entrega");
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    // El backend ya limpió el puntero dentro de su transacción: no se libera aquí.
    expect(liberarMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
