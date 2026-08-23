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

import { RepartoModule } from "@/app/(app)/mis-asignaciones/_components/RepartoModule";
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
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import {
  bloqueoConVencido,
  bloqueoDe,
  bloqueoPorAcumular,
} from "@/tests/fixtures/bloqueo-cierre";

// Feature 36 (T15-T17) / rediseño 63 (pedido humano) — pantalla de REPARTO del mensajero.
// Se mockean las Server Actions (escoger / gestionar / liberar), el toast y el router
// (refresh) para afirmar la composición y los envíos sin DB ni sesión. "En reparto" ya NO
// usa modal: es un PANEL inline (region "Detalle de la orden") con la PRIMERA orden en
// detalle por defecto.
//
// 2026-07-31 (decisión del humano): este archivo era `MisAsignacionesModule.test.tsx` y
// cubría los DOS apartados del portal. La mitad "Por recoger" (listado, banner, escáner e
// input de guía) se mudó con su pantalla a `RecogerModule.test.tsx`; aquí queda lo que
// vive en Reparto. `recogerAsignaciones` se sigue mockeando porque el mock del módulo de
// actions es completo (si faltara, el import real arrastraría Prisma a jsdom).
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
}));

// Feature 227 (T3.4): el panel de gestión monta el HILO de notas y lo lee al abrir la orden.
// Son Server Actions (`"use server"` con Prisma detrás) y se mockean por el mismo motivo que
// las de arriba. Hilo vacío y de solo lectura = el mínimo DOM que no interfiere con lo que
// este archivo mide.
vi.mock("@/lib/actions/orden-notas", () => ({
  listarNotasOrden: vi
    .fn()
    .mockResolvedValue({ status: "ok", notas: [], puedeEscribir: false }),
  publicarNotaOrden: vi.fn(),
  borrarNotaOrden: vi.fn(),
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
    .getAllByRole("article", { name: /^Orden / })
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
  // Feature 265 (R45): `null` = no consta quien ordeno las paradas. Es lo que exige el tipo,
  // no un test que fallara: sin marca, la pantalla no dice nada del orden.
  secuenciaFuente: null,
  paradasSinOptimizar: 0,
  trazado: null,
  tramoSiguiente: null,
};

function renderModule(props?: Partial<Parameters<typeof RepartoModule>[0]>) {
  return render(
    <RepartoModule
      porGestionar={props?.porGestionar ?? []}
      // Feature 235 (R18): el tercer grupo llega ya separado del servidor. Los escenarios de este
      // archivo no tienen ordenes en ayuda; los que si, viven en `RepartoAyuda.test.tsx`.
      conAyuda={props?.conAyuda ?? []}
      ordenEnGestionId={props?.ordenEnGestionId ?? null}
      ruta={props?.ruta ?? RUTA_VIGENTE}
      bloqueo={props?.bloqueo ?? SIN_BLOQUEO}
    />,
  );
}

/** El panel de detalle grande e inline (region con nombre accesible). */
function panelDetalle() {
  return screen.getByRole("region", { name: "Detalle de la orden" });
}

/**
 * El acceso a la recogida por guía/escaneo (el disparador de la tarjeta plegada). Aquí solo
 * se usa para comprobar su AUSENCIA: la recogida se mudó a `/mis-asignaciones/recoger` y
 * esta pantalla no debe volver a montarla.
 */
const accesoRecogida = () =>
  screen.queryByRole("button", { name: "Recoger paquete" });

/**
 * Card de una remisión: el `<article>` de `PosOrderCard`, con `aria-label`
 * "Orden <rem> · <dest>". Rama ux (pedido humano): la card ya NO selecciona al tocarla;
 * llevar su orden al panel pasa por el botón "Gestionar" del pie y su confirmación
 * (ver `gestionarDesdeCard`).
 */
function cardDe(numRemision: string): HTMLElement {
  return screen.getByRole("article", {
    name: new RegExp(`Orden ${numRemision}`),
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
 * Rediseño ux: el bloque de verificación de guía arranca CERRADO; lo abre el CTA
 * "Gestionar esta orden" (fijo al pie del panel). Todo test que vaya al gate pasa por aquí.
 * Devuelve el panel, ya con el gate montado.
 */
/**
 * Lleva la orden de una card al panel de detalle por la vía nueva: botón "Gestionar" del
 * pie de la card + confirmación en el modal ("puede cambiar tu ruta de reparto").
 */
async function gestionarDesdeCard(
  user: ReturnType<typeof userEvent.setup>,
  numRemision: string,
) {
  await user.click(
    // El identificador de la card puede venir completo ("REM-G1 · Ana Pérez"); el botón se
    // localiza por su prefijo, dentro de esa card.
    within(cardDe(numRemision)).getByRole("button", {
      name: /^Gestionar la orden /,
    }),
  );
  await user.click(await screen.findByRole("button", { name: "Aceptar" }));
}

async function abrirGestion(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const panel = panelDetalle();
  await user.click(
    within(panel).getByRole("button", { name: "Gestionar esta orden" }),
  );
  return panel;
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
  // La orden que YA está en el panel tiene su botón "Gestionar" deshabilitado (no hay nada
  // que llevar: es la que se está gestionando), así que solo se pasa por la card cuando hace
  // falta cambiar de orden.
  const boton = within(cardDe(card)).getByRole("button", {
    name: /^Gestionar la orden /,
  });
  if (!(boton as HTMLButtonElement).disabled) await gestionarDesdeCard(user, card);
  const panel = await abrirGestion(user);
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

describe("RepartoModule", () => {
  // 2026-07-31 (decisión del humano) — CORTE: Reparto es UNA pantalla, no dos apartados.
  // El caso que exigía "los DOS apartados" (R10) se invierte: la superficie de recogida se
  // mudó a `/mis-asignaciones/recoger` y aquí no debe quedar ni rastro. Es una AUSENCIA, y
  // las ausencias se rompen sin que nadie se entere: si un merge devuelve el listado o el
  // escáner a esta pantalla, el escáner vuelve a quedar enterrado bajo el panel de gestión
  // —exactamente el problema que el corte resolvió— y falla aquí, no en la calle.
  it("Corte: Reparto monta SU apartado y ninguna superficie de recogida", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();
    // Ni el listado, ni la tarjeta de recogida, ni su input.
    expect(screen.queryByRole("region", { name: "Por recoger" })).toBeNull();
    expect(accesoRecogida()).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recoger por número de guía o escaneo" }),
    ).toBeNull();
    // OJO: NO se afirma "ningún escáner en la pantalla". Reparto tiene el suyo, dentro del
    // gate de verificación de guía del panel de gestión (`VerificarGuiaGate`, feature 98),
    // y es legítimo: verifica la guía que se va a gestionar, no recoge nada. La ausencia
    // que este caso protege es la de la superficie de RECOGIDA, identificada por su
    // tarjeta y su disparador.
  });

  it("Sin órdenes en reparto: muestra el aviso y NO renderiza el panel de detalle", () => {
    renderModule({ porGestionar: [] });

    const region = screen.getByRole("region", { name: "En reparto / por gestionar" });
    expect(within(region).getByText("No hay órdenes en reparto.")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
  });

  it("Rediseño: cards en GRILLA y la PRIMERA orden en el PANEL de detalle por default", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    const region = screen.getByRole("region", { name: "En reparto / por gestionar" });
    // Una card seleccionable por orden (button con aria-label descriptivo).
    expect(
      within(region).getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("article", { name: /Orden REM-G2/ }),
    ).toBeInTheDocument();
    // El panel inline muestra por defecto la PRIMERA orden (sin fijar el puntero).
    expect(
      within(panelDetalle()).getByText("Uno"),
    ).toBeInTheDocument();
    expect(escogerMock).not.toHaveBeenCalled();
    // Feature 98 + rediseño ux: el gate ya no está montado de entrada (la sección arranca
    // cerrada), pero el panel sigue exigiéndolo antes de gestionar: al abrirla con
    // "Gestionar esta orden" aparece el input "Número de guía" + el botón "Gestionar".
    expect(
      within(panelDetalle()).queryByLabelText("Número de guía"),
    ).toBeNull();
    await abrirGestion(user);
    expect(
      within(panelDetalle()).getByLabelText("Número de guía"),
    ).toBeInTheDocument();
    expect(
      within(panelDetalle()).getByRole("button", { name: "Gestionar" }),
    ).toBeInTheDocument();
  });

  it("Rediseño: 'Gestionar' en la card, tras CONFIRMAR, lleva la orden al PANEL de detalle", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    // Por defecto la primera; al gestionar la segunda (con confirmación), el panel la refleja.
    expect(within(panelDetalle()).getByText("Uno")).toBeInTheDocument();
    await gestionarDesdeCard(user, "REM-G2");

    expect(within(panelDetalle()).getByText("Dos")).toBeInTheDocument();
    // Cambiar de orden en el panel NO fija el puntero 1-a-1: eso sigue siendo del gate.
    expect(escogerMock).not.toHaveBeenCalled();
  });

  it("Pedido humano: la orden que YA se está gestionando tiene 'Gestionar' DESHABILITADO", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    const botonDe = (rem: string) =>
      within(cardDe(rem)).getByRole("button", { name: /^Gestionar la orden / });

    // Por defecto el panel muestra la primera: su botón no ofrece nada.
    expect(botonDe("REM-G1")).toBeDisabled();
    expect(botonDe("REM-G2")).toBeEnabled();

    // Al llevar la segunda al panel, se invierte.
    await gestionarDesdeCard(user, "REM-G2");
    expect(within(panelDetalle()).getByText("Dos")).toBeInTheDocument();
    expect(botonDe("REM-G2")).toBeDisabled();
    expect(botonDe("REM-G1")).toBeEnabled();
  });

  it("Pedido humano: el modal AVISA de que la ruta puede cambiar y CANCELAR no toca el panel", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
    });

    await user.click(
      within(cardDe("REM-G2")).getByRole("button", {
        name: "Gestionar la orden REM-G2",
      }),
    );
    expect(
      await screen.findByText(/ruta de reparto puede cambiar/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    // Sin confirmación no pasa nada: el panel sigue en la primera orden.
    expect(within(panelDetalle()).getByText("Uno")).toBeInTheDocument();
    expect(within(panelDetalle()).queryByText("Dos")).toBeNull();
  });

  // Pedido humano (rama ux): tocar la card ya NO cambia el detalle mostrado; para eso está
  // el botón "Gestionar" del pie, con su confirmación.
  it("Rediseño: el click en el CUERPO de la card NO cambia el PANEL de detalle", async () => {
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

    expect(within(panelDetalle()).getByText("Uno")).toBeInTheDocument();
    expect(within(panelDetalle()).queryByText("Dos")).toBeNull();
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
      screen.queryByRole("article", { name: /Orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: /Orden REM-G2/ }),
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
    const panel = await abrirGestion(user);
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

    const panel = await abrirGestion(user);
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
    const panel = await abrirGestion(user);
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
    // Feature 213 (R1/R15): el método ya no se elige en un selector único sino en la LÍNEA 1 del
    // desglose, y viaja como par `pagoMetodo`/`pagoMonto`. Lo que este caso vigila desde la 36
    // —que el método SALE en el envío— se sigue vigilando, en la forma que ahora tiene.
    await elegirEnSelect(user, "Método de pago línea 1", "Efectivo");
    await subirEvidencia(user, "Foto de evidencia de entrega");

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("entregada");
    expect(fd.get("ordenId")).toBe("g1");
    expect(fd.get("montoRecibido")).toBe("150");
    expect(fd.getAll("pagoMetodo")).toEqual(["efectivo"]);
    expect(fd.getAll("pagoMonto")).toEqual(["150"]);
    expect(fd.get("metodoPago")).toBeNull(); // R15: la forma escalar ya no sale del panel
    expect(fd.get("evidencia")).toBeInstanceOf(File);
  });

  it("ENTREGAR sin cobro (montoCobrar 0): no monta el editor y envía monto 0 SIN líneas", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1", montoCobrar: 0 })],
    });

    await iniciarGestion(user, { card: "REM-G1 · Ana Pérez", resultado: "Entregar" });

    // Sin cobro: no se pide método de pago (feature 213/R16: tampoco se monta el editor).
    expect(screen.queryByRole("combobox", { name: "Método de pago" })).toBeNull();
    expect(screen.queryAllByRole("group", { name: /^Línea de pago/ })).toHaveLength(0);

    await subirEvidencia(user, "Foto de evidencia de entrega");
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    expect(fd.get("resultado")).toBe("entregada");
    expect(fd.get("montoRecibido")).toBe("0");
    // Feature 213 (R16): el `"efectivo"` que este panel FORZABA aquí se borró. Una entrega sin
    // cobro son CERO líneas y ningún escalar; el borde ya acepta esa forma (reglas 3 y 4).
    expect(fd.getAll("pagoMetodo")).toHaveLength(0);
    expect(fd.get("metodoPago")).toBeNull();
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
    // FEATURE 271 (T9.6) — `getAllByRole` y no `getByRole`. El singular LANZA en cuanto hay más de
    // un `role="alert"` en la pantalla, y aquí ya convivían dos escenarios que lo producen
    // (mensajero bloqueado + ruta desactualizada). Con el aviso de bloqueo nuevo el caso se vuelve
    // más frecuente, así que se busca EL QUE INTERESA en vez de exigir que sea el único.
    expect(
      screen.getAllByRole("alert").map((a) => a.textContent).join(" | "),
    ).toContain("causa requerida");
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
    await elegirEnSelect(user, "Método de pago línea 1", "Efectivo");
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
    const panel = await abrirGestion(user);
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
    await elegirEnSelect(user, "Método de pago línea 1", "Efectivo");
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
      screen.getByRole("article", { name: /Orden REM-G2/ }),
    ).toBeInTheDocument();
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id)).toEqual(["g1"]);
  });

  // ---------------- Feature 111 (R12/R14) -> FEATURE 271 (T9.2): bloqueo del mensajero ---------
  //
  // ⚠️ EL AVISO CAMBIÓ DOS VECES EN TRES DÍAS, Y LA SEGUNDA DESHACE MEDIA PRIMERA.
  //   · Hasta el 2026-08-19 decía «No puedes gestionar NI RECIBIR NUEVAS ASIGNACIONES…».
  //   · El 20/08 (feature 241) se le quitó lo de recibir: la regla firmada declaraba la asignación
  //     exenta de todo bloqueo, y prohibir de más hace que el mensajero deje de intentar cosas que
  //     sí puede hacer.
  //   · El 23/08 (esta ficha, palabra del humano) se REVIRTIÓ esa mitad: acumular dos cierres —o
  //     arrastrar uno que espera a que él lo reenvíe— bloquea TAMBIÉN recibir trabajo nuevo, y sin
  //     distinguir reparto de recolección.
  // La dirección del error importa más que el error: ahora el aviso prohíbe exactamente lo que el
  // servidor rechaza, ni una cosa más ni una menos.
  //
  // ⚠️ LOS LITERALES SIGUEN SIENDO LITERALES —nunca `toHaveTextContent(avisoBloqueo(d))`—: un texto
  // comparado contra la función que lo genera está SIEMPRE VERDE y no afirma nada. La fuente única
  // del texto es `lib/constants/bloqueo-mensajero.ts`; la de este archivo, la mano.

  it("271/§10.2 caso 1 · bloqueado por ACUMULAR (N=2, V=0), con la fecha de la JORNADA", () => {
    renderModule({
      bloqueo: bloqueoPorAcumular("2026-08-21"),
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    // La fecha es la de la JORNADA que el mensajero trabajó (21), no la del nacimiento del cierre
    // (22): el corte corre en la madrugada siguiente, así que todo vencido nace un día por delante.
    // Y este caso NO lleva puntero a «Cierre del día»: sus dos cierres están enviados y el
    // mensajero no tiene nada que hacer; mandarlo allí sería mandarlo a buscar un botón que no
    // existe.
    expect(
      screen.getAllByRole("alert").map((a) => a.textContent).join(" | "),
    ).toContain(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
  });

  it("271/§10.2 caso 3 · las DOS cosas a la vez (N=2, V=1), con el puntero al final", () => {
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getAllByRole("alert").map((a) => a.textContent).join(" | "),
    ).toContain(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto. Ve a «Cierre del día» para enviarlo a aprobación.",
    );
  });

  it("271/R60 · sin jornada fiable la fecha DESAPARECE entera y el resto se lee igual", () => {
    renderModule({
      bloqueo: bloqueoPorAcumular(null),
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.getAllByRole("alert").map((a) => a.textContent).join(" | "),
    ).toContain(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo.",
    );
  });

  it("271/R51 · el aviso NO promete recibir asignaciones ni recoger en tiendas", () => {
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    const textos = screen.getAllByRole("alert").map((a) => a.textContent).join(" | ");
    expect(textos).not.toMatch(/seguir recibiendo asignaciones/i);
    expect(textos).not.toMatch(/seguir recogiendo en tiendas/i);
    expect(textos).not.toMatch(/sí puedes/i);
  });

  it("271/R5 · un solo cierre YA enviado (N=1, V=0) NO bloquea nada", () => {
    // La mitad de la regla del 2026-08-20 que esta ficha CONSERVA: ese mensajero ya hizo lo suyo y
    // espera al administrador. Sin aviso, y las cards siguen siendo gestionables.
    renderModule({
      bloqueo: bloqueoDe({ n: 1, v: 0 }),
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2" }),
      ],
    });

    expect(screen.queryByRole("alert")).toBeNull();
    // Se mira la SEGUNDA: la primera es la que el panel abre por defecto y su botón está
    // apagado por eso —llevaría al panel donde ya está—, no por ningún bloqueo.
    expect(
      screen.getByRole("button", { name: /Gestionar la orden REM-G2/ }),
    ).toBeEnabled();
  });

  it("R12: bloqueado muestra el aviso accionable de BLOQUEO", () => {
    renderModule({
      bloqueo: bloqueoConVencido(),
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    // FEATURE 271 (T9.6): en plural, y se afirma sobre el que interesa.
    expect(
      screen.getAllByRole("alert").map((a) => a.textContent).join(" | "),
    ).toContain(
      "Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Ve a «Cierre del día» para enviarlo a aprobación.",
    );
  });

  it("R12: sin bloqueo NO muestra el aviso de bloqueo total", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    expect(
      screen.queryByText(/no puedes entregar, cobrar ni recibir trabajo nuevo/i),
    ).not.toBeInTheDocument();
  });

  // El caso gemelo —bloqueado oculta los controles de RECOGIDA— se mudó con su pantalla a
  // `RecogerModule.test.tsx`: aquí ya no hay recogida que ocultar.

  it("R14: bloqueado deshabilita las cards de 'En reparto' y NO renderiza el panel de gestión (escoger/gestionar)", () => {
    renderModule({
      bloqueo: bloqueoConVencido(),
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
      within(region).getByRole("article", { name: /Orden REM-G1/ }),
    ).not.toHaveAttribute("tabindex");
    expect(
      within(region).getByRole("article", { name: /Orden REM-G2/ }),
    ).not.toHaveAttribute("tabindex");
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
      bloqueo: bloqueoConVencido(),
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
      screen.queryByRole("article", { name: /Orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: /Orden REM-G2/ }),
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

    const panel = await abrirGestion(user);
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

  // R8 (ocultar "Por recoger" en foco) queda SIN OBJETO tras el corte del 2026-07-31: esa
  // superficie ya no vive en esta pantalla, así que no hay nada que el foco deba ocultar.
  // Lo que R8 protegía —que en foco no queden distracciones— lo cubren los casos de R6/R7
  // (grilla y mapa ocultos) de arriba y el caso "Corte" del primer describe.

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
    const porGestionar = [
      makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
      makeAsignacion({ id: "g2", numRemision: "REM-G2", secuenciaRuta: 2 }),
    ];
    const { rerender } = render(
      <RepartoModule
        porGestionar={porGestionar}
        conAyuda={[]}
        ordenEnGestionId="g2"
        ruta={RUTA_VIGENTE}
        bloqueo={SIN_BLOQUEO}
      />,
    );

    // En foco: grilla y mapa ocultos.
    expect(
      screen.queryByRole("article", { name: /Orden REM-G1/ }),
    ).toBeNull();
    expect(screen.queryByTestId("ruta-mapa")).toBeNull();

    // Puntero liberado (gestión finalizada/cancelada) → vuelve la vista completa.
    rerender(
      <RepartoModule
        porGestionar={porGestionar}
        conAyuda={[]}
        ordenEnGestionId={null}
        ruta={RUTA_VIGENTE}
        bloqueo={SIN_BLOQUEO}
      />,
    );

    expect(
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-G2/ }),
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
      bloqueo: bloqueoConVencido(),
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Uno" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Dos" }),
      ],
      ordenEnGestionId: "g2",
    });

    // El aviso de bloqueo total tiene precedencia. FEATURE 271 (T9.6): en plural.
    expect(
      screen.getAllByRole("alert").map((a) => a.textContent).join(" | "),
    ).toContain("no puedes entregar, cobrar ni recibir trabajo nuevo");
    // NO hay foco: las cards siguen en la grilla (deshabilitadas) y NO se monta el panel.
    expect(
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).not.toHaveAttribute("tabindex");
    expect(
      screen.getByRole("article", { name: /Orden REM-G2/ }),
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

  // 2026-07-31: el buscador ya no barre DOS grupos — Reparto filtra el suyo y "Por
  // recoger" tiene el propio en su pantalla (`RecogerModule.test.tsx`). Lo que sigue
  // vigente es el comportamiento del campo: filtrar, limpiar y distinguir "sin resultados"
  // del vacío sin búsqueda.
  it("114/R1: renderiza un campo de búsqueda de guías (searchbox) sobre el grupo en reparto", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G1" })],
    });

    // Rol accesible (searchbox) + etiqueta accesible (label "Buscar guías").
    expect(buscador()).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar guías")).toBeInTheDocument();
    // El grupo sigue presente (el buscador va por encima, no lo reemplaza).
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

  it("114/R2: teclear texto filtra por guía / remisión / destinatario", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-GA", destinatario: "Ana Torres" }),
        makeAsignacion({ id: "g2", numRemision: "REM-GB", destinatario: "Carlos" }),
      ],
    });

    await user.type(buscador(), "ana");

    // "En reparto": queda g1 (Ana Torres); se va g2 (Carlos).
    expect(
      screen.getByRole("article", { name: /Orden REM-GA/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Orden REM-GB/ }),
    ).toBeNull();
  });

  it("114/R5: limpiar la búsqueda restaura TODAS las guías del grupo", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Ana" }),
        makeAsignacion({ id: "g2", numRemision: "REM-G2", destinatario: "Beto" }),
      ],
    });

    const input = buscador();
    await user.type(input, "beto");
    expect(
      screen.queryByRole("article", { name: /Orden REM-G1/ }),
    ).toBeNull();
    expect(
      screen.getByRole("article", { name: /Orden REM-G2/ }),
    ).toBeInTheDocument();

    await user.clear(input);

    // Sin búsqueda: reaparecen todas las guías del grupo.
    expect(
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-G2/ }),
    ).toBeInTheDocument();
  });

  it("114/R6: sin coincidencias muestra 'sin resultados', distinto del vacío sin búsqueda", async () => {
    const user = userEvent.setup();
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-G1", destinatario: "Beto" }),
      ],
    });

    await user.type(buscador(), "zzzinexistente");

    const reparto = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    expect(
      within(reparto).getByText(
        "Ninguna guía en reparto coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();

    // DISTINGUIBLE del vacío sin búsqueda: ese texto no aparece.
    expect(screen.queryByText("No hay órdenes en reparto.")).toBeNull();
  });

  // 114/R7 ("una coincidencia de un grupo no cruza al otro") queda sin objeto: los dos
  // grupos ya no comparten pantalla ni buscador, así que no hay cruce posible que probar.

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
      screen.getByRole("article", { name: /Orden REM-UNO/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Orden REM-DOS/ }),
    ).toBeNull();

    // ...y su parada NO llega al mapa: RutaMapa recibe SOLO g1 (coherencia R8).
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id)).toEqual(["g1"]);
  });

  it("114/R9: la orden EN GESTIÓN permanece en la lista y en el mapa aunque no coincida", async () => {
    const user = userEvent.setup();
    // El bloqueo mantiene la VISTA COMPLETA (grilla + mapa) con el puntero fijado, sin
    // colapsar a modo foco: es el escenario donde la salvaguarda R9 es observable.
    renderModule({
      bloqueo: bloqueoConVencido(),
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
      screen.getByRole("article", { name: /Orden REM-DOS/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-UNO/ }),
    ).toBeInTheDocument();
    // Control: g3 (ni coincide ni está en gestión) SÍ se filtra → prueba que el filtro
    // actúa y que la permanencia de g2 se debe a la salvaguarda, no a falta de filtro.
    expect(
      screen.queryByRole("article", { name: /Orden REM-TRES/ }),
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
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Orden REM-G2/ }),
    ).toBeNull();

    // Cambiar de cantón resetea el distrito: vuelve el placeholder y el filtro de
    // distrito deja de aplicar (g3 de Escazú aparece pese a no ser "Carmen").
    await elegirEnSelect(user, "Filtrar por cantón", "Escazú (San José)");
    const distrito = screen.getByRole("combobox", { name: "Filtrar por distrito" });
    expect(within(distrito).getByText("Todos los distritos")).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-G3/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Orden REM-G1/ }),
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
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    for (const rem of ["REM-G2", "REM-G3", "REM-G4"]) {
      expect(
        screen.queryByRole("article", { name: new RegExp(`Orden ${rem}`) }),
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
      screen.queryByRole("article", { name: /Orden REM-G2/ }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

    // Reaparecen todas; los selects vuelven a su placeholder y el distrito se deshabilita.
    expect(
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-G2/ }),
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
      screen.queryByRole("article", { name: /Orden REM-G2/ }),
    ).toBeNull();

    await elegirEnSelect(user, "Filtrar por cantón", "Todos los cantones");

    expect(
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-G2/ }),
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
    // El bloqueo mantiene la VISTA COMPLETA (grilla + mapa) con el puntero fijado, sin
    // colapsar a foco: es el escenario donde la salvaguarda R10 es observable.
    renderModule({
      bloqueo: bloqueoConVencido(),
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
      screen.getByRole("article", { name: /Orden REM-UNO/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: /Orden REM-DOS/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: /Orden REM-TRES/ }),
    ).toBeNull();

    // El mapa refleja lo mismo: g1 + g2 (salvaguarda), no g3.
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      paradas: { id: string }[];
    };
    expect(props.paradas.map((p) => p.id).sort()).toEqual(["g1", "g2"]);
  });

  // 117/R11 (mensaje "Ninguna guía en reparto coincide con el filtro.") se RETIRÓ el
  // 2026-07-31 junto con el estado que lo producía. R11 dependía de que las opciones de
  // cantón/distrito salieran de la UNIÓN de los dos grupos: se podía elegir un cantón que
  // solo existía en "Por recoger" y vaciar la lista de reparto. Con las opciones derivadas
  // solo de `porGestionar` toda opción tiene una orden detrás, y el select suelta su
  // selección en cuanto la opción desaparece de la lista, así que la lista vuelve entera.
  // Se intentó cubrirlo por los dos caminos (elegir cantón; filtrar por distrito y perder
  // esa orden en un refresh) y ninguno alcanza el estado: el mensaje era rama muerta.
  //
  // Lo que R11 protegía de verdad —que el vacío se EXPLIQUE en vez de aparecer pelado—
  // sigue cubierto por 114/R6 (el "sin resultados" del buscador, arriba), que es el único
  // vacío-con-causa que esta pantalla puede producir.

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
      screen.queryByRole("article", { name: /Orden REM-G1/ }),
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
      screen.getByRole("article", { name: /Orden REM-G1/ }),
    ).toBeInTheDocument();
    // g2 cae por el buscador (Beto); g3 cae por el filtro (Escazú).
    expect(
      screen.queryByRole("article", { name: /Orden REM-G2/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("article", { name: /Orden REM-G3/ }),
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

  // Los dos casos R24 ("por recoger" muestra el dato de intentos, incluido el 0) viven
  // ahora en `RecogerModule.test.tsx`, con la pantalla que los monta.

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

// ---------------------------------------------------------------------------------------
// Feature 167 (R33) — CORTE LIMPIO. La 157 había montado la recolección en tienda como
// TERCER apartado de este módulo, y ahí el mensajero no la encontraba: se ocultaba entera
// cuando la lista estaba vacía, que es justo cuando iba a buscarla. Desde la 167 vive en su
// página propia (`/recoleccion`).
//
// Sustituye al `describe` "apartado por recolectar en tienda (feature 157)" (4 casos), que
// quedó sin sujeto: R11 ("los tres apartados coexisten") deja de ser cierto POR DISEÑO, y
// R39/R40/R25 (no entra al mapa, ni al filtro, ni al modo foco) ya no pueden probarse aquí
// porque no hay nada que pueda entrar. Su cobertura real migró al backend, donde ahora es
// más fuerte: `mis-asignaciones-service.test.ts` exige la lista EXACTA
// `["por_recoger","en_reparto"]` (R34) — si el estado no se lee, no puede contaminar nada.
//
// Este caso es la ausencia escrita como aserción; el guard estático
// `tests/unit/guards/entregas-sin-recoleccion.test.ts` la protege del lado del fuente.
// ---------------------------------------------------------------------------------------
describe("RepartoModule — Entregas no monta ninguna superficie de recolección (feature 167)", () => {
  it("R33: ni región, ni escáner, ni aviso, ni conteo, ni enlace al apartado nuevo", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G" })],
    });

    // El apartado de Reparto sigue ahí (R35: el flujo de gestión no cambia).
    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();

    // La recolección, en cambio, NO deja rastro de ningún tipo.
    expect(
      screen.queryByRole("region", { name: "Por recolectar en tienda" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recolectar por número de guía o escaneo" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Confirmar recolección" }),
    ).toBeNull();
    // Sin aviso ni conteo: ninguna mención de la palabra en toda la pantalla.
    expect(screen.queryByText(/recolect/i)).toBeNull();
    // Sin enlace al apartado nuevo (decisión 2 del humano: la pista es el ítem del menú).
    const enlaces = screen.queryAllByRole("link");
    for (const enlace of enlaces) {
      expect(enlace.getAttribute("href")).not.toBe("/recoleccion");
    }
  });

  it("R33: tampoco con el mensajero BLOQUEADO (donde el aviso podría colarse)", () => {
    renderModule({
      porGestionar: [makeAsignacion({ id: "g1", numRemision: "REM-G" })],
      bloqueo: bloqueoConVencido(),
    });

    // El aviso de bloqueo de Entregas sí está…
    expect(
      screen.getByText(/no puedes entregar, cobrar ni recibir trabajo nuevo/i),
    ).toBeInTheDocument();
    // …y no arrastra ninguna mención de la recolección con él.
    expect(screen.queryByText(/recolect/i)).toBeNull();
  });
});

// Feature 246 (T5.2/T5.3) — UNA ORDEN RESERVADA PARA MAÑANA QUE EL MENSAJERO YA RECOGIÓ.
//
// Es el escenario que motiva la ficha: bodega carga la furgoneta de noche para el reparto del día
// siguiente, así que la orden está en `en_reparto` con su día de reparto todavía por llegar. La
// marca tiene que seguir a la orden hasta aquí, o el mensajero la entregará hoy y el selector no
// habrá servido de nada.
//
// `esParaManana` llega YA RESUELTO desde el servidor (R26): aquí sólo se fija el booleano, igual
// que haría el DTO real. Los textos van con su literal escrito A MANO, nunca contra la constante.
describe("RepartoModule — orden reservada para mañana (feature 246)", () => {
  it("R22: la orden ya recogida anoche sigue diciendo «Para mañana», y la de hoy no", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-MAN",
          estatusValue: "en_reparto",
          esParaManana: true,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-HOY",
          estatusValue: "en_reparto",
          esParaManana: false,
        }),
      ],
    });

    // Presencia y ausencia EMPAREJADAS, en la misma pantalla: sin la card de al lado, el
    // `toBeNull` estaría verde también si no se hubiera renderizado nada.
    expect(within(cardDe("REM-MAN")).getByText("Para mañana")).toBeInTheDocument();
    expect(within(cardDe("REM-HOY")).queryByText("Para mañana")).toBeNull();
  });

  it("R23: la reservada NO se esconde ni sale de la ruta: es una parada más", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-MAN",
          estatusValue: "en_reparto",
          secuenciaRuta: 1,
          esParaManana: true,
        }),
      ],
    });

    const region = screen.getByRole("region", {
      name: "En reparto / por gestionar",
    });
    expect(within(region).getByText(/REM-MAN/)).toBeInTheDocument();
    // Conserva su posición en la ruta: reservar para mañana no la degrada a «sin posición».
    expect(diceParada(cardDe("REM-MAN"), 1, 1)).toBe(true);
  });

  it("R11: la card de la reservada dice desde QUÉ DÍA se podrá, con la fecha en palabras", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-MAN",
          estatusValue: "en_reparto",
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    // 261/R11: el badge dice QUÉ es la orden; esta línea dice por qué el botón de abajo está gris
    // y desde cuándo dejará de estarlo. La fecha la resolvió el SERVIDOR (R14).
    expect(
      within(cardDe("REM-MAN")).getByText(
        "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.",
      ),
    ).toBeInTheDocument();
  });
});

// =================================================================================================
// FEATURE 261 (F3/F5, R12) — EL CONTROL QUE LLEVA A GESTIONAR, DESHABILITADO.
// =================================================================================================
//
// ⏳ REVIERTE LA DECISIÓN D5 DE LA 246. Aquella decía que la reserva protegía del corte nocturno y
// no del mensajero; la refutó una prueba humana en producción (la guía 17496963, gestionada
// `entregada` a las 22:10 CR del 21 estando reservada para el 22). Desde el 2026-08-21 una orden
// reservada no se gestiona hasta su día.
//
// LA FORMA DEL BLOQUEO ES LA QUE EL REPO YA USA con el mensajero bloqueado por un cierre pendiente:
// el control se apaga, la card se queda ENTERA y en su sitio, y el motivo va en palabras al lado.
// Se restringe la ACCIÓN, no la visibilidad (R9). El humano descartó explícitamente la alternativa
// de moverla a una sección propia (P3/A7): lo que se saca del grupo de siempre está a un paso de
// esconderse.
//
// Y el bloqueo de verdad NO está aquí: vive en el servidor (R1-R5). Esto es defensa suave, la
// misma que el portal ya aplica al cierre pendiente — pero es la que evita que el mensajero saque
// la caja de la furgoneta para nada.
describe("RepartoModule — el botón de gestionar de una reservada (feature 261/R12)", () => {
  const AVISO_22 =
    "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.";

  /** El botón «Gestionar» del pie de la card de esa remisión. */
  function botonGestionarDe(numRemision: string): HTMLElement {
    return screen.getByRole("button", { name: `Gestionar la orden ${numRemision}` });
  }

  it("R12: el botón «Gestionar» de la reservada está DESHABILITADO, y el de la de hoy no", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-HOY",
          estatusValue: "en_reparto",
          esParaManana: false,
        }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-MAN",
          estatusValue: "en_reparto",
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    // El par, en la misma pantalla. La primera orden es la que ocupa el panel de detalle, así que
    // su botón está apagado por OTRO motivo (ya está abierta); la que este caso mide es la
    // segunda, cuyo único impedimento es el día.
    expect(botonGestionarDe("REM-MAN")).toBeDisabled();
    expect(
      within(cardDe("REM-MAN")).getByText(AVISO_22),
      "un botón gris sin explicación es un misterio: el motivo va en palabras al lado",
    ).toBeInTheDocument();
  });

  it("R12: la mitad POSITIVA — sin reserva ese mismo botón está habilitado", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({ id: "g1", numRemision: "REM-UNO", estatusValue: "en_reparto" }),
        makeAsignacion({
          id: "g2",
          numRemision: "REM-DOS",
          estatusValue: "en_reparto",
          esParaManana: false,
        }),
      ],
    });

    // Sin esto, un `disabled` puesto a `true` a secas pasaría el caso anterior.
    expect(botonGestionarDe("REM-DOS")).toBeEnabled();
  });

  it("R9: la card reservada NO se esconde ni se recorta — sigue entera y en su sección", () => {
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-MAN",
          estatusValue: "en_reparto",
          secuenciaRuta: 1,
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "En reparto / por gestionar" });
    expect(within(region).getByText(/REM-MAN/)).toBeInTheDocument();
    // Y conserva su posición en la ruta: bloquear la acción no la degrada a «sin posición» ni la
    // saca del mapa (R10). Sigue en la moto.
    expect(diceParada(cardDe("REM-MAN"), 1, 1)).toBe(true);
  });

  it("R12: y por el panel tampoco — pulsar «Gestionar» dice el motivo y NO fija el puntero", async () => {
    const user = userEvent.setup();
    // ⚠️ ESTE CASO NO ES REDUNDANTE CON EL BOTÓN GRIS: el panel arranca en la PRIMERA orden del
    // grupo, así que una reservada puede estar delante sin que nadie haya pulsado la card. Sin
    // esta guarda, el `conflict` del servidor se traduciría a «ya tienes otra orden activa en
    // gestión» — falso, y mandaría a buscar un problema que no existe.
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-MAN",
          numGuia: 1001,
          estatusValue: "en_reparto",
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    const panel = await abrirGestion(user);
    await user.type(within(panel).getByLabelText("Número de guía"), "1001");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledWith(AVISO_22));
    // Que se diga es la mitad; que el puntero NO se fije es la otra. Sin ella, el caso pasaría
    // igual con un aviso que avisa y escoge de todos modos.
    expect(escogerMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Entregar" })).toBeNull();
  });

  it("R12: y con la orden de HOY el mismo panel SÍ escoge — la regla no bloquea de más", async () => {
    const user = userEvent.setup();
    escogerMock.mockResolvedValue({ status: "ok", ordenId: "g1" });
    renderModule({
      porGestionar: [
        makeAsignacion({
          id: "g1",
          numRemision: "REM-HOY",
          numGuia: 1001,
          estatusValue: "en_reparto",
          esParaManana: false,
          fechaRepartoISO: "2026-08-21",
        }),
      ],
    });

    const panel = await abrirGestion(user);
    await user.type(within(panel).getByLabelText("Número de guía"), "1001");
    await user.click(within(panel).getByRole("button", { name: "Gestionar" }));

    await vi.waitFor(() => expect(escogerMock).toHaveBeenCalledWith({ ordenId: "g1" }));
    expect(await screen.findByRole("button", { name: "Entregar" })).toBeInTheDocument();
  });
});

// Feature 265 (FE3) — EL MENSAJERO SE ENTERA DE QUE SU ORDEN ES APROXIMADO.
//
// Lo que esta pantalla mostraba hasta hoy era la MISMA lista, con el mismo aspecto, viniera el
// orden del servicio de rutas o lo hubiera calculado la app por cercanía en línea recta. La
// degradación era invisible: ni un aviso, ni una marca, nada. Y ocurre por más de un camino
// —falta de credencial, paradas que el servicio no pudo servir—, así que no es un caso de
// laboratorio.
//
// Las tres reglas que gobiernan estos casos:
//   · `"local"`     → se avisa, SIEMPRE, desde el primer render y sin abrir el mapa (R38);
//   · `"proveedor"` → no se avisa (sería ruido sobre una ruta que sí está bien calculada);
//   · `null`        → NO CONSTA, y no consta es no consta: ni aviso ni afirmación contraria (R45).
//
// ⚠️ Los textos van escritos A MANO en este archivo, nunca importados del componente. Un texto
// comparado contra la función que lo genera está siempre verde y no prueba nada.
describe("RepartoModule — el orden de las paradas es aproximado (feature 265)", () => {
  const TITULO_ORDEN = "El orden de las paradas es aproximado";
  const CUERPO_ORDEN =
    "Lo calculamos en la app, por cercanía en línea recta: no toma en cuenta calles ni tráfico. Revísalo antes de salir.";
  // El aviso del PUNTO DE PARTIDA, que ya existía (feature 92/R24) y que este bloque no toca.
  const TEXTO_ORIGEN =
    "El punto de partida es aproximado (no se usó tu ubicación GPS reciente).";

  /** El `Alert` del orden aproximado entero, o `null` si no está en pantalla. */
  function avisoOrden(): HTMLElement | null {
    const titulo = screen.queryByText(TITULO_ORDEN);
    return titulo ? (titulo.closest('[data-slot="alert"]') as HTMLElement) : null;
  }

  const UNA_PARADA = [
    makeAsignacion({ id: "g1", numRemision: "REM-G1", secuenciaRuta: 1 }),
  ];

  it("R38/R40: con el orden calculado en la app, el aviso está desde el PRIMER render — sin pulsar nada", () => {
    renderModule({
      porGestionar: UNA_PARADA,
      ruta: { ...RUTA_VIGENTE, secuenciaFuente: "local" },
    });

    // Ni un click, ni abrir el mapa, ni esperar a nada: se afirma sobre el render inicial.
    const aviso = avisoOrden();
    expect(aviso).not.toBeNull();
    // R40: dice QUÉ pasa (el título) y QUÉ HACER (el cuerpo). Un aviso que no dice qué hacer
    // es ruido, y el mensajero está a punto de salir.
    expect(
      within(aviso as HTMLElement).getByText(CUERPO_ORDEN),
    ).toBeInTheDocument();
    // Es un aviso, no un error: el rojo está reservado a «El orden mostrado no está actualizado»,
    // que sí describe una ruta que NO se puede seguir. Ésta se puede seguir; solo hay que mirarla.
    expect(aviso).toHaveAttribute("role", "alert");
    expect(screen.queryByText("El orden mostrado no está actualizado")).toBeNull();
  });

  it.each([
    ["proveedor", "el orden lo calculó el servicio de rutas: no hay nada que revisar"],
    [null, "no consta quién lo calculó (ruta anterior a esta feature, o 0/1 parada)"],
  ] as const)(
    "R38/R45: con `secuenciaFuente` = %s NO hay aviso — %s",
    (fuente, porque) => {
      renderModule({
        porGestionar: UNA_PARADA,
        ruta: { ...RUTA_VIGENTE, secuenciaFuente: fuente },
      });

      // La mitad negativa, y es la que mata «mostrarlo siempre».
      expect(screen.queryByText(TITULO_ORDEN), porque).toBeNull();
      expect(screen.queryByText(CUERPO_ORDEN), porque).toBeNull();
      // Y se afirma que la pantalla se pintó de verdad: un `toBeNull` sobre un render vacío
      // estaría verde igual, y este caso no probaría nada.
      expect(cardDe("REM-G1")).toBeInTheDocument();
    },
  );

  it("R44: avisa sin nombrar la causa — el mensajero no puede hacer nada con ella", () => {
    renderModule({
      porGestionar: UNA_PARADA,
      ruta: { ...RUTA_VIGENTE, secuenciaFuente: "local" },
    });

    // La pantalla NO recibe la causa (falta de credencial, paradas no servidas, …) y no debe
    // inventarla ni pedirla: el aviso es el mismo por los dos caminos. Lo que se comprueba aquí
    // es que no se cuele por el texto una explicación que al mensajero no le sirve.
    const texto = (avisoOrden() as HTMLElement).textContent ?? "";
    expect(texto).not.toMatch(
      /credencial|clave|licencia|cuota|servidor|fall[oó]|error/i,
    );
  });

  it("R41/R42: el texto del aviso no lleva jerga interna, ni siglas, ni datos de nadie", () => {
    renderModule({
      porGestionar: UNA_PARADA,
      ruta: { ...RUTA_VIGENTE, secuenciaFuente: "local" },
    });

    // Sobre el DOM RENDERIZADO, no sobre una constante del componente. Y acotado al aviso: el
    // resto de la pantalla lleva direcciones y guías de verdad, que ahí son legítimas.
    const texto = (avisoOrden() as HTMLElement).textContent ?? "";
    // R41 — jerga de dentro de casa. Ninguna de estas palabras significa nada para quien
    // reparte, y este repo ya arrastra deuda por meter una sigla en una pantalla.
    expect(texto).not.toMatch(
      /degrad|fallback|haversine|proveedor|optimizador|API|GPS/i,
    );
    // R42 — coordenadas (dos decimales o más), direcciones, guías e ids.
    expect(texto).not.toMatch(/-?\d+[.,]\d{2,}/);
    expect(texto).not.toMatch(/REM-|Calle|casa \d|Ana Pérez|\bg1\b/);
  });

  it("R43: las TRES señales conviven y siguen siendo tres cosas distintas", () => {
    renderModule({
      porGestionar: UNA_PARADA,
      ruta: {
        ...RUTA_VIGENTE,
        // 1 · desde dónde se calculó (feature 92/R24)
        origenFuente: "centroide",
        // 2 · el dibujo no sigue calles (feature 92): el mapa lo pinta punteado
        trazado: {
          encodedPolyline: "abc",
          distanciaM: null,
          duracionS: null,
          fuente: "local",
        },
        // 3 · quién decidió el ORDEN (esta feature)
        secuenciaFuente: "local",
      },
    });

    const aviso = avisoOrden();
    expect(aviso).not.toBeNull();
    const origen = screen.getByText(TEXTO_ORIGEN);

    // Los dos textos, a la vez y por separado. Fundirlos en un «todo esto es aproximado» sería
    // más corto y más falso: un orden calculado en la app con dibujo por calles es un caso real,
    // y un punto de partida aproximado con el orden bien calculado también.
    expect(aviso).toBeInTheDocument();
    expect(origen).toBeInTheDocument();
    expect((aviso as HTMLElement).contains(origen)).toBe(false);
    // Y cada uno habla de LO SUYO: ninguno absorbe el hecho del otro.
    expect((aviso as HTMLElement).textContent).not.toMatch(/punto de partida/i);
    expect(origen.textContent).not.toMatch(/orden de las paradas/i);

    // La tercera señal no es un texto sino una línea punteada, así que se afirma donde de
    // verdad se decide: la geometría local que llega al mapa (`RutaMapaInner` la pinta con
    // `dashArray` cuando `fuente !== "routes"`).
    const props = rutaMapaMock.mock.calls.at(-1)?.[0] as {
      trazado: { fuente: string } | null;
    };
    expect(props.trazado?.fuente).toBe("local");
  });
});
