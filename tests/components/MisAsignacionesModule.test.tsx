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

// Feature 97: el mapa REAL usa Leaflet, que jsdom no puede pintar (canvas + `window`). Se
// mockea `RutaMapa` por su testid para afirmar que está montado y con qué paradas, sin
// depender del render de Leaflet. La Server Action de sincronización también se mockea (es
// `"use server"` y arrastra Prisma/servicios que no deben cargarse en jsdom).
const { rutaMapaMock } = vi.hoisted(() => ({ rutaMapaMock: vi.fn() }));
vi.mock("@/app/(app)/mis-asignaciones/_components/RutaMapa", () => ({
  RutaMapa: (props: { paradas: unknown[] }) => {
    rutaMapaMock(props);
    return <div data-testid="ruta-mapa" />;
  },
}));

vi.mock("@/lib/actions/ruta-mensajero", () => ({
  sincronizarRuta: vi.fn().mockResolvedValue({ status: "ok", omitida: false }),
}));

// Feature 115: la card monta `MarcarLuegoToggle`, que importa esta Server Action
// (`"use server"` con Prisma detrás). Se mockea para no cargar Prisma en jsdom; su
// comportamiento propio se prueba en `MarcarLuegoToggle.test.tsx`.
vi.mock("@/lib/actions/orden-mensajero-meta", () => ({
  marcarGestionarLuego: vi
    .fn()
    .mockResolvedValue({ status: "ok", ordenId: "g1", marcarLuego: true }),
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
    // Feature 97: coords de la parada (feature 91) para el mapa de ruta.
    latitud: 9.9281244,
    longitud: -84.0907246,
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

// Feature 97: ruta vigente por defecto (sin aviso de desactualizada, sin paradas pendientes).
const RUTA_VIGENTE: RutaResumenDTO = {
  estado: "vigente",
  calculadaAt: null,
  origenFuente: "gps",
  paradasSinOptimizar: 0,
};

function renderModule(props?: Partial<Parameters<typeof MisAsignacionesModule>[0]>) {
  return render(
    <MisAsignacionesModule
      porRecoger={props?.porRecoger ?? []}
      porGestionar={props?.porGestionar ?? []}
      ordenEnGestionId={props?.ordenEnGestionId ?? null}
      ruta={props?.ruta ?? RUTA_VIGENTE}
      bloqueado={props?.bloqueado ?? false}
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
 * (1) click en la card → panel; (2) feature 98: verifica la guía tecleando el
 * `numGuia` (default 1001, el de `makeAsignacion`) en el gate del panel de
 * detalle y pulsa "Gestionar" → fija el puntero y revela los 4 botones; (3)
 * opcionalmente elige un resultado (muestra sus campos). El input de guía se
 * busca DENTRO del panel para no chocar con el "Número de guía" de la sección
 * "Recoger por número de guía" (InputRecoger), que vive fuera del panel.
 */
async function iniciarGestion(
  user: ReturnType<typeof userEvent.setup>,
  { card, resultado, numGuia = 1001 }: { card: string; resultado?: string; numGuia?: number },
) {
  await user.click(screen.getByRole("button", { name: `Gestionar orden ${card}` }));
  const panel = panelDetalle();
  await user.type(within(panel).getByLabelText("Número de guía"), String(numGuia));
  await user.click(within(panel).getByRole("button", { name: "Gestionar" }));
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

  // Feature 96: la recogida ya NO vive en la sección "Por recoger" (se quitaron los
  // botones "Recoger" / "Recoger todas" y su modal). Queda como lista de SOLO-
  // VISUALIZACIÓN; recoger es exclusivamente por el input de número de guía o el escáner.
  it("Feature 96: 'Por recoger' es lista de SOLO-VISUALIZACIÓN (sin 'Recoger' / 'Recoger todas')", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Por recoger" });
    // Ya no hay ninguna acción de recogida en esta sección.
    expect(within(region).queryByRole("button", { name: "Recoger" })).toBeNull();
    expect(
      within(region).queryByRole("button", { name: "Recoger todas" }),
    ).toBeNull();
    expect(within(region).queryByRole("button")).toBeNull();
    // Pero sigue LISTANDO las guías por recoger (el mensajero ve qué tiene pendiente).
    expect(within(region).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(region).getByText(/REM-R2/)).toBeInTheDocument();
  });

  it("Feature 96: la recogida se ofrece SOLO por input de número de guía y por escáner (sin modal)", () => {
    renderModule({ porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })] });

    expect(
      screen.getByRole("region", { name: "Recoger por número de guía" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Recoger por escaneo" }),
    ).toBeInTheDocument();
    // Ya no existe el modal de confirmación de recogida.
    expect(
      screen.queryByRole("dialog", { name: "Recoger órdenes" }),
    ).toBeNull();
  });

  it("Feature 96: teclear una guía por recoger + confirmar recoge esa orden por su id y refresca", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["r2"] });
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numGuia: 1001 }),
        makeAsignacion({ id: "r2", numGuia: 1002 }),
      ],
    });

    const region = screen.getByRole("region", { name: "Recoger por número de guía" });
    await user.type(within(region).getByLabelText("Número de guía"), "1002");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["r2"] }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("Feature 96 (restricción 'asignada a mí'): una guía que NO está por recoger se rechaza sin llamar la action", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })],
    });

    const region = screen.getByRole("region", { name: "Recoger por número de guía" });
    await user.type(within(region).getByLabelText("Número de guía"), "9999");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
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
    // Feature 98: el panel exige verificar la guía antes de gestionar → el gate
    // (input "Número de guía" + botón "Gestionar") está montado en el detalle.
    expect(
      within(panelDetalle()).getByLabelText("Número de guía"),
    ).toBeInTheDocument();
    expect(
      within(panelDetalle()).getByRole("button", { name: "Gestionar" }),
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

  // Feature 113 (T6) reescribe el antiguo test de R19/R20: el spec 36 dejaba las demás
  // cards VISIBLES pero con el detalle OCULTO tras "Termina la gestión en curso…". Ahora,
  // con una gestión activa (y sin bloqueo), la vista COLAPSA a modo foco: solo se muestra
  // el panel de la orden activa; las demás cards ni siquiera se renderizan (R6) y el texto
  // de ocultamiento ya no existe (R2). El bloqueo 1-a-1 sigue siendo restricción de acción.
  it("R6/R2 (113): con una orden activa la vista COLAPSA a foco — las demás cards no están en el DOM y no hay 'Termina la gestión en curso'", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Otra Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Activa Dos" }),
      ],
      ordenEnGestionId: "g2",
    });

    // Modo foco: la grilla de cards no se renderiza (ni la activa ni las demás).
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();
    // El ocultamiento del spec 36 se eliminó: el texto no existe en ningún estado (R2).
    expect(screen.queryByText(/Termina la gestión en curso/)).toBeNull();
    // Solo queda el panel de la orden ACTIVA (g2).
    expect(
      within(panelDetalle()).getByText("Orden REM-G2 · Activa Dos"),
    ).toBeInTheDocument();
  });

  it("R17 + F98: verificar con la guía CORRECTA fija el puntero (escogerParaGestion) y revela los 4 botones", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", numGuia: 1001 })],
    });

    // Feature 98: el gate exige confirmar la guía del paquete antes de gestionar.
    const panel = panelDetalle();
    await user.type(within(panel).getByLabelText("Número de guía"), "1001");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() =>
      expect(escogerMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    // Se revelan los 4 botones de resultado y desaparece el gate de verificación.
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devolver" })).toBeInTheDocument();
    expect(
      within(panelDetalle()).queryByLabelText("Número de guía"),
    ).toBeNull();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("F98: verificar con una guía DISTINTA NO fija el puntero ni revela los 4 botones", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", numGuia: 1001 })],
    });

    const panel = panelDetalle();
    await user.type(within(panel).getByLabelText("Número de guía"), "9999");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));

    // La guía no corresponde: avisa nombrándola y NO fija el puntero.
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(escogerMock).not.toHaveBeenCalled();
    // No aparecen los 4 botones; el gate sigue disponible para reintentar.
    expect(screen.queryByRole("button", { name: "Entregar" })).toBeNull();
    expect(
      within(panelDetalle()).getByLabelText("Número de guía"),
    ).toBeInTheDocument();
  });

  it("R21: si escoger devuelve conflict, muestra Toast y NO revela los 4 botones", async () => {
    const user = userEvent.setup();
    escogerMock.mockResolvedValue({ status: "conflict", motivo: "otra activa" });
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", numGuia: 1001 })],
    });

    // Feature 98: verifica con la guía correcta; el conflict lo devuelve escoger.
    const panel = panelDetalle();
    await user.type(within(panel).getByLabelText("Número de guía"), "1001");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // Sigue en el paso de detalle: el gate de verificación visible, sin los 4 botones.
    expect(
      within(panelDetalle()).getByLabelText("Número de guía"),
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
    // Feature 98: con el puntero ya fijado no se re-verifica la guía (sin gate).
    expect(
      within(panelDetalle()).queryByLabelText("Número de guía"),
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
      // Feature 119: el borde revalida con el MISMO schema -> el error de foto cuelga de `evidencias`.
      fieldErrors: { evidencias: ["la evidencia no supera la validacion"] },
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
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", numGuia: 1001 })],
    });

    // Feature 98: verifica la guía para fijar el puntero y revelar los 4 botones.
    const panel = panelDetalle();
    await user.type(within(panel).getByLabelText("Número de guía"), "1001");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));
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

  // ---------------- Feature 97 (R28/R30/R31/R32) ----------------

  it("R28: muestra el nº de secuencia de la ruta en la card; las paradas sin posición se marcan 'Pendiente de optimizar'", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", secuenciaRuta: 2 }),
        // Sin posición: entró tras la última optimización.
        makeAsignacion({ id: "g3", numRemision: "REM-G3", secuenciaRuta: null }),
      ],
      ruta: { ...RUTA_VIGENTE, paradasSinOptimizar: 1 },
    });

    const region = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    // La posición 1 y 2 se leen de forma accesible ("Parada N de la ruta").
    expect(within(region).getByText("Parada 1 de la ruta")).toBeInTheDocument();
    expect(within(region).getByText("Parada 2 de la ruta")).toBeInTheDocument();
    // La orden sin posición muestra la marca de pendiente (y no un número de parada).
    expect(
      within(region).getByText("Pendiente de optimizar"),
    ).toBeInTheDocument();
    expect(
      within(region).queryByText("Parada 3 de la ruta"),
    ).toBeNull();
  });

  it("R30: con la ruta 'desactualizada' muestra el aviso de que el orden no está actualizado", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 })],
      ruta: { ...RUTA_VIGENTE, estado: "desactualizada" },
    });

    expect(
      screen.getByText("El orden mostrado no está actualizado"),
    ).toBeInTheDocument();
  });

  it("R30: aunque la ruta esté 'vigente', si hay paradas sin optimizar también avisa", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: null })],
      ruta: { ...RUTA_VIGENTE, estado: "vigente", paradasSinOptimizar: 1 },
    });

    expect(
      screen.getByText("El orden mostrado no está actualizado"),
    ).toBeInTheDocument();
  });

  it("R30: ruta vigente y sin pendientes NO muestra el aviso", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 })],
      ruta: RUTA_VIGENTE,
    });

    expect(
      screen.queryByText("El orden mostrado no está actualizado"),
    ).toBeNull();
  });

  it("R31/R32: el botón 'Sincronizar ruta' está montado en el módulo del mensajero", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 })],
    });

    expect(
      screen.getByRole("button", { name: "Sincronizar ruta" }),
    ).toBeInTheDocument();
  });

  it("R28/mapa: el mapa de ruta está presente y recibe SOLO las paradas con coordenadas", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
        // Sin coordenadas: se omite del mapa pero sigue en la lista.
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          secuenciaRuta: 2,
          latitud: null,
          longitud: null,
        }),
      ],
    });

    expect(screen.getByTestId("ruta-mapa")).toBeInTheDocument();
    // g2 va en la lista (su card existe) pero NO entra al mapa (sin coords).
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id)).toEqual(["g1"]);
  });

  // ---------------- Feature 111 (R12/R14): bloqueo total del mensajero ----------------

  it("R12: bloqueado muestra el aviso accionable de BLOQUEO TOTAL", () => {
    renderModule({
      bloqueado: true,
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente/i,
    );
  });

  it("R12: sin bloqueo NO muestra el aviso de bloqueo total", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.queryByText(/no puedes gestionar ni recibir nuevas asignaciones/i),
    ).not.toBeInTheDocument();
  });

  it("R14: bloqueado desactiva/guarda los controles de recoger (input + escáner)", () => {
    renderModule({
      bloqueado: true,
      porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })],
    });

    // Los controles de recogida no se renderizan; sí la lista de solo-visualización.
    expect(
      screen.queryByRole("region", { name: "Recoger por número de guía" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recoger por escaneo" }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Por recoger" }),
    ).toBeInTheDocument();
  });

  it("R14: bloqueado deshabilita las cards de 'En reparto' y NO renderiza el panel de gestión (escoger/gestionar)", () => {
    renderModule({
      bloqueado: true,
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    // Las cards siguen visibles pero deshabilitadas (no se puede escoger para gestión).
    const region = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    expect(
      within(region).getByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeDisabled();
    expect(
      within(region).getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeDisabled();
    // El panel de detalle/gestión (escoger + gestionar) no se monta.
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
  });

  it("R14: sin bloqueo, los controles de gestión siguen operativos (el panel se monta)", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getByRole("region", { name: "Detalle de la orden" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Recoger por número de guía" }),
    ).toBeInTheDocument();
  });

  // ---------------- Feature 113: detalle inline en cada card + modo foco ----------------

  it("R1: cada card en reparto muestra el detalle COMPLETO (Pedido/Entrega/Cobro) de SU orden", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          destinatario: "Uno",
          direccion: "Calle Uno 111",
          montoCobrar: 111,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          destinatario: "Dos",
          direccion: "Calle Dos 222",
          montoCobrar: 222,
        }),
      ],
    });

    const card1 = screen.getByRole("button", { name: /Gestionar orden REM-G1/ });
    const card2 = screen.getByRole("button", { name: /Gestionar orden REM-G2/ });

    // Cada card trae las 3 secciones de AsignacionDetalle y sus labels.
    for (const card of [card1, card2]) {
      expect(within(card).getByText("Pedido")).toBeInTheDocument();
      expect(within(card).getByText("Entrega")).toBeInTheDocument();
      expect(within(card).getByText("Cobro")).toBeInTheDocument();
      expect(within(card).getByText("Valor a cobrar")).toBeInTheDocument();
      expect(within(card).getByText("Dirección")).toBeInTheDocument();
    }
    // ...con los datos propios de cada orden (no los del vecino).
    expect(within(card1).getByText("Calle Uno 111")).toBeInTheDocument();
    expect(within(card2).getByText("Calle Dos 222")).toBeInTheDocument();
  });

  it("R2: el texto 'Termina la gestión en curso' no aparece en NINGÚN estado", () => {
    // Sin gestión activa (vista completa con detalle inline).
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2" }),
      ],
    });
    expect(screen.queryByText(/Termina la gestión en curso/)).toBeNull();
    cleanup();

    // Con gestión activa (modo foco).
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2" }),
      ],
      ordenEnGestionId: "g2",
    });
    expect(screen.queryByText(/Termina la gestión en curso/)).toBeNull();
  });

  it("R3: bloqueado sin gestión — las cards están deshabilitadas y AÚN muestran el detalle completo", () => {
    renderModule({
      bloqueado: true,
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          destinatario: "Uno",
          direccion: "Calle Uno 111",
        }),
      ],
    });

    const card = screen.getByRole("button", { name: /Gestionar orden REM-G1/ });
    // La deshabilitación restringe la ACCIÓN, no la visibilidad.
    expect(card).toBeDisabled();
    expect(within(card).getByText("Pedido")).toBeInTheDocument();
    expect(within(card).getByText("Valor a cobrar")).toBeInTheDocument();
    expect(within(card).getByText("Calle Uno 111")).toBeInTheDocument();
  });

  it("R4: con una gestión activa NO se ofrece gestionar OTRA orden (sus cards no están en el DOM)", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2" }),
      ],
      ordenEnGestionId: "g2",
    });

    // La única superficie es el panel de la activa; no hay cards para escoger otra orden.
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();
    expect(escogerMock).not.toHaveBeenCalled();
  });

  it("R4b: el flujo 'verificar guía → Gestionar' llama escogerParaGestion con el MISMO payload y sin llamadas nuevas", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", numGuia: 1001 }),
      ],
    });

    const panel = panelDetalle();
    await user.type(within(panel).getByLabelText("Número de guía"), "1001");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));

    // Contrato del bloqueo 1-a-1 sin cambios: mismo payload y una sola llamada.
    await vi.waitFor(() =>
      expect(escogerMock).toHaveBeenCalledWith({ ordenId: "g1" }),
    );
    expect(escogerMock).toHaveBeenCalledTimes(1);
    // No aparecen llamadas nuevas a otras Server Actions.
    expect(liberarMock).not.toHaveBeenCalled();
    expect(gestionarMock).not.toHaveBeenCalled();
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("R5: con una gestión activa la vista entra en foco y el panel muestra la orden ACTIVA", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Activa Dos" }),
      ],
      ordenEnGestionId: "g2",
    });

    expect(
      within(panelDetalle()).getByText("Orden REM-G2 · Activa Dos"),
    ).toBeInTheDocument();
  });

  it("R7: en foco NO se renderiza el mapa de ruta ni 'Sincronizar ruta'", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", secuenciaRuta: 2 }),
      ],
      ordenEnGestionId: "g2",
    });

    expect(screen.queryByTestId("ruta-mapa")).toBeNull();
    expect(screen.queryByText("Mapa de ruta")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sincronizar ruta" }),
    ).toBeNull();
  });

  it("R8: en foco se oculta la sección 'Por recoger' y sus controles de recogida", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })],
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ordenEnGestionId: "g1",
    });

    expect(screen.queryByRole("region", { name: "Por recoger" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recoger por número de guía" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recoger por escaneo" }),
    ).toBeNull();
  });

  it("R9: en foco (yaActiva) se ven los 4 botones de resultado y 'Cancelar gestión'", async () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ordenEnGestionId: "g1",
    });

    expect(
      await screen.findByRole("button", { name: "Entregar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reprogramar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devolver" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancelar gestión" }),
    ).toBeInTheDocument();
    // El puntero ya está fijado: no se re-escoge ni se pide de nuevo la guía.
    expect(escogerMock).not.toHaveBeenCalled();
    expect(
      within(panelDetalle()).queryByLabelText("Número de guía"),
    ).toBeNull();
  });

  it("R10: al volver ordenEnGestionId a null se SALE del foco y se restaura la vista completa", () => {
    const porRecoger = [makeAsignacion({ id: "r1", numGuia: 1001 })];
    const porGestionar = [
      makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
      makeAsignacion({ id: "g2", numRemision: "REM-G2", secuenciaRuta: 2 }),
    ];
    const { rerender } = render(
      <MisAsignacionesModule
        porRecoger={porRecoger}
        porGestionar={porGestionar}
        ordenEnGestionId="g2"
        ruta={RUTA_VIGENTE}
        bloqueado={false}
      />,
    );

    // En foco: grilla, mapa y "Por recoger" ocultos.
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Por recoger" })).toBeNull();
    expect(screen.queryByTestId("ruta-mapa")).toBeNull();

    // Puntero liberado (gestión finalizada/cancelada) → vuelve la vista completa.
    rerender(
      <MisAsignacionesModule
        porRecoger={porRecoger}
        porGestionar={porGestionar}
        ordenEnGestionId={null}
        ruta={RUTA_VIGENTE}
        bloqueado={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Por recoger" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ruta-mapa")).toBeInTheDocument();
  });

  it("R11: sin órdenes en reparto muestra el vacío y NO entra en foco (aunque haya puntero)", () => {
    renderModule({ porGestionar: [], ordenEnGestionId: "gX" });

    expect(
      screen.getByText("No hay órdenes en reparto."),
    ).toBeInTheDocument();
    // Ni panel de gestión ni colapso a foco: la vista completa sigue montada.
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();
  });

  it("R12: bloqueado con puntero fijado NO entra en foco (precede el aviso de bloqueo total, sin panel)", () => {
    renderModule({
      bloqueado: true,
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
      ordenEnGestionId: "g2",
    });

    // El aviso de bloqueo total tiene precedencia.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /no puedes gestionar ni recibir nuevas asignaciones/i,
    );
    // NO hay foco: las cards siguen en la grilla (deshabilitadas) y NO se monta el panel.
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
  });

  // ---------------- Feature 114: buscador de guías asignadas ----------------

  /** El campo de búsqueda de guías (input type="search" con label "Buscar guías"). */
  function buscador() {
    return screen.getByRole("searchbox", { name: "Buscar guías" });
  }

  it("114/R1: renderiza un campo de búsqueda de guías (searchbox) sobre ambos grupos", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-R1" })],
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    // Rol accesible (searchbox) + etiqueta accesible (label "Buscar guías").
    expect(buscador()).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar guías")).toBeInTheDocument();
    // Ambos grupos siguen presentes (el buscador va por encima, no los reemplaza).
    expect(
      screen.getByRole("region", { name: "Por recoger" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();
  });

  it("114/R1: en modo foco NO se renderiza el buscador (no hay cards que filtrar)", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ordenEnGestionId: "g1",
    });

    expect(screen.queryByRole("searchbox", { name: "Buscar guías" })).toBeNull();
  });

  it("114/R2: teclear texto filtra AMBOS grupos por guía / remisión / destinatario", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-RA", destinatario: "Ana" }),
        makeAsignacion({ id: "r2", numRemision: "REM-RB", destinatario: "Beto" }),
      ],
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-GA", destinatario: "Ana Torres" }),
        makeAsignacion({ id: "g2", numRemision: "REM-GB", destinatario: "Carlos" }),
      ],
    });

    await user.type(buscador(), "ana");

    // "Por recoger": queda r1 (destinatario Ana); se va r2.
    const recoger = screen.getByRole("region", { name: "Por recoger" });
    expect(within(recoger).getByText(/REM-RA/)).toBeInTheDocument();
    expect(within(recoger).queryByText(/REM-RB/)).toBeNull();

    // "En reparto": queda g1 (Ana Torres); se va g2 (Carlos).
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-GA/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-GB/ }),
    ).toBeNull();
  });

  it("114/R5: limpiar la búsqueda restaura TODAS las guías de ambos grupos", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", destinatario: "Ana" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2", destinatario: "Beto" }),
      ],
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Ana" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Beto" }),
      ],
    });

    const input = buscador();
    await user.type(input, "beto");
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();

    await user.clear(input);

    // Sin búsqueda: reaparecen todas las guías de ambos grupos.
    const recoger = screen.getByRole("region", { name: "Por recoger" });
    expect(within(recoger).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(recoger).getByText(/REM-R2/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
  });

  it("114/R6: sin coincidencias muestra 'sin resultados' por grupo, distinto del vacío sin búsqueda", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", destinatario: "Ana" }),
      ],
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Beto" }),
      ],
    });

    await user.type(buscador(), "zzzinexistente");

    const recoger = screen.getByRole("region", { name: "Por recoger" });
    expect(
      within(recoger).getByText(
        "Ninguna guía por recoger coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();

    const reparto = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    expect(
      within(reparto).getByText(
        "Ninguna guía en reparto coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();

    // DISTINGUIBLE del vacío sin búsqueda: esos textos no aparecen.
    expect(screen.queryByText("No hay órdenes por recoger.")).toBeNull();
    expect(screen.queryByText("No hay órdenes en reparto.")).toBeNull();
  });

  it("114/R7: el filtro aplica por grupo — una coincidencia de un grupo no cruza al otro", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-RECOGER", destinatario: "Ana" }),
      ],
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-REPARTO", destinatario: "Ana" }),
      ],
    });

    // "recoger" solo coincide con la remisión del grupo "Por recoger".
    await user.type(buscador(), "recoger");

    const recoger = screen.getByRole("region", { name: "Por recoger" });
    const reparto = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    // Aparece en su grupo...
    expect(within(recoger).getByText(/REM-RECOGER/)).toBeInTheDocument();
    // ...y NO cruza a "En reparto", que muestra su propio "sin resultados".
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-REPARTO/ }),
    ).toBeNull();
    expect(
      within(reparto).getByText(
        "Ninguna guía en reparto coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();
  });

  it("114/R8: filtrar excluye la parada de la grilla Y del mapa de ruta", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-UNO",
          destinatario: "Ana",
          secuenciaRuta: 1,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-DOS",
          destinatario: "Beto",
          secuenciaRuta: 2,
        }),
      ],
    });

    await user.type(buscador(), "uno");

    // La card de g2 sale de la grilla...
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-UNO/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-DOS/ }),
    ).toBeNull();

    // ...y su parada NO llega al mapa: RutaMapa recibe SOLO g1 (coherencia R8).
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id)).toEqual(["g1"]);
  });

  it("114/R9: la orden EN GESTIÓN permanece en la lista y en el mapa aunque no coincida", async () => {
    const user = userEvent.setup();
    // `bloqueado` mantiene la VISTA COMPLETA (grilla + mapa) con el puntero fijado, sin
    // colapsar a modo foco: es el escenario donde la salvaguarda R9 es observable.
    renderModule({
      bloqueado: true,
      ordenEnGestionId: "g2",
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-UNO",
          destinatario: "Ana",
          secuenciaRuta: 1,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-DOS",
          destinatario: "Beto",
          secuenciaRuta: 2,
        }),
        makeAsignacion({
          id: "g3",
          numRemision: "REM-TRES",
          destinatario: "Carla",
          secuenciaRuta: 3,
        }),
      ],
    });

    // "uno" solo coincide con g1; NO con g2 (en gestión) ni con g3.
    await user.type(buscador(), "uno");

    // g2 (en gestión) NO se oculta pese a no coincidir; g1 (coincide) también está.
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-DOS/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gestionar orden REM-UNO/ }),
    ).toBeInTheDocument();
    // Control: g3 (ni coincide ni está en gestión) SÍ se filtra → prueba que el filtro
    // actúa y que la permanencia de g2 se debe a la salvaguarda, no a falta de filtro.
    expect(
      screen.queryByRole("button", { name: /Gestionar orden REM-TRES/ }),
    ).toBeNull();

    // Y la parada de g2 sigue en el mapa junto a la de g1 (no la de g3).
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id).sort()).toEqual(["g1", "g2"]);
  });
});
