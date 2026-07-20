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
import { sincronizarRuta } from "@/lib/actions/ruta-mensajero";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 36 (T15-T17) / rediseño 63 (pedido humano) — módulo del mensajero. Se
// mockean las Server Actions (recoger / escoger / gestionar / liberar), el toast
// y el router (refresh) para afirmar la composición y los envíos sin DB ni
// sesión. La sección "En reparto" ya NO usa modal: es un PANEL inline (region
// "Detalle de la orden") con la PRIMERA orden en detalle por defecto.
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

// Feature 93 (R31/R32): la Server Action REAL de la feature 92 se MOCKEA. Su
// contrato es `{ status: "ok"; omitida: boolean }` — NO devuelve la ruta ni la
// secuencia: el orden nuevo llega SIEMPRE por `router.refresh()` (R32).
vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn(),
}));

const recogerMock = vi.mocked(recogerAsignaciones);
const escogerMock = vi.mocked(escogerParaGestion);
const gestionarMock = vi.mocked(gestionar);
const liberarMock = vi.mocked(liberarGestion);
const sincronizarMock = vi.mocked(sincronizarRuta);

// --- Feature 93 (R25): mock de `navigator.geolocation` con los TRES desenlaces --
type DesenlaceGeo =
  | { tipo: "concedido"; lat: number; lng: number }
  | { tipo: "denegado" }
  | { tipo: "timeout" }
  | { tipo: "ausente" };

const getCurrentPositionMock = vi.fn();

function mockGeolocation(desenlace: DesenlaceGeo) {
  if (desenlace.tipo === "ausente") {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });
    return;
  }
  getCurrentPositionMock.mockImplementation(
    (
      onOk: (p: { coords: { latitude: number; longitude: number } }) => void,
      onErr: (e: { code: number; message: string }) => void,
    ) => {
      if (desenlace.tipo === "concedido") {
        onOk({ coords: { latitude: desenlace.lat, longitude: desenlace.lng } });
        return;
      }
      // 1 = PERMISSION_DENIED, 3 = TIMEOUT (constantes de GeolocationPositionError)
      onErr(
        desenlace.tipo === "denegado"
          ? { code: 1, message: "User denied Geolocation" }
          : { code: 3, message: "Timeout expired" },
      );
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition: getCurrentPositionMock },
    configurable: true,
  });
}

const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: new Date("2026-07-20T10:00:00Z"),
  origenFuente: "gps",
  paradasSinOptimizar: 0,
};

/** Nombres accesibles de las cards de "En reparto", EN EL ORDEN DEL DOM. */
function ordenCardsEnReparto(): string[] {
  const region = screen.getByRole("region", {
    name: "En reparto / por gestionar",
  });
  return within(region)
    .getAllByRole("button", { name: /^Gestionar orden / })
    .map((b) => b.getAttribute("aria-label") ?? "");
}

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
    peso: 1.5,
    montoCobrar: 150,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    // Feature 92/R28: sin posicion en la ruta salvo que el test la fije.
    secuenciaRuta: null,
    ...over,
  };
}

function renderModule(props?: Partial<Parameters<typeof MisAsignacionesModule>[0]>) {
  return render(
    <MisAsignacionesModule
      porRecoger={props?.porRecoger ?? []}
      porGestionar={props?.porGestionar ?? []}
      ordenEnGestionId={props?.ordenEnGestionId ?? null}
      ruta={props?.ruta}
      rol={props?.rol}
    />,
  );
}

/** El panel de detalle grande e inline (region con nombre accesible). */
function panelDetalle() {
  return screen.getByRole("region", { name: "Detalle de la orden" });
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
 * Lleva una card al panel de detalle y avanza hasta los 4 botones de resultado:
 * (1) click en la card → panel; (2) "Gestionar esta orden" → fija el puntero y revela
 * los 4 botones; (3) opcionalmente elige un resultado (muestra sus campos).
 */
async function iniciarGestion(
  user: ReturnType<typeof userEvent.setup>,
  { card, resultado }: { card: string; resultado?: string },
) {
  await user.click(screen.getByRole("button", { name: `Gestionar orden ${card}` }));
  await user.click(screen.getByRole("button", { name: "Gestionar esta orden" }));
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
  sincronizarMock.mockResolvedValue({ status: "ok", omitida: false });
  mockGeolocation({ tipo: "concedido", lat: 9.93, lng: -84.08 });
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

  it("R11 / 63: muestra el detalle en 3 secciones (pedido, entrega, cobro con peso)", () => {
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
          peso: 1.5,
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
    // Sección 1 — Pedido: guía, nombre, teléfono, producto.
    expect(within(region).getByText("2002")).toBeInTheDocument();
    expect(within(region).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(region).getByText("70001111")).toBeInTheDocument();
    expect(within(region).getByText("Sobre")).toBeInTheDocument();
    // Sección 2 — Entrega: dirección + provincia/cantón/distrito + notas (SIN zona).
    expect(within(region).getByText("Av. Central 100")).toBeInTheDocument();
    expect(within(region).getByText("Cartago")).toBeInTheDocument();
    expect(within(region).getByText("Oreamuno")).toBeInTheDocument();
    expect(within(region).getByText("San Rafael")).toBeInTheDocument();
    expect(within(region).getByText("Llamar antes")).toBeInTheDocument();
    // Sección 3 — Cobro: valor a cobrar (colones) + peso en kg.
    expect(within(region).getByText("₡1,250.50")).toBeInTheDocument();
    expect(within(region).getByText("1.5 kg")).toBeInTheDocument();
    // Ya NO se muestra la Tienda ni la ubicación con zona.
    expect(within(region).queryByText("Tienda Norte")).toBeNull();
    expect(
      within(region).queryByText("Cartago · Cartago · Oreamuno · San Rafael"),
    ).toBeNull();
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

  it("Sin órdenes en reparto: muestra el aviso y NO renderiza el panel de detalle", () => {
    renderModule({ porGestionar: [] });

    const region = screen.getByRole("region", { name: "En reparto / por gestionar" });
    expect(within(region).getByText("No hay órdenes en reparto.")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
  });

  it("Rediseño: cards en GRILLA y la PRIMERA orden en el PANEL de detalle por default", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
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
    // El panel inline muestra por defecto la PRIMERA orden (sin fijar el puntero).
    expect(
      within(panelDetalle()).getByText("Orden REM-G1 · Uno"),
    ).toBeInTheDocument();
    expect(escogerMock).not.toHaveBeenCalled();
    expect(
      within(panelDetalle()).getByRole("button", { name: "Gestionar esta orden" }),
    ).toBeInTheDocument();
  });

  it("Rediseño: seleccionar otra card la lleva al PANEL de detalle (sin fijar el puntero)", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    // Por defecto la primera; al seleccionar la segunda, el panel la refleja.
    expect(within(panelDetalle()).getByText("Orden REM-G1 · Uno")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Gestionar orden REM-G2/ }));

    expect(within(panelDetalle()).getByText("Orden REM-G2 · Dos")).toBeInTheDocument();
    expect(escogerMock).not.toHaveBeenCalled();
  });

  it("R19/R20: con una orden activa, las DEMÁS cards quedan bloqueadas y OCULTAN sus detalles", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Bloqueada Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Activa Dos" }),
      ],
      ordenEnGestionId: "g2",
    });

    // g2 es la activa: su card sigue seleccionable y muestra sus detalles.
    const cardActiva = screen.getByRole("button", { name: /Gestionar orden REM-G2/ });
    expect(cardActiva).toBeEnabled();
    expect(within(cardActiva).getByText("Activa Dos")).toBeInTheDocument();
    // g1 queda bloqueada.
    const cardBloqueada = screen.getByRole("button", { name: /Gestionar orden REM-G1/ });
    expect(cardBloqueada).toBeDisabled();
    // ...y oculta sus detalles (destinatario), mostrando solo el aviso.
    expect(within(cardBloqueada).queryByText("Bloqueada Uno")).toBeNull();
    expect(
      within(cardBloqueada).getByText(/Termina la gestión en curso/),
    ).toBeInTheDocument();
    // El panel de detalle muestra la orden ACTIVA (g2).
    expect(within(panelDetalle()).getByText("Orden REM-G2 · Activa Dos")).toBeInTheDocument();
  });

  it("R17: 'Gestionar esta orden' fija el puntero (escogerParaGestion) y revela los 4 botones", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar esta orden" }));

    await vi.waitFor(() =>
      expect(escogerMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    // Se revelan los 4 botones de resultado y desaparece "Gestionar esta orden".
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devolver" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gestionar esta orden" }),
    ).toBeNull();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R21: si escoger devuelve conflict, muestra Toast y NO revela los 4 botones", async () => {
    const user = userEvent.setup();
    escogerMock.mockResolvedValue({ status: "conflict", motivo: "otra activa" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar esta orden" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Sigue en el paso de detalle: "Gestionar esta orden" visible, sin los 4 botones.
    expect(
      screen.getByRole("button", { name: "Gestionar esta orden" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entregar" })).toBeNull();
  });

  it("Rediseño: la orden ACTIVA arranca en los 4 botones (puntero ya fijado)", async () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ordenEnGestionId: "g1",
    });

    // No se re-fija el puntero; se muestran los 4 botones directamente.
    expect(escogerMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Gestionar esta orden" }),
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

  it("ENTREGAR sin cobro (montoCobrar 0): oculta el método y envía monto 0 + efectivo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 0 })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Entregar" });

    // Sin cobro: no se pide método de pago.
    expect(screen.queryByRole("combobox", { name: "Método de pago" })).toBeNull();

    await subirEvidencia(user, "Foto de evidencia de entrega");
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("entregada");
    expect(fd.get("montoRecibido")).toBe("0");
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

  // Feature 73/T5.1: el nombre anterior ("DEVOLVER envía solo el motivo") quedó OBSOLETO: la rama
  // `devuelta` exige TAMBIÉN la causa tipificada (R4/R6/R9). Feature 75: y AHORA además la
  // evidencia (foto) OBLIGATORIA, espejo de `rechazada`. Se AMPLÍAN las aserciones de causa y
  // motivo (no se aflojan) y se afirma que la evidencia viaja en el FormData.
  it("R27/R28 + 73/R9 + 75: DEVOLVER envía la causa, el motivo y la evidencia", async () => {
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

    await user.click(screen.getByRole("radio", { name: "Dirección errada" }));
    await subirEvidencia(user, "Foto de evidencia de la devolución");
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Rechazo del producto" },
    });
    await subirEvidencia(user, "Foto de evidencia de la devolución");

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("devuelta");
    expect(fd.get("causaDevolucion")).toBe("wrong_address");
    expect(fd.get("motivo")).toBe("Rechazo del producto");
    expect(fd.get("evidencia")).toBeInstanceOf(File);
  });

  // --- Feature 73: selector de causa de devolución (B5) ---

  it("73/R3+R4 (T5.2): DEVOLVER muestra las 3 causas con su etiqueta en español, sin slugs", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Devolver" });

    const grupo = screen.getByRole("radiogroup", { name: "Causa de la devolución" });
    expect(within(grupo).getAllByRole("radio")).toHaveLength(3);
    for (const label of [
      "Cliente no localizado",
      "Número de celular errado",
      "Dirección errada",
    ]) {
      expect(within(grupo).getByRole("radio", { name: label })).toBeInTheDocument();
    }
    // R3: nunca el valor crudo del enum en el texto renderizado.
    expect(panelDetalle().textContent).not.toMatch(
      /not_found|wrong_number|wrong_address/,
    );
    // R7: el motivo sigue presente y APARTE de la causa.
    expect(screen.getByLabelText("Motivo")).toBeInTheDocument();
  });

  it("73/R5 (T5.3): el selector de causa NO aparece en Entregar / Reprogramar / Rechazar", async () => {
    for (const resultado of ["Entregar", "Reprogramar", "Rechazar"]) {
      const user = userEvent.setup();
      renderModule({
        porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      });

      await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado });

      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(screen.queryByRole("radio")).toBeNull();
      cleanup();
    }
  });

  it("73/R6 (T5.3): DEVOLVER sin causa NO envía y muestra el error junto al campo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Devolver" });

    // Motivo y evidencia válidos, causa sin elegir → sólo falla la causa (feature 75: la
    // evidencia se aporta para aislar el error a la causa, ahora que `devuelta` la exige).
    await subirEvidencia(user, "Foto de evidencia de la devolución");
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Cliente ausente" },
    });
    await subirEvidencia(user, "Foto de evidencia de la devolución");
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    expect(gestionarMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("causa requerida");
    expect(
      screen.getByRole("radiogroup", { name: "Causa de la devolución" }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("73/R4 (T5.4): cambiar de resultado y volver a Devolver no arrastra la causa anterior", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Devolver" });
    await user.click(screen.getByRole("radio", { name: "Cliente no localizado" }));
    expect(screen.getByRole("radio", { name: "Cliente no localizado" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Atrás" }));
    await user.click(await screen.findByRole("button", { name: "Devolver" }));

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
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

  it("R22/R24: un validation_error del servidor se muestra por campo", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { evidencia: ["la evidencia no supera la validacion"] },
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
      await screen.findByText("la evidencia no supera la validacion"),
    ).toBeInTheDocument();
  });

  it("R35: 'Cancelar gestión' tras fijar el puntero libera (liberarGestion) y refresca", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    await user.click(screen.getByRole("button", { name: "Gestionar esta orden" }));
    await screen.findByRole("button", { name: "Entregar" });

    // Cancelar la gestión SIN registrar resultado → libera el puntero.
    await user.click(screen.getByRole("button", { name: "Cancelar gestión" }));

    await vi.waitFor(() =>
      expect(liberarMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    expect(liberarMock).toHaveBeenCalledTimes(1);
    // La gestión NO se registró en este path.
    expect(gestionarMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R35: en el paso de detalle (sin fijar el puntero) NO hay 'Cancelar gestión' ni se libera", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    // Solo se ve el detalle: no existe el botón de cancelar y no se libera nada.
    expect(
      screen.queryByRole("button", { name: "Cancelar gestión" }),
    ).toBeNull();
    expect(liberarMock).not.toHaveBeenCalled();
    expect(escogerMock).not.toHaveBeenCalled();
  });

  // Feature 87 (R17): el panel de detalle NO tiene botones de contacto inline; reusa el
  // compuesto compartido `ContactoButtons` (que además prefija `506` en el enlace wa.me, R15).
  // Este test se ata al COMPORTAMIENTO real de `ContactoButtons` (no se mockea): si alguien
  // revirtiera el panel a los botones inline heredados —que abrían `wa.me/<telefono>` SIN el
  // `506`—, la aserción sobre `window.open` se rompería.
  it("R17/R15: el detalle reusa ContactoButtons y su WhatsApp abre wa.me con el número normalizado (506)", async () => {
    const user = userEvent.setup();
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(null as unknown as Window);

    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          destinatario: "Ana Pérez",
          telefonoDest: "88880000",
        }),
      ],
    });

    // El panel arranca en el paso "detalle" y ahí viven los botones de contacto.
    const panel = panelDetalle();
    const llamar = within(panel).getByRole("button", { name: "Llamar a Ana Pérez" });
    const whatsapp = within(panel).getByRole("button", { name: "WhatsApp a Ana Pérez" });
    expect(llamar).toBeInTheDocument();
    expect(whatsapp).toBeInTheDocument();

    // Llamar usa el teléfono crudo en un enlace tel:.
    await user.click(llamar);
    expect(openSpy).toHaveBeenCalledWith("tel:88880000", "_self");

    // WhatsApp usa el número NORMALIZADO con prefijo país 506 (bug corregido por ContactoButtons).
    await user.click(whatsapp);
    expect(openSpy).toHaveBeenCalledWith("https://wa.me/50688880000", "_blank");

    openSpy.mockRestore();
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

  // ========================= Feature 93 =========================

  // --- R28/R29: el ORDEN lo decide el servidor, el cliente no reordena ---

  it("R28: renderiza las cards de 'En reparto' EN EL ORDEN RECIBIDO (sin sort en cliente)", () => {
    // `porGestionar` llega ya ordenado por el service (secuencia optimizada asc,
    // y al final las que entraron después de la última optimización). Se pasan a
    // propósito desordenadas respecto de CUALQUIER criterio local (numRemision,
    // destinatario, secuenciaRuta) para que el test se ponga ROJO si alguien
    // mete un `sort` en el componente.
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g3",
          numRemision: "REM-C",
          destinatario: "Zoe",
          secuenciaRuta: 1,
        }),
        makeAsignacion({
          id: "g1",
          numRemision: "REM-A",
          destinatario: "Ana",
          secuenciaRuta: 2,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-B",
          destinatario: "Beto",
          secuenciaRuta: null,
        }),
      ],
      rol: "mensajero",
    });

    expect(ordenCardsEnReparto()).toEqual([
      "Gestionar orden REM-C · Zoe",
      "Gestionar orden REM-A · Ana",
      "Gestionar orden REM-B · Beto",
    ]);
  });

  it("R29: NO altera el orden de 'Por recoger' (se renderiza tal cual llega)", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r2", numRemision: "REM-Z", destinatario: "Zoe" }),
        makeAsignacion({ id: "r1", numRemision: "REM-A", destinatario: "Ana" }),
      ],
      rol: "mensajero",
    });

    const region = screen.getByRole("region", { name: "Por recoger" });
    const textos = within(region).getAllByText(/^REM-/).map((n) => n.textContent);
    expect(textos).toEqual(["REM-Z · Zoe", "REM-A · Ana"]);
  });

  // --- R30: aviso de orden no actualizado ---

  it("R30: muestra el aviso cuando la ruta está `desactualizada`", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ruta: { ...RUTA_VIGENTE, estado: "desactualizada" },
      rol: "mensajero",
    });

    expect(screen.getByRole("status")).toHaveTextContent(/no está actualizado/i);
  });

  it("R30: muestra el aviso cuando hay paradas sin optimizar aunque la ruta sea `vigente`", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ruta: { ...RUTA_VIGENTE, paradasSinOptimizar: 2 },
      rol: "mensajero",
    });

    expect(screen.getByRole("status")).toHaveTextContent(/no está actualizado/i);
  });

  it("R30: NO muestra el aviso con ruta vigente y 0 paradas sin optimizar", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ruta: RUTA_VIGENTE,
      rol: "mensajero",
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("R30: sin datos de ruta no inventa un aviso", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // --- R31: el botón solo existe para el rol mensajero ---

  it("R31: con rol `mensajero` se renderiza el botón de sincronización manual", () => {
    renderModule({ rol: "mensajero" });
    expect(
      screen.getByRole("button", { name: "Sincronizar ruta" }),
    ).toBeInTheDocument();
  });

  it.each(["adminTienda", "adminMaestro", "bodega"])(
    "R31: con rol %s el botón de sincronización NO se renderiza",
    (rol) => {
      renderModule({ rol });
      expect(
        screen.queryByRole("button", { name: "Sincronizar ruta" }),
      ).not.toBeInTheDocument();
    },
  );

  it("R31: sin rol explícito el botón NO se renderiza (fail-closed)", () => {
    renderModule({});
    expect(
      screen.queryByRole("button", { name: "Sincronizar ruta" }),
    ).not.toBeInTheDocument();
  });

  // --- R25/R32: los TRES desenlaces del permiso de geolocalización ---

  it("R25/R32: permiso CONCEDIDO → envía `ubicacion` y refresca la ruta", async () => {
    const user = userEvent.setup();
    mockGeolocation({ tipo: "concedido", lat: 9.93, lng: -84.08 });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(sincronizarMock).toHaveBeenCalledTimes(1));
    // Contrato REAL de la 92: la action recibe SOLO `ubicacion`. El cliente NO
    // manda `ordenIds`: la ruta la lee el servidor de la DB, no de lo que la UI
    // esté pintando (mandarlos dejaría al cliente influir en el orden).
    expect(sincronizarMock).toHaveBeenCalledWith({
      ubicacion: { lat: 9.93, lng: -84.08 },
    });
    // R32: el orden nuevo llega por `router.refresh()`, no por SWR ni fetch.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R25: permiso DENEGADO → llama IGUAL a la action, SIN `ubicacion`, y no aborta", async () => {
    const user = userEvent.setup();
    mockGeolocation({ tipo: "denegado" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(sincronizarMock).toHaveBeenCalledTimes(1));
    // Sin `ubicacion`: el backend resuelve el origen por el fallback de R24.
    expect(sincronizarMock).toHaveBeenCalledWith({});
    // La denegación NUNCA bloquea: la sincronización llega hasta el refresh.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("R25: FALLO/TIMEOUT de geolocalización → llama IGUAL a la action, SIN `ubicacion`", async () => {
    const user = userEvent.setup();
    mockGeolocation({ tipo: "timeout" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(sincronizarMock).toHaveBeenCalledTimes(1));
    expect(sincronizarMock).toHaveBeenCalledWith({});
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("R25: navegador SIN `geolocation` → tampoco bloquea la sincronización", async () => {
    const user = userEvent.setup();
    mockGeolocation({ tipo: "ausente" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(sincronizarMock).toHaveBeenCalledTimes(1));
    expect(sincronizarMock).toHaveBeenCalledWith({});
  });

  // Reescrito contra el contrato REAL de la 92: antes se apoyaba en que la action
  // devolviera la ruta, y la action real NO la devuelve. Ahora afirma algo MÁS
  // FUERTE: el aviso de R30 sale SIEMPRE del estado que manda el SERVIDOR por
  // props, y el cliente no fabrica ninguno por su cuenta.
  it("R30/R32: tras sincronizar, el aviso sale del SERVIDOR (props tras `router.refresh()`), no de la action", async () => {
    const user = userEvent.setup();
    sincronizarMock.mockResolvedValue({ status: "ok", omitida: false });
    const orden = makeAsignacion({ id: "g1", numRemision: "REM-G1" });
    const { rerender } = renderModule({
      porGestionar: [orden],
      ruta: RUTA_VIGENTE,
      rol: "mensajero",
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    // R32: la action resolvió `ok` y el módulo pidió el refresco al servidor.
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // Y MIENTRAS el servidor no mande una ruta nueva, el módulo NO inventa aviso:
    // un `ok` de la action no es evidencia de que la ruta esté desactualizada.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // El `router.refresh()` vuelve a renderizar el Server Component: ESE es el
    // único camino por el que cambia el estado de la ruta (R30).
    rerender(
      <MisAsignacionesModule
        porRecoger={[]}
        porGestionar={[orden]}
        ordenEnGestionId={null}
        ruta={{ ...RUTA_VIGENTE, estado: "desactualizada", paradasSinOptimizar: 1 }}
        rol="mensajero"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/no está actualizado/i);
  });

  // R32: `omitida: true` es un desenlace CORRECTO (guarda de coste del service),
  // no un error. La UI no debe tratarlo como fallo.
  it("R32: un `ok` con `omitida: true` no se reporta como error y refresca igual", async () => {
    const user = userEvent.setup();
    sincronizarMock.mockResolvedValue({ status: "ok", omitida: true });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(errorMock).not.toHaveBeenCalled();
  });

  // R33: la action real puede responder `forbidden` (rol != mensajero) o
  // `unauthenticated` (sesión caída). Ninguno debe refrescar ni pasar por `ok`.
  it.each([["forbidden"], ["unauthenticated"]] as const)(
    "R33: un `%s` de la action se avisa y NO refresca",
    async (status) => {
      const user = userEvent.setup();
      sincronizarMock.mockResolvedValue({ status });
      renderModule({
        porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
        rol: "mensajero",
      });

      await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

      await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
      expect(refreshMock).not.toHaveBeenCalled();
    },
  );

  it("R34 (UI): un `conflict` por sincronizar demasiado seguido se avisa y no refresca", async () => {
    const user = userEvent.setup();
    sincronizarMock.mockResolvedValue({
      status: "conflict",
      motivo: "sincronizacion_demasiado_frecuente",
    });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R32: mientras la action no resuelve, el botón queda deshabilitado (sin doble envío)", async () => {
    const user = userEvent.setup();
    let resolver: (() => void) | undefined;
    sincronizarMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = () => resolve({ status: "ok", omitida: false });
        }),
    );
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      rol: "mensajero",
    });

    await user.click(screen.getByRole("button", { name: "Sincronizar ruta" }));

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Sincronizando…" })).toBeDisabled(),
    );
    expect(sincronizarMock).toHaveBeenCalledTimes(1);

    resolver?.();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
