// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecogerModule } from "@/app/(app)/mis-asignaciones/_components/RecogerModule";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";
import {
  bloqueoConVencido,
  bloqueoDe,
  bloqueoMixtoElMasViejoEsSuyo,
  bloqueoPorAcumular,
  bloqueoTodosPorEnviar,
} from "@/tests/fixtures/bloqueo-cierre";

// 2026-07-31 (decisión del humano) — pantalla POR RECOGER del mensajero. Es la mitad que
// salió de `MisAsignacionesModule` (hoy `RepartoModule`), donde el escáner quedaba
// enterrado bajo el mapa y el panel de gestión.
//
// Esta suite hereda los casos de "Por recoger" que vivían en `MisAsignacionesModule.test.tsx`
// —listado de solo-visualización, banner de contador, las dos vías de recogida, el bloqueo y
// el buscador— y añade los del conmutador mosaico/detalle y el carrusel, que Reparto ya
// tenía y aquí se replicaron. Lo que NO se prueba aquí es el interior del escáner (parseo de
// la URL del paquete, ciclo de la cámara): eso es de `RecogerPaqueteCard.test.tsx`.
//
// Se mockean la Server Action, el toast y el router (refresh) para afirmar la composición y
// los envíos sin DB ni sesión.
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

// La cámara no existe en CI; el doble basta para que el visor monte sin hardware.
vi.mock("html5-qrcode", () => ({
  Html5Qrcode: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

const recogerMock = vi.mocked(recogerAsignaciones);

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
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    // Estas órdenes todavía no entraron en la ruta optimizada (feature 92/R28).
    secuenciaRuta: null,
    ...over,
  };
}

function renderModule(props?: Partial<Parameters<typeof RecogerModule>[0]>) {
  return render(
    <RecogerModule
      porRecoger={props?.porRecoger ?? []}
      bloqueo={props?.bloqueo ?? SIN_BLOQUEO}
    />,
  );
}

/** La región del listado (el `<section aria-label>` de la pantalla). */
function listado() {
  return screen.getByRole("region", { name: "Por recoger" });
}

/** El acceso a la recogida por guía/escaneo, plegado o no. */
const accesoRecogida = () =>
  screen.queryByRole("button", { name: "Recoger paquete" });

/**
 * Despliega la tarjeta de recogida. Vive plegada tras su disparador (decisión del humano,
 * 2026-07-31): dentro vive `QrScanner`, y montada dejaba la cámara ENCENDIDA todo el tiempo
 * que el mensajero tuviera abierta la pantalla.
 */
async function abrirRecogida(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Recoger paquete" }));
}

/** El campo de búsqueda de guías (input type="search" con label "Buscar guías"). */
function buscador() {
  return screen.getByRole("searchbox", { name: "Buscar guías" });
}

/** Cambia entre las vistas mosaico y detalle por el conmutador segmentado. */
async function cambiarVista(
  user: ReturnType<typeof userEvent.setup>,
  etiqueta: "Mosaico" | "Detalle",
) {
  const grupo = screen.getByRole("group", { name: "Vista de las órdenes" });
  await user.click(within(grupo).getByRole("button", { name: etiqueta }));
}

// ---------------------------------------------------------------------------
// FEATURE 277 (2026-08-24) — LAS DOS PESTAÑAS.
// ---------------------------------------------------------------------------
// Los nombres van ESCRITOS A MANO en todos los ayudantes y en todas las aserciones, nunca
// importando `PESTANA_PARA_RECOGER_HOY`/`PESTANA_PARA_OTRO_DIA`: una aserción contra su propia
// fuente está siempre verde, y estos dos literales son la decisión más cara de deshacer de la
// ficha (los firmó el humano el 2026-08-24). El prefijo con `^` es porque el conteo viaja en el
// mismo nombre; los conteos exactos se afirman en sus tests propios.

/** La pestaña del grupo de hoy, con el conteo que lleve. */
function pestanaHoy(): HTMLElement {
  return screen.getByRole("tab", { name: /^Para recoger hoy/ });
}

/** La pestaña del grupo de otro día, con el conteo que lleve. */
function pestanaOtroDia(): HTMLElement {
  return screen.getByRole("tab", { name: /^Para otro día/ });
}

/** El panel visible (sólo hay uno: los paneles no se mantienen montados). */
function panelActivo(): HTMLElement {
  return screen.getByRole("tabpanel");
}

/** UNA sola pulsación para llegar al otro grupo: no hace falta buscar nada. */
async function irAOtroDia(user: ReturnType<typeof userEvent.setup>) {
  await user.click(pestanaOtroDia());
}

beforeEach(() => {
  vi.clearAllMocks();
  recogerMock.mockResolvedValue({ status: "ok", recogidas: ["r1"] });
});

afterEach(() => {
  cleanup();
});

describe("RecogerModule — listado de solo-visualización", () => {
  it("monta la región 'Por recoger' y NINGUNA superficie de reparto", () => {
    renderModule({ porRecoger: [makeAsignacion({ id: "r1" })] });

    expect(listado()).toBeInTheDocument();
    // El corte es simétrico al de Reparto: aquí no hay mapa, ni panel de gestión, ni
    // sincronización de ruta. Si un merge los devuelve, esta pantalla vuelve a ser la
    // pantalla revuelta de la que se separó.
    expect(
      screen.queryByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Detalle de la orden" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sincronizar ruta" }),
    ).toBeNull();
  });

  // FEATURE 277 (Q1, firmada por el humano el 2026-08-24): el literal concuerda en plural. Decía
  // «2 Órdenes nuevas asignadas», con la N pegada a un plural fijo; con una sola orden se leía «1
  // Órdenes nuevas asignadas». El defecto ya existía, pero contar sólo el grupo de hoy (R15) lo
  // vuelve frecuente y se decidió no dejarlo a la vista.
  it("Feature 63: muestra el banner con el contador de órdenes nuevas asignadas", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    expect(
      within(listado()).getByText("2 órdenes nuevas asignadas"),
    ).toBeInTheDocument();
  });

  // Feature 96: la recogida NO vive en el listado (se quitaron los botones "Recoger" /
  // "Recoger todas" y su modal). Recoger es exclusivamente por el input o el escáner.
  it("Feature 96: el listado no ofrece acciones (sin 'Recoger' / 'Recoger todas' ni gestión)", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const region = listado();
    expect(within(region).queryByRole("button", { name: "Recoger" })).toBeNull();
    expect(
      within(region).queryByRole("button", { name: "Recoger todas" }),
    ).toBeNull();
    // Las cards son las de Reparto pero SIN gestión ni contacto: el único control que
    // queda es el desplegable del detalle (revelar, no actuar).
    expect(
      within(region).queryByRole("article", { name: /Gestionar orden/ }),
    ).toBeNull();
    expect(within(region).queryByRole("link", { name: /Llamar a/ })).toBeNull();
    expect(within(region).queryByRole("link", { name: /WhatsApp a/ })).toBeNull();
    // Pero sigue LISTANDO las guías (el mensajero ve qué tiene pendiente).
    expect(within(region).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(region).getByText(/REM-R2/)).toBeInTheDocument();
  });

  it("R11 / 63: la card muestra el detalle en 3 secciones (pedido, entrega, cobro con peso)", () => {
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

    const region = listado();
    // La card es la MISMA que la de Reparto, así que varios campos (destinatario,
    // producto, cantón, monto) se repiten en la card y en el detalle. Las 3 secciones se
    // comprueban DENTRO del desplegable del detalle.
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
    // 1.250,50 sube a 1.251: el medio se aleja del cero (feature 230/D1).
    expect(within(detalle).getByText("₡1.251")).toBeInTheDocument();
    expect(within(detalle).getByText("1.5 kg")).toBeInTheDocument();
    // Ya NO se muestra la Tienda ni la ubicación con zona.
    expect(within(region).queryByText("Tienda Norte")).toBeNull();
  });

  it("Feature 160/R24: la card muestra el conteo de intentos, incluido el 0", () => {
    const { unmount } = renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", intentosEntrega: 1 }),
      ],
    });
    const etiqueta = within(listado()).getByText("Intentos");
    expect(etiqueta.tagName).toBe("DT");
    expect(etiqueta.parentElement?.querySelector("dd")?.textContent).toBe("1");

    // El 0 es un dato, no una ausencia: se muestra igual (si se omitiera, el mensajero no
    // podría distinguir "sin intentos" de "el dato no llegó").
    unmount();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r2", numRemision: "REM-R2", intentosEntrega: 0 }),
      ],
    });
    expect(
      within(listado())
        .getByText("Intentos")
        .parentElement?.querySelector("dd")?.textContent,
    ).toBe("0");
  });

  it("las cards NO muestran señales de ruta (estas órdenes no están ruteadas todavía)", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-R1" })],
    });

    const region = listado();
    expect(within(region).queryByText(/Parada \d+ de/)).toBeNull();
    expect(within(region).queryByText("Pendiente de optimizar")).toBeNull();
  });
});

describe("RecogerModule — las dos vías de recogida (feature 96)", () => {
  it("ofrece la recogida SOLO por input de número de guía y por escáner (sin modal)", async () => {
    const user = userEvent.setup();
    renderModule({ porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })] });

    await abrirRecogida(user);
    expect(
      screen.getByRole("region", { name: "Recoger por número de guía o escaneo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Escanear con cámara" }),
    ).toBeInTheDocument();
    // Ya no existe el modal de confirmación de recogida.
    expect(screen.queryByRole("dialog", { name: "Recoger órdenes" })).toBeNull();
  });

  it("teclear una guía por recoger + confirmar recoge esa orden por su id y refresca", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["r2"] });
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numGuia: 1001 }),
        makeAsignacion({ id: "r2", numGuia: 1002 }),
      ],
    });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "1002");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["r2"] }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("restricción 'asignada a mí': una guía que NO está por recoger se rechaza sin llamar la action", async () => {
    const user = userEvent.setup();
    renderModule({ porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })] });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "9999");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // Pedido humano: sin NADA por recoger no hay guía que resolver, así que el input y el
  // escáner no se muestran (el listado sigue, con su vacío).
  it("sin órdenes por recoger, la card de recogida no se muestra", () => {
    renderModule({ porRecoger: [] });

    expect(accesoRecogida()).toBeNull();
    expect(
      screen.queryByRole("region", {
        name: "Recoger por número de guía o escaneo",
      }),
    ).toBeNull();
    // FEATURE 277 (R10): el vacío es ahora el de la pestaña de entrada, que nombra su grupo. La
    // pantalla sigue explicando el vacío; lo que cambió es que hay dos grupos que explicar.
    expect(
      screen.getByText("No hay órdenes por recoger hoy."),
    ).toBeInTheDocument();
  });

  it("el buscador NO puede esconder la forma de recoger lo que sigue pendiente", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-R1" })],
    });

    // Una búsqueda sin coincidencias vacía la LISTA, pero la tarjeta de recogida mira el
    // grupo COMPLETO: si desapareciera con el filtro, el mensajero se quedaría sin poder
    // recoger justo cuando está buscando una guía concreta.
    await user.type(buscador(), "zzzinexistente");

    expect(accesoRecogida()).toBeInTheDocument();
  });
});

// =================================================================================================
// Feature 111 -> FEATURE 271 (T9.2, R43/R46/R51/R52) — EL AVISO DEL BLOQUEO, PALABRA POR PALABRA.
// =================================================================================================
//
// ⚠️ LOS LITERALES VAN ESCRITOS A MANO Y COMPLETOS. NUNCA `toHaveTextContent(avisoBloqueo(d))`:
// un texto comparado contra la función que lo genera está SIEMPRE VERDE —pasa aunque la función
// devuelva basura— y este repo ya lo ha pagado. Son los que el humano aprobó el 2026-08-23
// (§10.2), en su variante de PORTAL: la única diferencia con «Cierre del día» es el puntero final.
//
// ⚠️ Y LO QUE YA NO DICEN: «Sí puedes seguir recibiendo asignaciones» y «Sí puedes seguir
// recogiendo en tiendas». Las dos eran ciertas hasta el 2026-08-22 y son FALSAS desde el 23 —un
// mensajero bloqueado tampoco recibe trabajo nuevo, ni reparto ni recolección—. La aserción
// negativa del final es lo que impide reponerlas «para suavizar el mensaje».
describe("RecogerModule — bloqueo del mensajero (feature 111 -> 271)", () => {
  it("271/§10.2 caso 2 · un cierre esperando a que él lo reenvíe (N=1, V=1)", () => {
    renderModule({
      bloqueo: bloqueoConVencido(),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Ve a «Cierre del día» para enviarlo a aprobación.",
    );
  });

  it("271/§10.2 caso 1 · bloqueado por ACUMULAR (N=2, V=0), con la fecha de la JORNADA", () => {
    renderModule({
      bloqueo: bloqueoPorAcumular("2026-08-21"),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    // La fecha es la de la jornada que el mensajero trabajó (21), no la del nacimiento del
    // cierre (22): un cierre vencido nace fechado un día por delante.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo, el del 21 de agosto.",
    );
  });

  it("271/§10.2 caso 3 · las DOS cosas a la vez (N=2, V=1)", () => {
    // ⚠️ EL PUNTERO VA SIN OBJETO desde el 2026-08-23 (corrección aprobada por el humano tras
    // mirar la app): «...para enviarLO» colgaba de «el más antiguo», el cierre que resuelve la
    // BODEGA. La frase anterior ya dice qué enviar; el caso 2 conserva su «para enviarlo».
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto. Ve a «Cierre del día».",
    );
  });

  it("271/§10.2 caso 3 con el MÁS VIEJO SUYO · la fecha es la del que él envía", () => {
    // ⚠️ LA CUARTA RAMA (aprobada el 2026-08-23, y el estado se midió en el navegador): el admin
    // rechazó el PRIMERO de sus dos `solicitado`, así que el cierre más viejo es SUYO. Antes decía
    // «espera a que la bodega apruebe el más antiguo» fechando su propio cierre — le mandaba a
    // esperar por el mismo que el botón le ofrece reenviar. Ahora la fecha nombra el que ÉL envía y
    // la espera se corre al RESTO.
    renderModule({
      bloqueo: bloqueoMixtoElMasViejoEsSuyo({ jornadaCR: "2026-08-20" }),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envía el que falta, el del 20 de agosto, y después espera a que la bodega apruebe el resto. Ve a «Cierre del día».",
    );
  });

  it("271/§10.2 caso 3 con V = N · TODO en su tejado: ni singular ni esperar a la bodega", () => {
    // Dos `rechazado`: no queda ningún `solicitado`, así que la bodega no tiene nada que aprobar
    // y el plural del envío es real. Hasta el 2026-08-23 este estado leía el texto de arriba.
    renderModule({
      bloqueo: bloqueoTodosPorEnviar(2, "2026-08-21"),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres sin resolver y ninguno se ha enviado a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Envíalos a aprobación, empezando por el más antiguo, el del 21 de agosto. Ve a «Cierre del día».",
    );
  });

  it("271/R60 · sin jornada fiable la fecha DESAPARECE entera y el resto se lee igual", () => {
    renderModule({
      bloqueo: bloqueoPorAcumular(null),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo.",
    );
  });

  it("271/R51 · el aviso NO promete recibir asignaciones ni recoger en tiendas", () => {
    renderModule({
      bloqueo: bloqueoDe({ n: 2, v: 1, jornadaCR: "2026-08-21" }),
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    const aviso = screen.getByRole("alert");
    expect(aviso).not.toHaveTextContent(/seguir recibiendo asignaciones/i);
    expect(aviso).not.toHaveTextContent(/seguir recogiendo en tiendas/i);
    expect(aviso).not.toHaveTextContent(/sí puedes/i);
  });

  it("271/R5 · un solo cierre YA enviado (N=1, V=0) NO bloquea: ni aviso ni controles apagados", () => {
    // La mitad de la regla del 2026-08-20 que la 271 CONSERVA: ese mensajero ya hizo lo suyo y
    // espera al administrador (mediana 8,2 h medida contra producción). Castigarlo por una
    // demora ajena era la mitad equivocada.
    renderModule({
      bloqueo: bloqueoDe({ n: 1, v: 0 }),
      porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })],
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(accesoRecogida()).toBeInTheDocument();
  });

  it("R14: bloqueado oculta los controles de recoger (input + escáner) y deja el listado", () => {
    renderModule({
      bloqueo: bloqueoConVencido(),
      porRecoger: [makeAsignacion({ id: "r1", numGuia: 1001 })],
    });

    // Bloqueado no queda ni el ACCESO: sin disparador no hay forma de abrir la tarjeta.
    expect(accesoRecogida()).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recoger por número de guía o escaneo" }),
    ).toBeNull();
    // La lista sigue visible, en solo-visualización.
    expect(listado()).toBeInTheDocument();
  });

  it("R12: sin bloqueo NO muestra el aviso", () => {
    renderModule({ porRecoger: [makeAsignacion({ id: "r1" })] });

    expect(
      screen.queryByText(/no puedes entregar, cobrar ni recibir trabajo nuevo/i),
    ).not.toBeInTheDocument();
  });
});

describe("RecogerModule — buscador de guías (feature 114)", () => {
  it("R1: renderiza un campo de búsqueda de guías (searchbox)", () => {
    renderModule({ porRecoger: [makeAsignacion({ id: "r1" })] });

    expect(buscador()).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar guías")).toBeInTheDocument();
  });

  it("R2: teclear texto filtra por guía / remisión / destinatario", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-RA", destinatario: "Ana" }),
        makeAsignacion({ id: "r2", numRemision: "REM-RB", destinatario: "Beto" }),
      ],
    });

    await user.type(buscador(), "ana");

    const region = listado();
    expect(within(region).getByText(/REM-RA/)).toBeInTheDocument();
    expect(within(region).queryByText(/REM-RB/)).toBeNull();
  });

  it("R5: limpiar la búsqueda restaura todas las guías", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", destinatario: "Ana" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2", destinatario: "Beto" }),
      ],
    });

    const input = buscador();
    await user.type(input, "beto");
    expect(within(listado()).queryByText(/REM-R1/)).toBeNull();

    await user.clear(input);

    const region = listado();
    expect(within(region).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(region).getByText(/REM-R2/)).toBeInTheDocument();
  });

  it("R6: sin coincidencias muestra 'sin resultados', distinto del vacío sin búsqueda", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", destinatario: "Ana" }),
      ],
    });

    await user.type(buscador(), "zzzinexistente");

    expect(
      within(listado()).getByText(
        "Ninguna guía por recoger coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();
    // DISTINGUIBLE del vacío sin búsqueda (277/R10: el de la pestaña de hoy).
    expect(screen.queryByText("No hay órdenes por recoger hoy.")).toBeNull();
  });

  it("el banner de contador cuenta el grupo COMPLETO, no lo que el buscador deja ver", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1", destinatario: "Ana" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2", destinatario: "Beto" }),
      ],
    });

    await user.type(buscador(), "ana");

    // Sigue diciendo 2: lo pendiente de recoger no cambia porque se filtre la vista. (277/R16: el
    // banner cuenta el grupo COMPLETO de hoy; el literal concuerda desde la Q1 de la 277.)
    expect(
      within(listado()).getByText("2 órdenes nuevas asignadas"),
    ).toBeInTheDocument();
  });
});

describe("RecogerModule — conmutador mosaico/detalle y carrusel (pedido humano)", () => {
  it("arranca en MOSAICO, con las cards dentro del carrusel de 'Órdenes por recoger'", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const carrusel = screen.getByRole("region", {
      name: "Órdenes por recoger",
    });
    expect(within(carrusel).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(carrusel).getByText(/REM-R2/)).toBeInTheDocument();
    // El conmutador marca "Mosaico" como la vista activa (aria-pressed).
    const grupo = screen.getByRole("group", { name: "Vista de las órdenes" });
    expect(within(grupo).getByRole("button", { name: "Mosaico" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("el carrusel trae sus controles de página y la etiqueta de posición", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    const carrusel = screen.getByRole("region", {
      name: "Órdenes por recoger",
    });
    expect(
      within(carrusel).getByRole("button", { name: /anterior/i }),
    ).toBeInTheDocument();
    expect(
      within(carrusel).getByRole("button", { name: /siguiente/i }),
    ).toBeInTheDocument();
    // La etiqueta de posición nombra el total con el plural que recibe el compuesto.
    expect(within(carrusel).getByText(/de 2/)).toBeInTheDocument();
  });

  it("pasar a DETALLE saca las cards del carrusel y las pone en lista", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    await cambiarVista(user, "Detalle");

    // El cambio va animado en dos tramos, así que la vista nueva se espera.
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Órdenes por recoger" }),
      ).toBeNull(),
    );
    // Las MISMAS órdenes siguen ahí: el conmutador es presentación, no filtro.
    const region = listado();
    expect(within(region).getByText(/REM-R1/)).toBeInTheDocument();
    expect(within(region).getByText(/REM-R2/)).toBeInTheDocument();
  });

  it("sin órdenes visibles no se monta el carrusel (queda el mensaje de vacío)", () => {
    renderModule({ porRecoger: [] });

    expect(
      screen.queryByRole("region", { name: "Órdenes por recoger" }),
    ).toBeNull();
    // 277/R10: el vacío de la pestaña de entrada.
    expect(
      screen.getByText("No hay órdenes por recoger hoy."),
    ).toBeInTheDocument();
  });
});

// Feature 246 (T5.2/T5.3) — LO QUE VE EL MENSAJERO con una orden RESERVADA para el día siguiente,
// en el grupo «Por recoger», que es donde vive el 99 % de lo reservado.
//
// `esParaManana` llega YA RESUELTO desde el servidor (R26): el navegador no compara ninguna fecha
// ni lee ningún reloj, así que estos casos fijan la orden con el booleano puesto, igual que lo
// haría el DTO real. El texto se afirma con su literal escrito A MANO, nunca contra la constante
// que lo produce.
describe("RecogerModule — orden reservada para mañana (feature 246)", () => {
  /** La card de una remisión, sea cual sea la vista montada. */
  function cardDe(numRemision: string): HTMLElement {
    return screen.getByRole("article", {
      name: new RegExp(`Orden ${numRemision}`),
    });
  }

  // ⚠️ FEATURE 277 (2026-08-24): estos casos NO cambian lo que afirman —la marca sigue siendo la
  // misma, con las mismas palabras (R31)—, cambian dónde hay que ir a mirarla: desde esta ficha la
  // orden marcada vive en la pestaña «Para otro día», a UNA pulsación. El `await irAOtroDia(user)`
  // es exactamente esa pulsación, y no un rodeo para que el test pase.
  it("R22: la card de la orden reservada dice «Para mañana» CON PALABRAS, y la de hoy no", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-MAN", esParaManana: true }),
        makeAsignacion({ id: "r2", numRemision: "REM-HOY", esParaManana: false }),
      ],
    });

    // La presencia y la ausencia, EMPAREJADAS y en la misma pantalla: sola, la ausencia
    // pasaría en verde también si la segunda card no se hubiera renderizado. Con las dos
    // pestañas la pareja sigue entera, una a cada lado.
    expect(within(cardDe("REM-HOY")).queryByText("Para mañana")).toBeNull();

    await irAOtroDia(user);

    expect(within(cardDe("REM-MAN")).getByText("Para mañana")).toBeInTheDocument();
    // Y la de hoy ya no está en el DOM: los paneles no se mantienen montados, así que no hay dos
    // listados a la vez ni nombres accesibles duplicados.
    expect(screen.queryByText(/REM-HOY/)).toBeNull();
  });

  it("R22: también lo dice en la vista DETALLE — la marca no depende de cómo se mire", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-MAN", esParaManana: true }),
      ],
    });

    await irAOtroDia(user);
    await cambiarVista(user, "Detalle");

    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Órdenes para otro día" }),
      ).toBeNull(),
    );
    expect(within(cardDe("REM-MAN")).getByText("Para mañana")).toBeInTheDocument();
  });

  it("R22: sin el campo (DTO anterior a la feature) la card NO inventa la marca", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-VIEJA" })],
    });

    // Emparejado con su presencia: la card existe y se lee; lo que no está es la marca.
    expect(within(cardDe("REM-VIEJA")).getByText(/REM-VIEJA/)).toBeInTheDocument();
    expect(within(cardDe("REM-VIEJA")).queryByText("Para mañana")).toBeNull();
  });

  // ⚠️ ESTE TEST VIENE DE LA FEATURE 246 (R23) Y CAMBIÓ DE FORMA CON LA 277 (2026-08-24).
  //
  // Lo que afirmaba: con UNA sola orden reservada, la orden estaba en la región del listado y el
  // banner decía «1 Órdenes nuevas asignadas». El banner ya no existe en ese caso —cuenta sólo el
  // grupo de hoy (277/R15/R17), y ahí no hay ninguna— y la orden vive en la otra pestaña.
  //
  // Lo que NO se pierde, y por eso el test se reescribe en vez de borrarse: 246/R23 dice que el
  // sistema NO puede ocultarle al mensajero una orden que tiene asignada por estar reservada, y
  // ESO SIGUE VIGENTE E INTOCADO. La 277 lo hace más fuerte y más explícito: la propiedad pasa de
  // «está en la lista» a las CUATRO de abajo. Cambia el SITIO, no la VISIBILIDAD.
  it("R23 (246, en su forma nueva desde la 277): la orden reservada NO se esconde — está contada, a una pulsación, con su marca y con por dónde recogerla", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    // (1) ESTÁ EN LA PANTALLA, y se sabe SIN INTERACTUAR: la pestaña dice cuántas tiene.
    expect(
      screen.getByRole("tab", { name: "Para otro día (1)" }),
    ).toBeInTheDocument();
    // Y sin haber tocado nada, se entra por la de hoy: la orden no está oculta, está al lado.
    expect(pestanaHoy()).toHaveAttribute("aria-selected", "true");

    // (4) SIGUE HABIENDO POR DÓNDE RECOGERLA — era el `accesoRecogida()` del test original, y es
    // lo que impide repetir el fallo de la 167 (el bloque de escaneo que desaparecía justo cuando
    // iban a buscarlo). No depende del tamaño del grupo de hoy, que aquí es CERO.
    expect(accesoRecogida()).toBeInTheDocument();

    // (2) A UNA SOLA PULSACIÓN, sin buscarla, sin desplegables y sin salir de la pantalla.
    await irAOtroDia(user);
    expect(within(panelActivo()).getByText(/REM-MAN/)).toBeInTheDocument();

    // (3) CON SU MARCA Y SU AVISO, los de siempre (246/R22, 261/R11), palabra por palabra.
    expect(within(cardDe("REM-MAN")).getByText("Para mañana")).toBeInTheDocument();
    expect(
      within(cardDe("REM-MAN")).getByText(
        "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.",
      ),
    ).toBeInTheDocument();
  });

  it("R11: la card de la reservada dice desde QUÉ DÍA se podrá, con la fecha en palabras", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    await irAOtroDia(user);

    // 261/R11: el badge dice QUÉ es la orden; esta línea dice por qué no se puede trabajar y
    // desde cuándo. La fecha la resolvió el SERVIDOR (R14): aquí no se lee ningún reloj.
    expect(
      within(cardDe("REM-MAN")).getByText(
        "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.",
      ),
    ).toBeInTheDocument();
  });
});

// =================================================================================================
// FEATURE 261 (F1/F5, R13) — ESCANEAR O TECLEAR UNA GUÍA RESERVADA PARA OTRO DÍA.
// =================================================================================================
//
// ⏳ ESTO REVIERTE LA DECISIÓN D5 DE LA 246, que decía que la reserva protegía del corte nocturno
// y no del mensajero. La refutó una prueba humana en producción: la guía 17496963 se gestionó
// `entregada` a las 22:10 CR del 21 estando reservada para el 22. Desde el 2026-08-21 una orden
// reservada NO se recoge hasta su día — y el rechazo se dice con el motivo REAL, no como un error
// de la orden ni como un código inválido, que es exactamente lo que R13 prohíbe.
//
// Las dos ramas van en este archivo porque son la misma frase por dos caminos: la SUAVE (el
// cliente lo sabe por el DTO y no llega a llamar) y la del SERVIDOR (la lista venía de antes y el
// servidor rechaza con su código). Los literales, escritos a mano.
describe("RecogerModule — la guía reservada no se recoge (feature 261/R13)", () => {
  const AVISO_22 =
    "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.";

  it("R13: teclear una guía reservada muestra el MOTIVO REAL y NO llama a la action", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          numGuia: 1001,
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "1001");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    // Que el AVISO se diga es la mitad; que la action NO se llame es la otra, y sin ella el caso
    // pasaría igual con una defensa que avisa y recoge de todos modos.
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledWith(AVISO_22));
    expect(recogerMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R13: el rechazo NO se disfraza de guía desconocida ni de código inválido", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          numGuia: 1001,
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "1001");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    // El par del caso anterior. Con el mensaje de «no está entre tus órdenes» el mensajero
    // buscaría un problema que no existe —la orden SÍ es suya— y acabaría llamando a bodega.
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    const dicho = errorMock.mock.calls[0][0] as string;
    expect(dicho).not.toMatch(/no está entre tus órdenes/i);
    expect(dicho).not.toMatch(/inválido/i);
  });

  it("R13: el `conflict` del servidor con su código pinta EL MISMO texto, no el genérico", async () => {
    const user = userEvent.setup();
    // LA CARRERA PERDIDA: el cliente cree que se puede (su lista es de antes de la reserva) y
    // llama; el servidor rechaza y dice por qué con un CÓDIGO DE MÁQUINA, para que la pantalla no
    // tenga que comparar prosa. Sin esta rama el mensajero leería «la orden ya no está por
    // recoger», que es falso, y actualizaría para siempre.
    recogerMock.mockResolvedValue({
      status: "conflict",
      detalle: [
        {
          ordenId: "r1",
          motivo:
            "Esta orden es para un día de reparto posterior. Podrás recogerla y gestionarla ese día.",
          codigo: "reservada_para_otro_dia",
        },
      ],
    });
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          numGuia: 1001,
          esParaManana: false,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "1001");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() => expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["r1"] }));
    // Y con EL DÍA que la orden trae consigo: una regla, dos sitios, un texto.
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledWith(AVISO_22));
    expect(errorMock).not.toHaveBeenCalledWith(
      "La orden ya no está por recoger. Actualiza y vuelve a intentar.",
    );
  });

  it("un `conflict` SIN código sigue diciendo el mensaje de siempre", async () => {
    const user = userEvent.setup();
    // El par negativo: la rama nueva no puede tragarse los conflictos que ya existían («la orden
    // dejó de estar por recoger»), o convertiría un mensaje correcto en uno falso.
    recogerMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "r1", motivo: "estado de origen no permitido: en_reparto" }],
    });
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-HOY", numGuia: 1001 })],
    });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "1001");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La orden ya no está por recoger. Actualiza y vuelve a intentar.",
      ),
    );
  });

  it("R8: la orden de HOY se recoge igual — el bloqueo no se come a las demás", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["r2"] });
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          numGuia: 1001,
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
        makeAsignacion({
          id: "r2",
          numRemision: "REM-HOY",
          numGuia: 1002,
          esParaManana: false,
          fechaRepartoISO: "2026-08-21",
        }),
      ],
    });

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "1002");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    // La mitad POSITIVA de la regla, en la misma pantalla que la negativa: sin ella, un bloqueo
    // que rechazara TODO también pasaría los casos de arriba.
    await vi.waitFor(() => expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["r2"] }));
    expect(errorMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // ⚠️ ESTE TEST VIENE DE LA FEATURE 261 (R9) Y CAMBIÓ DE FORMA CON LA 277 (2026-08-24).
  //
  // Lo que afirmaba: con UNA sola orden reservada, estaba en la región del listado, el banner
  // decía «1 Órdenes nuevas asignadas» y quedaba por dónde recoger. Las dos primeras mitades
  // cambian de sitio —el banner cuenta ahora sólo el grupo de hoy (277/R15/R17) y la orden vive en
  // la pestaña «Para otro día»—; la propiedad que probaban, no.
  //
  // BLOQUEAR NO ES ESCONDER: eso es lo que 261/R9 dice y lo que aquí se sigue afirmando, ahora con
  // las cuatro señales explícitas. La alternativa A7 que el humano descartó al firmar P3 era
  // ESCONDER; esto es lo contrario, y por eso la 277 lo pudo decidir sin tocar R23.
  it("R9 (261, en su forma nueva desde la 277): bloquear no es esconder — contada sin interactuar, a una pulsación, con su aviso y con por dónde recoger", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({
          id: "r1",
          numRemision: "REM-MAN",
          esParaManana: true,
          fechaRepartoISO: "2026-08-22",
        }),
      ],
    });

    // Contada SIN INTERACTUAR, y el conteo se lee del TEXTO de la pestaña (no de un color).
    expect(
      screen.getByRole("tab", { name: "Para otro día (1)" }),
    ).toBeInTheDocument();
    // Y sigue habiendo por dónde recogerla, aunque el grupo de hoy esté vacío: el rechazo dirá el
    // motivo real con su fecha (R13, arriba), que es justo lo que exige que el control esté.
    expect(accesoRecogida()).toBeInTheDocument();

    await irAOtroDia(user);

    const panel = panelActivo();
    expect(within(panel).getByText(/REM-MAN/)).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.",
      ),
    ).toBeInTheDocument();
  });
});

// =================================================================================================
// FEATURE 277 (2026-08-24) — «POR RECOGER» SEPARA EN PESTAÑAS LO DE HOY DE LO RESERVADO.
// =================================================================================================
//
// EL CASO QUE ABRIÓ LA FICHA, MEDIDO EN PRODUCCIÓN EL 2026-08-24: 2 órdenes en `por_recoger`, 1 de
// hoy y 1 reservada para después, y la cabecera decía «2 Órdenes nuevas asignadas» con 1 sola
// recogible. Desde el 2026-08-21 (feature 261) el servidor RECHAZA recoger una orden reservada, así
// que la lista mezclaba el trabajo del día con lo que iba a ser rechazado.
//
// LO QUE ESTA FICHA NO HACE, Y HAY QUE SEGUIR VIENDO EN VERDE: ocultar. 246/R23 sigue vigente e
// intocado. Cambia el SITIO, no la VISIBILIDAD — las dos pestañas están siempre montadas, cada una
// dice cuántas tiene sin que nadie interactúe y ninguna orden queda a más de una pulsación.
//
// ⚠️ LOS DOS NOMBRES DE PESTAÑA VAN ESCRITOS A MANO, con su conteo, y nunca importados: son la
// decisión más cara de deshacer de la ficha y una aserción contra su propia fuente está siempre
// verde.
describe("RecogerModule — los dos grupos en pestañas (feature 277)", () => {
  /** La card de una remisión, sea cual sea la vista montada. */
  function cardDe(numRemision: string): HTMLElement {
    return screen.getByRole("article", {
      name: new RegExp(`Orden ${numRemision}`),
    });
  }

  const HOY = (over: Partial<MiAsignacionDTO> & { id: string }) =>
    makeAsignacion({ esParaManana: false, ...over });
  const OTRO_DIA = (over: Partial<MiAsignacionDTO> & { id: string }) =>
    makeAsignacion({
      esParaManana: true,
      fechaRepartoISO: "2026-08-25",
      ...over,
    });

  it("R1: monta exactamente dos pestañas, y ninguna ruta ni entrada de menú nuevas", () => {
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Los paneles no se mantienen montados: sólo el activo está en el DOM (así no hay dos
    // listados a la vez ni nombres accesibles duplicados).
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    // Y las pestañas son BOTONES, no enlaces: no hay ruta nueva que enlazar ni entrada de menú
    // que mantener. Si un día alguien las convirtiera en `<a href>`, este test lo diría.
    expect(pestanaHoy().tagName).toBe("BUTTON");
    expect(pestanaOtroDia().tagName).toBe("BUTTON");
    expect(
      within(listado()).queryByRole("link", { name: /Para otro día/i }),
    ).toBeNull();
  });

  it("R25/R26: los nombres de las pestañas, literales a mano — y ninguno dice «mañana» ni «reserva»", () => {
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-M1" }),
        OTRO_DIA({ id: "r3", numRemision: "REM-M2" }),
      ],
    });

    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (2)" }),
    ).toBeInTheDocument();
    // R26: el día de reparto admite +2 (pasó en producción el 2026-08-21 con la guía 17496963),
    // así que un grupo llamado «Para mañana» mentiría en cuanto contuviera una de pasado mañana.
    // Y «reserva» es jerga que este repo retiró del texto visible a propósito.
    expect(screen.queryByRole("tab", { name: /mañana/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /reserv/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /\d{4}-\d{2}-\d{2}/ })).toBeNull();
  });

  it("R8: cada pestaña dice cuántas tiene, incluido el cero, sin interactuar", () => {
    // SIN NINGÚN `user.click`: el conteo tiene que estar a la vista de entrada. Es lo que sostiene
    // que aquí no se esconde nada — un interruptor apagado no dice cuántas hay al otro lado.
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-H1" }),
        HOY({ id: "r2", numRemision: "REM-H2" }),
      ],
    });

    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (0)" }),
    ).toBeInTheDocument();
  });

  it("R7: con un grupo vacío la pestaña sigue montada, habilitada y a una pulsación", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [HOY({ id: "r1", numRemision: "REM-H1" })],
    });

    const vacia = pestanaOtroDia();
    expect(vacia).toBeInTheDocument();
    // Ni deshabilitada ni fuera del recorrido: la feature 167 nació de un panel que hacía
    // `if (length === 0) return null` y desaparecía justo cuando iban a buscarlo.
    expect(vacia).not.toBeDisabled();
    expect(vacia).not.toHaveAttribute("aria-disabled", "true");

    await user.click(vacia);

    expect(vacia).toHaveAttribute("aria-selected", "true");
    expect(
      within(panelActivo()).getByText("No hay órdenes para otro día."),
    ).toBeInTheDocument();
  });

  it("R7: con los DOS grupos vacíos siguen las dos pestañas, con su cero", () => {
    renderModule({ porRecoger: [] });

    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (0)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (0)" }),
    ).toBeInTheDocument();
  });

  it("R7: el recorrido de teclado llega a las dos — la flecha mueve entre pestañas", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    pestanaHoy().focus();
    await user.keyboard("{ArrowRight}");

    // Patrón ARIA de tabs (foco itinerante): la flecha lleva el foco a la siguiente pestaña. Sin
    // esto, el grupo de otro día sólo sería alcanzable con el ratón.
    expect(document.activeElement).toBe(pestanaOtroDia());
  });

  it("R12: entra por la pestaña de hoy aunque esté VACÍA y la otra tenga órdenes", () => {
    // Q3, firmada por el humano el 2026-08-24: entrada fija. Una pantalla que cambia de puerta
    // según el día es una pantalla que no se puede aprender; el vacío se explica y se señala.
    renderModule({
      porRecoger: [OTRO_DIA({ id: "r1", numRemision: "REM-MAN" })],
    });

    expect(pestanaHoy()).toHaveAttribute("aria-selected", "true");
    expect(pestanaOtroDia()).toHaveAttribute("aria-selected", "false");
    expect(
      within(panelActivo()).getByText("No hay órdenes por recoger hoy."),
    ).toBeInTheDocument();
  });

  it("R9: la orden reservada está a UNA pulsación — no hace falta buscarla", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    await user.click(pestanaOtroDia());

    expect(within(panelActivo()).getByText(/REM-MAN/)).toBeInTheDocument();
    // Y sin haber escrito nada: el buscador sigue vacío. Si llegar a ella exigiera buscarla, la
    // orden estaría escondida con otro nombre.
    expect(buscador()).toHaveValue("");
  });

  it("R6: cuando el servidor deja de marcarla, pasa a la pestaña de hoy sin ninguna acción", () => {
    // 246/R25: la marca CADUCA SOLA al llegar el día, sin que nadie ejecute nada y sin escribir en
    // la base. El `rerender` con el MISMO id es el refresco del listado, no una interacción.
    const { rerender } = renderModule({
      porRecoger: [OTRO_DIA({ id: "r1", numRemision: "REM-MAN" })],
    });

    expect(
      screen.getByRole("tab", { name: "Para otro día (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (0)" }),
    ).toBeInTheDocument();

    rerender(
      <RecogerModule
        porRecoger={[
          makeAsignacion({
            id: "r1",
            numRemision: "REM-MAN",
            esParaManana: false,
            fechaRepartoISO: "2026-08-25",
          }),
        ]}
        bloqueo={SIN_BLOQUEO}
      />,
    );

    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (0)" }),
    ).toBeInTheDocument();
    // Y se ve, sin tocar nada: la pestaña activa sigue siendo la de hoy.
    expect(within(panelActivo()).getByText(/REM-MAN/)).toBeInTheDocument();
  });

  it("R3: el DTO viejo (sin el campo) no inventa la marca ni cambia de pestaña", () => {
    renderModule({
      porRecoger: [makeAsignacion({ id: "r1", numRemision: "REM-VIEJA" })],
    });

    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (0)" }),
    ).toBeInTheDocument();
    expect(within(panelActivo()).getByText(/REM-VIEJA/)).toBeInTheDocument();
    expect(within(cardDe("REM-VIEJA")).queryByText("Para mañana")).toBeNull();
  });

  it("R15: el contador dice 1 con 1 de hoy y 1 reservada (el caso medido en producción)", () => {
    // EL CORAZÓN DE LA FICHA. Antes del 2026-08-24 esta misma pantalla decía «2 Órdenes nuevas
    // asignadas» con 1 sola recogible.
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY", numGuia: 1001 }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN", numGuia: 2002 }),
      ],
    });

    expect(
      within(panelActivo()).getByText("1 orden nueva asignada"),
    ).toBeInTheDocument();
    // La mitad negativa, sin la cual un contador que contara todo pasaría igual.
    expect(screen.queryByText("2 órdenes nuevas asignadas")).toBeNull();
    expect(screen.queryByText(/2 Órdenes nuevas asignadas/)).toBeNull();
  });

  it("R17: sin órdenes de hoy NO hay contador (el vacío lo explica su mensaje)", () => {
    renderModule({
      porRecoger: [OTRO_DIA({ id: "r1", numRemision: "REM-MAN" })],
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/orden(es)? nueva(s)? asignada(s)?/)).toBeNull();
    expect(
      within(panelActivo()).getByText("No hay órdenes por recoger hoy."),
    ).toBeInTheDocument();
  });

  it("R17: el contador NO se ve desde la otra pestaña — está junto al listado que cuenta", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "1 orden nueva asignada",
    );

    await user.click(pestanaOtroDia());

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("R10: el vacío de cada pestaña nombra SU grupo, y el de la búsqueda dice otra cosa", async () => {
    const user = userEvent.setup();
    const { unmount } = renderModule({ porRecoger: [] });

    expect(
      within(panelActivo()).getByText("No hay órdenes por recoger hoy."),
    ).toBeInTheDocument();
    await user.click(pestanaOtroDia());
    expect(
      within(panelActivo()).getByText("No hay órdenes para otro día."),
    ).toBeInTheDocument();

    // Y el vacío POR BÚSQUEDA es otro texto: sin la distinción, el mensajero no sabría si le falta
    // trabajo o le sobra filtro.
    unmount();
    renderModule({
      porRecoger: [HOY({ id: "r1", numRemision: "REM-HOY" })],
    });
    await user.type(buscador(), "zzzinexistente");

    expect(
      within(panelActivo()).getByText(
        "Ninguna guía por recoger coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay órdenes por recoger hoy.")).toBeNull();
  });

  it("R11: la pestaña vacía nombra la otra y cuántas hay allí", () => {
    renderModule({
      porRecoger: [
        OTRO_DIA({ id: "r1", numRemision: "REM-M1" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-M2" }),
      ],
    });

    expect(
      within(panelActivo()).getByText("Hay 2 órdenes en «Para otro día»."),
    ).toBeInTheDocument();
  });

  it("R11: con UNA sola al otro lado el puntero concuerda en singular", () => {
    renderModule({
      porRecoger: [OTRO_DIA({ id: "r1", numRemision: "REM-M1" })],
    });

    expect(
      within(panelActivo()).getByText("Hay 1 orden en «Para otro día»."),
    ).toBeInTheDocument();
  });

  it("R21: buscar la guía de una orden de otro día dice DÓNDE está, no que no existe", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY", numGuia: 1001 }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN", numGuia: 2002 }),
      ],
    });

    await user.type(buscador(), "2002");

    // «Ninguna coincide» a secas sería FALSO: la guía está, en la otra pestaña, y el mensajero la
    // tiene en la mano. Ésta es la familia de fallos que este repo tiene escrita: el sistema no
    // falla, aparenta.
    const panel = panelActivo();
    expect(
      within(panel).getByText(
        "Ninguna guía por recoger coincide con la búsqueda.",
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Hay 1 coincidencia en «Para otro día»."),
    ).toBeInTheDocument();
    // Y el número dice COINCIDENCIAS, no órdenes: con filtro, «1 orden» sería un número que no
    // corresponde a nada que el mensajero pueda ver.
    expect(screen.queryByText("Hay 1 orden en «Para otro día».")).toBeNull();
  });

  it("R13: una búsqueda sin coincidencias NO cambia de pestaña", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY", numGuia: 1001 }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN", numGuia: 2002 }),
      ],
    });

    await user.type(buscador(), "2002");

    // Al teclear progresivamente, una pestaña que saltara sola se movería bajo el pulgar con cada
    // carácter. Se le dice dónde está y la pulsa él.
    expect(pestanaHoy()).toHaveAttribute("aria-selected", "true");
    expect(pestanaOtroDia()).toHaveAttribute("aria-selected", "false");
  });

  it("R13: recoger la última de hoy tampoco cambia de pestaña", () => {
    // El otro camino por el que la pantalla podría saltar sola: el grupo activo se queda vacío
    // tras un refresco. La pestaña la elige el mensajero, siempre.
    const { rerender } = renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    rerender(
      <RecogerModule
        porRecoger={[
          makeAsignacion({
            id: "r2",
            numRemision: "REM-MAN",
            esParaManana: true,
            fechaRepartoISO: "2026-08-25",
          }),
        ]}
        bloqueo={SIN_BLOQUEO}
      />,
    );

    expect(pestanaHoy()).toHaveAttribute("aria-selected", "true");
    expect(
      within(panelActivo()).getByText("No hay órdenes por recoger hoy."),
    ).toBeInTheDocument();
  });

  it("R18: un SOLO campo de búsqueda, y filtra los dos grupos", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-H1", destinatario: "Ana Solís" }),
        HOY({ id: "r2", numRemision: "REM-H2", destinatario: "Beto Ruiz" }),
        OTRO_DIA({ id: "r3", numRemision: "REM-M1", destinatario: "Ana Mora" }),
        OTRO_DIA({ id: "r4", numRemision: "REM-M2", destinatario: "Beto Paz" }),
      ],
    });

    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    await user.type(buscador(), "ana");

    expect(within(panelActivo()).getByText(/REM-H1/)).toBeInTheDocument();
    expect(within(panelActivo()).queryByText(/REM-H2/)).toBeNull();

    await user.click(pestanaOtroDia());

    // El MISMO texto aplicado al otro grupo: si sólo mirara la pestaña activa, cambiar de pestaña
    // devolvería la lista entera y el filtro sería una ilusión.
    expect(within(panelActivo()).getByText(/REM-M1/)).toBeInTheDocument();
    expect(within(panelActivo()).queryByText(/REM-M2/)).toBeNull();
  });

  it("R19: el texto de la búsqueda sobrevive al cambio de pestaña", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-H1", destinatario: "Ana Solís" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-M1", destinatario: "Ana Mora" }),
      ],
    });

    await user.type(buscador(), "ana");
    await user.click(pestanaOtroDia());

    expect(buscador()).toHaveValue("ana");
    await user.click(pestanaHoy());
    expect(buscador()).toHaveValue("ana");
  });

  it("R20: buscar no mueve NINGÚN contador — ni el de la cabecera ni los de las pestañas", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-H1", destinatario: "Ana Solís" }),
        HOY({ id: "r2", numRemision: "REM-H2", destinatario: "Beto Ruiz" }),
        OTRO_DIA({ id: "r3", numRemision: "REM-M1", destinatario: "Ana Mora" }),
      ],
    });

    await user.type(buscador(), "ana");

    // Una sola regla para toda la pantalla: los contadores cuentan lo que el mensajero TIENE; el
    // buscador sólo cambia lo que se VE.
    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 órdenes nuevas asignadas",
    );
  });

  it("R22: los controles de recogida no dependen de la pestaña activa", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY", numGuia: 1001 }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN", numGuia: 2002 }),
      ],
    });

    expect(accesoRecogida()).toBeInTheDocument();
    await user.click(pestanaOtroDia());
    expect(accesoRecogida()).toBeInTheDocument();
    await user.click(pestanaHoy());
    expect(accesoRecogida()).toBeInTheDocument();
  });

  it("R22: con SÓLO órdenes de otro día los controles siguen montados", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: [] });
    renderModule({
      porRecoger: [
        OTRO_DIA({ id: "r1", numRemision: "REM-MAN", numGuia: 2002 }),
      ],
    });

    // Q4, confirmada como NO-CAMBIO el 2026-08-24: retirarlos sería repetir el fallo de la 167. Y
    // no es un adorno: al teclear la guía, el rechazo dice el MOTIVO REAL con su fecha (261/R13).
    expect(accesoRecogida()).toBeInTheDocument();

    await abrirRecogida(user);
    const region = screen.getByRole("region", {
      name: "Recoger por número de guía o escaneo",
    });
    await user.type(within(region).getByLabelText("Número de guía"), "2002");
    await user.click(within(region).getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Esta orden es para el reparto del 25 de agosto. Ese día podrás recogerla y gestionarla.",
      ),
    );
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("R14: tras recoger y refrescar se conservan pestaña, búsqueda y vista", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-H1", destinatario: "Ana Solís" }),
        HOY({ id: "r2", numRemision: "REM-H2", destinatario: "Ana Ruiz" }),
        OTRO_DIA({ id: "r3", numRemision: "REM-M1", destinatario: "Ana Mora" }),
      ],
    });

    await user.click(pestanaOtroDia());
    await user.type(buscador(), "ana");
    await cambiarVista(user, "Detalle");
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Órdenes para otro día" }),
      ).toBeNull(),
    );

    // `router.refresh()` re-renderiza con datos nuevos SIN desmontar el árbol cliente: es esto.
    rerender(
      <RecogerModule
        porRecoger={[
          makeAsignacion({
            id: "r2",
            numRemision: "REM-H2",
            destinatario: "Ana Ruiz",
            esParaManana: false,
          }),
          makeAsignacion({
            id: "r3",
            numRemision: "REM-M1",
            destinatario: "Ana Mora",
            esParaManana: true,
            fechaRepartoISO: "2026-08-25",
          }),
        ]}
        bloqueo={SIN_BLOQUEO}
      />,
    );

    expect(pestanaOtroDia()).toHaveAttribute("aria-selected", "true");
    expect(buscador()).toHaveValue("ana");
    const grupoVista = screen.getByRole("group", {
      name: "Vista de las órdenes",
    });
    expect(
      within(grupoVista).getByRole("button", { name: "Detalle" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("R24: bloqueado — sin controles, con aviso, y las dos pestañas con sus listados visibles", async () => {
    const user = userEvent.setup();
    renderModule({
      bloqueo: bloqueoConVencido(),
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY", numGuia: 1001 }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN", numGuia: 2002 }),
      ],
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(accesoRecogida()).toBeNull();
    // Solo-visualización: los dos grupos siguen a la vista, con sus conteos y a una pulsación.
    expect(
      screen.getByRole("tab", { name: "Para recoger hoy (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Para otro día (1)" }),
    ).toBeInTheDocument();
    expect(within(panelActivo()).getByText(/REM-HOY/)).toBeInTheDocument();

    await user.click(pestanaOtroDia());

    expect(within(panelActivo()).getByText(/REM-MAN/)).toBeInTheDocument();
  });

  it("R27: la pestaña activa y los conteos se leen del texto y de `aria-selected`, no del color", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    // (a) Cuál está activa: atributo, no tono.
    expect(pestanaHoy()).toHaveAttribute("aria-selected", "true");
    expect(pestanaOtroDia()).toHaveAttribute("aria-selected", "false");
    await user.click(pestanaOtroDia());
    expect(pestanaHoy()).toHaveAttribute("aria-selected", "false");
    expect(pestanaOtroDia()).toHaveAttribute("aria-selected", "true");

    // (b) Cuántas tiene cada una: EN EL TEXTO de la pestaña, no en un punto de otro tono.
    expect(pestanaHoy()).toHaveTextContent("Para recoger hoy (1)");
    expect(pestanaOtroDia()).toHaveTextContent("Para otro día (1)");

    // (c) Y la primitiva distingue la activa por PESO y SOMBRA además del relleno, así que la
    // diferencia se percibe sin depender del color. (R34: el anillo de foco no se toca aquí; tiene
    // ficha propia, la 226.)
    expect(pestanaHoy().className).toMatch(/aria-selected:font-semibold/);
    expect(pestanaHoy().className).toMatch(/aria-selected:shadow-sm/);
  });

  it("R28: el grupo de pestañas tiene nombre, cada panel cuelga de su pestaña y los listados se llaman distinto", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        HOY({ id: "r1", numRemision: "REM-HOY" }),
        OTRO_DIA({ id: "r2", numRemision: "REM-MAN" }),
      ],
    });

    // Los tres nombres accesibles de la pantalla son DISTINTOS a propósito: si coincidieran, el de
    // uno chocaría con el de otro.
    expect(
      screen.getByRole("tablist", { name: "Grupos de órdenes por recoger" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Buscar guías por recoger" }),
    ).toBeInTheDocument();
    expect(listado()).toBeInTheDocument();

    // El panel cuelga de SU pestaña. Se afirma sobre el DOM renderizado y no se da por hecho que
    // la primitiva lo cablee.
    expect(panelActivo()).toHaveAttribute(
      "aria-labelledby",
      pestanaHoy().getAttribute("id"),
    );
    // Y el listado del grupo de hoy conserva su nombre de siempre.
    expect(
      screen.getByRole("region", { name: "Órdenes por recoger" }),
    ).toBeInTheDocument();

    await user.click(pestanaOtroDia());

    expect(panelActivo()).toHaveAttribute(
      "aria-labelledby",
      pestanaOtroDia().getAttribute("id"),
    );
    // El otro listado se llama DISTINTO: sin esto, saber en qué grupo estás dependería de mirar
    // cuál pestaña se ve resaltada.
    expect(
      screen.getByRole("region", { name: "Órdenes para otro día" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Órdenes por recoger" }),
    ).toBeNull();
  });
});
