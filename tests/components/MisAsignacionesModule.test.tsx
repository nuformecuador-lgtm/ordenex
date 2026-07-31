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

// Feature 116: el panel de detalle monta `NotaPrivadaMensajero`, que importa estas Server
// Actions (`"use server"` con Prisma detrás). Se mockean para no cargar Prisma en jsdom; su
// comportamiento propio se prueba en `NotaPrivadaMensajero.test.tsx`.
vi.mock("@/lib/actions/notas-privadas-mensajero", () => ({
  guardarNotaPrivada: vi.fn(),
  limpiarNotaPrivada: vi.fn(),
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

/** Nombres accesibles de las cards de "En reparto", EN EL ORDEN DEL DOM. */
function ordenCardsEnReparto(): string[] {
  const region = screen.getByRole("region", {
    name: "En reparto / por gestionar",
  });
  return within(region)
    .getAllByRole("article", { name: /^Gestionar orden / })
    .map((b) => b.getAttribute("aria-label") ?? "");
}

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "por_recoger",
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

/**
 * Card de una remisión: el `<article>` de `PosOrderCard`. La card ya no tiene CTA
 * interno ("Gestionar orden" se eliminó, pedido humano): el `<article>` mismo es el
 * target de selección y lleva el `aria-label` "Gestionar orden <rem> · <dest>".
 */
function cardDe(numRemision: string): HTMLElement {
  return screen.getByRole("article", {
    name: new RegExp(`Gestionar orden ${numRemision}`),
  });
}

/**
 * Nº de parada en la cabecera de la card POS. El texto se reparte entre
 * `<span class="sr-only">Parada </span>` y `{parada} de {total}`, así que se busca
 * por el `<p>` que los contiene en lugar de por una cadena exacta.
 */
/**
 * ¿La card dice que es la parada `parada` de `total`? Acotado a la CARD: el rediseño pinta
 * el número de parada en más de un sitio de la misma tarjeta, así que una búsqueda global ya
 * no puede distinguir la parada de una orden de la de otra. Ligarlo a su card es además lo
 * que el caso quiere afirmar —que ESA orden tiene ESA posición—.
 */
function diceParada(card: HTMLElement, parada: number, total: number): boolean {
  return (
    within(card).queryAllByText(
      (_, el) =>
        el?.tagName === "P" &&
        (el.textContent ?? "")
          .replace(/\s+/g, " ")
          .includes(`Parada ${parada} de ${total}`),
    ).length > 0
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
 * Lleva una card al panel de detalle y avanza hasta los 4 botones de resultado:
 * (1) click en la card → panel; (2) feature 98: verifica la guía tecleando el
 * `numGuia` (default 1001, el de `makeAsignacion`) en el gate del panel de
 * detalle y pulsa "Gestionar" → fija el puntero y revela los 4 botones; (3)
 * opcionalmente elige un resultado (muestra sus campos). El input de guía se
 * busca DENTRO del panel para no chocar con el "Número de guía" de la tarjeta
 * "Recoger paquete" (RecogerPaqueteCard), que vive fuera del panel.
 */
async function iniciarGestion(
  user: ReturnType<typeof userEvent.setup>,
  { card, resultado, numGuia = 1001 }: { card: string; resultado?: string; numGuia?: number },
) {
  await user.click(screen.getByRole("article", { name: `Gestionar orden ${card}` }));
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
    // Rediseño POS: "Por recoger" usa la MISMA card que "En reparto", así que varios
    // campos (destinatario, producto, cantón, monto) se repiten en la card y en el
    // detalle. Las 3 secciones se comprueban DENTRO del desplegable del detalle.
    const detalle = within(region)
      .getByText("Ver detalle completo")
      .closest("[data-slot='collapsible']") as HTMLElement;
    // Sección 1 — Pedido: guía, nombre, teléfono, producto.
    expect(within(detalle).getByText("2002")).toBeInTheDocument();
    expect(within(detalle).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(detalle).getByText("70001111")).toBeInTheDocument();
    expect(within(detalle).getByText("Sobre")).toBeInTheDocument();
    // Sección 2 — Entrega: dirección + provincia/cantón/distrito + notas (SIN zona).
    expect(within(detalle).getByText("Av. Central 100")).toBeInTheDocument();
    expect(within(detalle).getByText("Cartago")).toBeInTheDocument();
    expect(within(detalle).getByText("Oreamuno")).toBeInTheDocument();
    expect(within(detalle).getByText("San Rafael")).toBeInTheDocument();
    expect(within(detalle).getByText("Llamar antes")).toBeInTheDocument();
    // Sección 3 — Cobro: valor a cobrar (colones) + peso en kg.
    expect(within(detalle).getByText("₡1,250.50")).toBeInTheDocument();
    expect(within(detalle).getByText("1.5 kg")).toBeInTheDocument();
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
    // Rediseño POS: la card es la de "En reparto" pero SIN sus acciones de gestión ni de
    // contacto. El único control que queda es el desplegable del detalle (revelar, no
    // actuar), así que se comprueban por nombre en vez de "ningún botón".
    expect(
      within(region).queryByRole("article", { name: /Gestionar orden/ }),
    ).toBeNull();
    expect(within(region).queryByRole("link", { name: /Llamar a/ })).toBeNull();
    expect(within(region).queryByRole("link", { name: /WhatsApp a/ })).toBeNull();
    // Pero sigue LISTANDO las guías por recoger (el mensajero ve qué tiene pendiente).
    expect(within(region).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(region).getByText(/REM-R2/)).toBeInTheDocument();
  });

  it("Feature 96: la recogida se ofrece SOLO por input de número de guía y por escáner (sin modal)", () => {
    renderModule({ porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })] });

    expect(
      screen.getByRole("region", { name: "Recoger por número de guía o escaneo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
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

    const region = screen.getByRole("region", { name: "Recoger por número de guía o escaneo" });
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

    const region = screen.getByRole("region", { name: "Recoger por número de guía o escaneo" });
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
      within(region).getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
    // El panel inline muestra por defecto la PRIMERA orden (sin fijar el puntero).
    expect(
      within(panelDetalle()).getByText("Uno"),
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
    expect(within(panelDetalle()).getByText("Uno")).toBeInTheDocument();
    await user.click(screen.getByRole("article", { name: /Gestionar orden REM-G2/ }));

    expect(within(panelDetalle()).getByText("Dos")).toBeInTheDocument();
    expect(escogerMock).not.toHaveBeenCalled();
  });

  // Pedido humano (rama ux): la card ya no tiene CTA propio, se selecciona pulsando
  // CUALQUIER parte de ella (y con Enter/Espacio desde el teclado).
  it("Rediseño: el click en el CUERPO de la card también la lleva al PANEL de detalle", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    expect(within(panelDetalle()).getByText("Uno")).toBeInTheDocument();
    // Click en una zona NO interactiva de la segunda card (su cabecera).
    await user.click(within(cardDe("REM-G2")).getByText("REM-G2"));

    expect(within(panelDetalle()).getByText("Dos")).toBeInTheDocument();
    expect(escogerMock).not.toHaveBeenCalled();
  });

  it("Rediseño: los controles propios de la card NO seleccionan de rebote", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          destinatario: "Dos",
          telefonoDest: "70009999",
        }),
      ],
    });

    const card2 = cardDe("REM-G2");
    // Abrir el detalle de la segunda card y pulsar su "Ir" (navegación) no cambia la
    // selección: esos controles hacen lo suyo, no eligen la orden.
    await user.click(within(card2).getByText("Ver detalle completo"));
    // Rama ux: "Ir" ya no sale a Google Maps; abre el minimapa con el destino + el GPS del
    // mensajero (`UbicacionTrigger`), así que es un BOTÓN, no un enlace.
    await user.click(
      within(card2).getByRole("button", { name: /Ver en el mapa la ruta hasta/ }),
    );

    // "Ir" abre el minimapa en un diálogo, que deja el resto de la página inaccesible: se
    // cierra para poder mirar las cards de nuevo.
    await user.keyboard("{Escape}");

    // La selección sigue en la primera card. Ya no se comprueba contra el panel "Detalle de
    // la orden": el rediseño lo reserva al MODO FOCO (con una gestión activa), y en vista
    // completa la orden elegida se distingue por el badge "En detalle" de su propia card.
    expect(within(cardDe("REM-G1")).getByText("En detalle")).toBeInTheDocument();
    expect(within(cardDe("REM-G2")).queryByText("En detalle")).toBeNull();
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
      screen.queryByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();
    // El ocultamiento del spec 36 se eliminó: el texto no existe en ningún estado (R2).
    expect(screen.queryByText(/Termina la gestión en curso/)).toBeNull();
    // Solo queda el panel de la orden ACTIVA (g2).
    expect(
      within(panelDetalle()).getByText("Activa Dos"),
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

  // Feature 87 (R17) + feature 120 + rediseño ux: el panel de detalle ofrece "Llamar" (tel:
  // con el teléfono crudo) y NO el WhatsApp wa.me PLANO — el contacto por WhatsApp vive en el
  // chat de la app, al que se llega con la acción "Mensaje" de la misma fila.
  it("R17: el detalle ofrece Llamar (tel:) y Mensaje (chat), y ya no el WhatsApp wa.me plano", () => {
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

    // El panel arranca en el paso "detalle" y ahí vive la acción de Llamar. Rediseño ux:
    // la fila de tres acciones (Llamar / Mensaje / Navegar) sustituye a `ContactoButtons`,
    // así que Llamar es un ENLACE `tel:` —con el teléfono crudo, igual que antes— y no un
    // botón que abra la marcación por `window.open`.
    const panel = panelDetalle();
    const llamar = within(panel).getByRole("link", { name: "Llamar a Ana Pérez" });
    expect(llamar).toHaveAttribute("href", "tel:88880000");

    // El WhatsApp wa.me PLANO ya no se ofrece: no se abre `wa.me/<telefono>` desde el detalle.
    expect(
      within(panel).queryByRole("button", { name: "WhatsApp a Ana Pérez" }),
    ).toBeNull();
    expect(
      within(panel).queryByRole("link", { name: "WhatsApp a Ana Pérez" }),
    ).toBeNull();

    // En su lugar, "Mensaje" abre el chat de la app con esta orden.
    expect(
      within(panel).getByRole("button", {
        name: "Abrir el chat con Ana Pérez",
      }),
    ).toBeInTheDocument();
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
    // La posición 1 y 2 se leen de forma accesible ("Parada N de TOTAL"), cada una en SU card.
    expect(diceParada(cardDe("REM-G1"), 1, 3)).toBe(true);
    expect(diceParada(cardDe("REM-G2"), 2, 3)).toBe(true);
    // La orden sin posición muestra la marca de pendiente (y no un número de parada).
    expect(
      within(region).getByText("Pendiente de optimizar"),
    ).toBeInTheDocument();
    expect(diceParada(cardDe("REM-G3"), 3, 3)).toBe(false);
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
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
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
      screen.queryByRole("region", { name: "Recoger por número de guía o escaneo" }),
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

    // Las cards siguen visibles pero deshabilitadas: sin CTA propio, la selección es la
    // card misma, y bloqueada deja de ser un target (no enfocable con el teclado).
    const region = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    expect(
      within(region).getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).not.toHaveAttribute("tabindex");
    expect(
      within(region).getByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).not.toHaveAttribute("tabindex");
    // El panel de detalle/gestión (escoger + gestionar) no se monta.
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
  });

  it("R14: sin bloqueo, los controles de gestión siguen operativos (el panel se monta)", () => {
    renderModule({
      // Pedido humano: la card de recogida solo se pinta si HAY algo por recoger, así que
      // el caso "sin bloqueo" necesita una orden en ese grupo para poder comprobarla.
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-R1" })],
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getByRole("region", { name: "Detalle de la orden" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Recoger por número de guía o escaneo" }),
    ).toBeInTheDocument();
  });

  // Pedido humano: sin NADA por recoger no hay guía que resolver, así que el input y el
  // escáner de recogida no se muestran (la sección "Por recoger" sigue, con su vacío).
  it("sin órdenes por recoger, la card de recogida no se muestra", () => {
    renderModule({
      porRecoger: [],
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.queryByRole("region", {
        name: "Recoger por número de guía o escaneo",
      }),
    ).toBeNull();
    expect(screen.getByText("No hay órdenes por recoger.")).toBeInTheDocument();
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

    const card1 = cardDe("REM-G1");
    const card2 = cardDe("REM-G2");

    // Cada card trae las 3 secciones de AsignacionDetalle y sus labels (el
    // rediseño POS las pliega en un `<details>`, pero siguen montadas: R1).
    for (const card of [card1, card2]) {
      expect(within(card).getByText("Pedido")).toBeInTheDocument();
      expect(within(card).getByText("Entrega")).toBeInTheDocument();
      expect(within(card).getByText("Cobro")).toBeInTheDocument();
      expect(within(card).getByText("Valor a cobrar")).toBeInTheDocument();
    }
    // ...con los datos propios de cada orden (no los del vecino).
    // Ya no se busca el label "Dirección": el rediseño la sacó de la lista de campos y la
    // subió a un bloque propio con pin ("la dirección manda", legible al llegar). El dato
    // sigue ahí —que es lo que este caso protege—, ahora sin etiqueta que lo anuncie.
    // Aparece DOS veces por card (bloque de navegación POS + bloque del detalle plegado),
    // de ahí el getAll; lo que importa es que cada card lleve la suya y NO la del vecino.
    expect(within(card1).getAllByText("Calle Uno 111").length).toBeGreaterThan(0);
    expect(within(card1).queryByText("Calle Dos 222")).toBeNull();
    expect(within(card2).getAllByText("Calle Dos 222").length).toBeGreaterThan(0);
    expect(within(card2).queryByText("Calle Uno 111")).toBeNull();
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

    const card = cardDe("REM-G1");
    // La deshabilitación restringe la ACCIÓN (seleccionar), no la visibilidad.
    expect(card).not.toHaveAttribute("tabindex");
    expect(within(card).getByText("Pedido")).toBeInTheDocument();
    expect(within(card).getByText("Valor a cobrar")).toBeInTheDocument();
    // Dos veces: bloque de navegación POS + campo "Dirección" del detalle plegado.
    expect(within(card).getAllByText("Calle Uno 111").length).toBeGreaterThan(0);
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
      screen.queryByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G2/ }),
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
      within(panelDetalle()).getByText("Activa Dos"),
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
      screen.queryByRole("region", { name: "Recoger por número de guía o escaneo" }),
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
      screen.queryByRole("article", { name: /Gestionar orden REM-G1/ }),
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
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
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
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).not.toHaveAttribute("tabindex");
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).not.toHaveAttribute("tabindex");
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
      screen.getByRole("article", { name: /Gestionar orden REM-GA/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-GB/ }),
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
      screen.queryByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();

    await user.clear(input);

    // Sin búsqueda: reaparecen todas las guías de ambos grupos.
    const recoger = screen.getByRole("region", { name: "Por recoger" });
    expect(within(recoger).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(recoger).getByText(/REM-R2/)).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
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
      screen.queryByRole("article", { name: /Gestionar orden REM-REPARTO/ }),
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
      screen.getByRole("article", { name: /Gestionar orden REM-UNO/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-DOS/ }),
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
      screen.getByRole("article", { name: /Gestionar orden REM-DOS/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-UNO/ }),
    ).toBeInTheDocument();
    // Control: g3 (ni coincide ni está en gestión) SÍ se filtra → prueba que el filtro
    // actúa y que la permanencia de g2 se debe a la salvaguarda, no a falta de filtro.
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-TRES/ }),
    ).toBeNull();

    // Y la parada de g2 sigue en el mapa junto a la de g1 (no la de g3).
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id).sort()).toEqual(["g1", "g2"]);
  });

  // ---------------- Feature 117: filtro por cantón y distrito ----------------
  // Compone en AND con el buscador (114) sobre las MISMAS listas visibles; el mapa y el
  // panel reflejan el conjunto filtrado (R14) y la orden en gestión nunca se oculta (R10).

  it("117/R1: renderiza los selects de Cantón y Distrito en el módulo del mensajero", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-R1" })],
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getByRole("combobox", { name: "Filtrar por cantón" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Filtrar por distrito" }),
    ).toBeInTheDocument();
  });

  it("117/R1: en modo foco NO se renderiza el filtro cantón/distrito (no hay lista que filtrar)", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
      ordenEnGestionId: "g1",
    });

    expect(
      screen.queryByRole("combobox", { name: "Filtrar por cantón" }),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Filtrar por distrito" }),
    ).toBeNull();
  });

  it("117/R2: las opciones de Cantón usan la etiqueta 'Cantón (Provincia)', deduplicadas y ordenadas", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          cantonNombre: "Alajuela",
          provinciaNombre: "Alajuela",
        }),
        // Duplicado de Escazú: no debe producir una segunda opción.
        makeAsignacion({
          id: "g3",
          numRemision: "REM-G3",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
        }),
      ],
    });

    await user.click(screen.getByRole("combobox", { name: "Filtrar por cantón" }));
    const listbox = await screen.findByRole("listbox");
    // Centinela "todos" + dos cantones únicos, ordenados alfabéticamente.
    const opciones = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opciones).toEqual([
      "Todos los cantones",
      "Alajuela (Alajuela)",
      "Escazú (San José)",
    ]);
  });

  it("117/R3: sin cantón elegido, el select de Distrito está deshabilitado", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getByRole("combobox", { name: "Filtrar por distrito" }),
    ).toBeDisabled();
  });

  it("117/R4: al elegir un cantón, Distrito ofrece solo los distritos de ese cantón", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          cantonNombre: "Central",
          distritoNombre: "Merced",
        }),
        makeAsignacion({
          id: "g3",
          numRemision: "REM-G3",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    await user.click(screen.getByRole("combobox", { name: "Filtrar por distrito" }));
    const listbox = await screen.findByRole("listbox");
    const opciones = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Solo los distritos de Central (no "San Rafael" de Escazú), más el centinela.
    expect(opciones).toEqual(["Todos los distritos", "Carmen", "Merced"]);
  });

  it("117/R5: cambiar de cantón resetea el distrito a 'todos'", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          cantonNombre: "Central",
          distritoNombre: "Merced",
        }),
        makeAsignacion({
          id: "g3",
          numRemision: "REM-G3",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    // Cantón Central + distrito Carmen ⇒ solo g1 visible.
    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    await elegirEnSelect(user, "Filtrar por distrito", "Carmen");
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();

    // Cambiar de cantón resetea el distrito: vuelve el placeholder y el filtro de
    // distrito deja de aplicar (g3 de Escazú aparece pese a no ser "Carmen").
    await elegirEnSelect(user, "Filtrar por cantón", "Escazú (San José)");
    const distrito = screen.getByRole("combobox", { name: "Filtrar por distrito" });
    expect(within(distrito).getByText("Todos los distritos")).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G3/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();
  });

  it("117/R6: filtrar por cantón+distrito muestra solo las coincidentes y excluye distrito nulo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          cantonNombre: "Central",
          distritoNombre: "Merced",
        }),
        makeAsignacion({
          id: "g3",
          numRemision: "REM-G3",
          cantonNombre: "Central",
          distritoNombre: null,
        }),
        makeAsignacion({
          id: "g4",
          numRemision: "REM-G4",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    await elegirEnSelect(user, "Filtrar por distrito", "Carmen");

    // Solo g1 (Central/Carmen). g2 (otro distrito), g3 (distrito nulo) y g4 (otro cantón) fuera.
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    for (const rem of ["REM-G2", "REM-G3", "REM-G4"]) {
      expect(
        screen.queryByRole("article", { name: new RegExp(`Gestionar orden ${rem}`) }),
      ).toBeNull();
    }
  });

  it("117/R8: 'Limpiar filtros' restaura la lista completa y limpia ambos selects", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    await elegirEnSelect(user, "Filtrar por distrito", "Carmen");
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    // Reaparecen todas; los selects vuelven a su placeholder y el distrito se deshabilita.
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
    const canton = screen.getByRole("combobox", { name: "Filtrar por cantón" });
    expect(within(canton).getByText("Todos los cantones")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Filtrar por distrito" }),
    ).toBeDisabled();
  });

  it("117/R8: elegir 'Todos los cantones' desde el desplegable restaura la lista completa", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();

    await elegirEnSelect(user, "Filtrar por cantón", "Todos los cantones");

    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeInTheDocument();
  });

  it("117/R9: 'Limpiar filtros' solo aparece cuando hay un filtro activo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Central",
        }),
      ],
    });

    // Sin filtro: no está disponible.
    expect(
      screen.queryByRole("button", { name: "Limpiar filtros" }),
    ).toBeNull();

    // Con un cantón elegido: aparece.
    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    expect(
      screen.getByRole("button", { name: "Limpiar filtros" }),
    ).toBeInTheDocument();

    // Al limpiar: vuelve a desaparecer.
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(
      screen.queryByRole("button", { name: "Limpiar filtros" }),
    ).toBeNull();
  });

  it("117/R10: la orden EN GESTIÓN sigue visible (lista y mapa) aunque el filtro no la incluya", async () => {
    const user = userEvent.setup();
    // `bloqueado` mantiene la VISTA COMPLETA (grilla + mapa) con el puntero fijado, sin
    // colapsar a foco: es el escenario donde la salvaguarda R10 es observable.
    renderModule({
      bloqueado: true,
      ordenEnGestionId: "g2",
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-UNO",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
          secuenciaRuta: 1,
        }),
        // EN GESTIÓN, en OTRO cantón: no coincide con el filtro pero no se oculta.
        makeAsignacion({
          id: "g2",
          numRemision: "REM-DOS",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
          secuenciaRuta: 2,
        }),
        // Control: otro cantón y NO en gestión ⇒ se filtra.
        makeAsignacion({
          id: "g3",
          numRemision: "REM-TRES",
          cantonNombre: "Cartago",
          provinciaNombre: "Cartago",
          distritoNombre: "Oriental",
          secuenciaRuta: 3,
        }),
      ],
    });

    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");

    // g1 coincide; g2 (en gestión) permanece pese a no coincidir; g3 (control) se va.
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-UNO/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-DOS/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-TRES/ }),
    ).toBeNull();

    // El mapa refleja lo mismo: g1 + g2 (salvaguarda), no g3.
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id).sort()).toEqual(["g1", "g2"]);
  });

  it("117/R11: filtro sin coincidencias muestra el mensaje 'coincide con el filtro' (distinto del vacío base)", async () => {
    const user = userEvent.setup();
    renderModule({
      // Central sale de "Por recoger"; Escazú de "En reparto": así elegir un cantón
      // vacía SIEMPRE el grupo contrario y se ve el mensaje de "sin coincidencias".
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-R1",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
      ],
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    // Central ⇒ "En reparto" (solo Escazú) queda sin coincidencias.
    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");
    const reparto = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    expect(
      within(reparto).getByText("Ninguna guía en reparto coincide con el filtro."),
    ).toBeInTheDocument();
    // Distinguible del vacío base y del "sin resultados" del buscador.
    expect(screen.queryByText("No hay órdenes en reparto.")).toBeNull();
    expect(
      screen.queryByText("Ninguna guía en reparto coincide con la búsqueda."),
    ).toBeNull();

    // Escazú ⇒ "Por recoger" (solo Central) queda sin coincidencias.
    await elegirEnSelect(user, "Filtrar por cantón", "Escazú (San José)");
    const recoger = screen.getByRole("region", { name: "Por recoger" });
    expect(
      within(recoger).getByText("Ninguna guía por recoger coincide con el filtro."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay órdenes por recoger.")).toBeNull();
  });

  it("117/R14: con filtro activo, panel de detalle y mapa reflejan el conjunto filtrado", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          destinatario: "Uno",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
          secuenciaRuta: 1,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          destinatario: "Dos",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
          secuenciaRuta: 2,
        }),
      ],
    });

    // Por defecto el panel muestra la PRIMERA (g1).
    expect(
      within(panelDetalle()).getByText("Uno"),
    ).toBeInTheDocument();

    // Al filtrar por Escazú, el conjunto filtrado es [g2]: el panel y el mapa lo reflejan.
    await elegirEnSelect(user, "Filtrar por cantón", "Escazú (San José)");
    expect(
      within(panelDetalle()).getByText("Dos"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeNull();

    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id)).toEqual(["g2"]);
  });

  it("117/R12 + 114: el filtro cantón/distrito se COMPONE en AND con el buscador de texto", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          destinatario: "Ana",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-G2",
          destinatario: "Beto",
          cantonNombre: "Central",
          distritoNombre: "Carmen",
        }),
        makeAsignacion({
          id: "g3",
          numRemision: "REM-G3",
          destinatario: "Ana",
          cantonNombre: "Escazú",
          provinciaNombre: "San José",
          distritoNombre: "San Rafael",
        }),
      ],
    });

    // Buscador "ana" ⇒ {g1, g3}; filtro cantón Central ⇒ {g1, g2}; AND ⇒ solo g1.
    await user.type(
      screen.getByRole("searchbox", { name: "Buscar guías" }),
      "ana",
    );
    await elegirEnSelect(user, "Filtrar por cantón", "Central (San José)");

    expect(
      screen.getByRole("article", { name: /Gestionar orden REM-G1/ }),
    ).toBeInTheDocument();
    // g2 cae por el buscador (Beto); g3 cae por el filtro (Escazú).
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G2/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: /Gestionar orden REM-G3/ }),
    ).toBeNull();
  });
});

// Feature 160 (T18, R18/R19/R24) — el conteo de intentos en el portal del mensajero.
// Dos sitios y un mismo criterio: DATO (no chip, D6). En la card POS va en el bloque de
// campos, junto a Destinatario/Producto; en `AsignacionDetalle` va como un `Campo` más
// del detalle (mismo `<dt>`/`<dd>` que Nº Guía, Nombre, Teléfono o Producto), que es lo
// que ve el mensajero tanto en "por recoger" como en el desplegable de la card.
describe("MisAsignaciones — intentos de entrega (feature 160)", () => {
  it("R18/R24: la card POS de 'por gestionar' muestra el dato con 2 intentos", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", intentosEntrega: 2 }),
      ],
    });
    const card = cardDe("REM-G1");
    expect(within(card).getAllByText("Intentos: 2").length).toBeGreaterThan(0);
  });

  it("R19: la card con 0 intentos LO MUESTRA igual (no se omite)", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", intentosEntrega: 0 }),
      ],
    });
    const card = cardDe("REM-G1");
    expect(within(card).getAllByText("Intentos: 0").length).toBeGreaterThan(0);
    expect(within(card).queryByText("Intentos: 2")).toBeNull();
  });

  it("R19: sin el campo (DTO viejo) la card muestra 0", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });
    expect(
      within(cardDe("REM-G1")).getAllByText("Intentos: 0").length,
    ).toBeGreaterThan(0);
  });

  it("R24: cada card lleva SU número, no el de la vecina", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", intentosEntrega: 3 }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", intentosEntrega: 0 }),
      ],
    });
    expect(
      within(cardDe("REM-G1")).getAllByText("Intentos: 3").length,
    ).toBeGreaterThan(0);
    expect(within(cardDe("REM-G1")).queryByText("Intentos: 0")).toBeNull();
    expect(
      within(cardDe("REM-G2")).getAllByText("Intentos: 0").length,
    ).toBeGreaterThan(0);
  });

  it("R18: el detalle lo presenta como un CAMPO más (<dt>/<dd>), como sus hermanos", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", intentosEntrega: 4 }),
      ],
    });
    const card = cardDe("REM-G1");
    const etiqueta = within(card).getByText("Intentos");
    expect(etiqueta.tagName).toBe("DT");
    // Mismo envoltorio que un campo hermano cualquiera del detalle.
    expect(within(card).getByText("Producto").tagName).toBe("DT");
    const valor = etiqueta.parentElement?.querySelector("dd");
    expect(valor?.textContent).toBe("4");
  });

  it("R24: 'por recoger' (PorAceptarSection.renderDetalle) también muestra el dato", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", intentosEntrega: 1 }),
      ],
    });
    const region = screen.getByRole("region", { name: "Por recoger" });
    const etiqueta = within(region).getByText("Intentos");
    expect(etiqueta.tagName).toBe("DT");
    expect(etiqueta.parentElement?.querySelector("dd")?.textContent).toBe("1");
  });

  it("R24: 'por recoger' con 0 intentos también lo muestra", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", intentosEntrega: 0 }),
      ],
    });
    const region = screen.getByRole("region", { name: "Por recoger" });
    const etiqueta = within(region).getByText("Intentos");
    expect(etiqueta.parentElement?.querySelector("dd")?.textContent).toBe("0");
  });

  it("R32/D6: el dato NO vive en la fila de marcas informativas (que son badges)", () => {
    // Orden con AMBAS marcas: la fila de marcas existe y se puede identificar.
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          secuenciaRuta: null,
          marcarLuego: true,
          intentosEntrega: 2,
        }),
      ],
    });
    const card = cardDe("REM-G1");
    const marca = within(card).getByText("Pendiente de optimizar");
    const filaMarcas = marca.parentElement as HTMLElement;
    // Es de verdad la fila de marcas: contiene las DOS marcas de excepción.
    expect(within(filaMarcas).getByText("Gestionar más tarde")).toBeInTheDocument();
    // ...y NO el conteo: los intentos son un dato, no una marca de excepción (D6).
    expect(filaMarcas.textContent ?? "").not.toContain("Intentos");
    // El dato sigue en la card, en el bloque de campos.
    expect(within(card).getAllByText("Intentos: 2").length).toBeGreaterThan(0);
  });

  it("R32: sin ninguna marca, la fila de marcas sigue sin renderizarse (sin hueco)", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-G1",
          secuenciaRuta: 1,
          marcarLuego: false,
          intentosEntrega: 2,
        }),
      ],
    });
    const card = cardDe("REM-G1");
    expect(within(card).queryByText("Pendiente de optimizar")).toBeNull();
    // El badge, no el toggle homónimo: desde el rediseño ux el control "Gestionar más
    // tarde" vive DENTRO de la card (en su pie), así que se descarta el texto del botón.
    expect(
      within(card)
        .queryAllByText("Gestionar más tarde")
        .filter((el) => el.closest("button") === null),
    ).toHaveLength(0);
    // Y el dato de intentos se muestra igual: no dependía de esa fila.
    expect(within(card).getAllByText("Intentos: 2").length).toBeGreaterThan(0);
  });

  it("R20: el dato no trae el umbral ('de N')", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", intentosEntrega: 2 }),
      ],
    });
    const dato = within(cardDe("REM-G1")).getAllByText("Intentos: 2")[0];
    expect(dato.textContent).toBe("Intentos: 2");
  });
});
