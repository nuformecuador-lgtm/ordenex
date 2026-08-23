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

  it("Feature 63: muestra el banner con el contador de órdenes nuevas asignadas", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-R1" }),
        makeAsignacion({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    expect(
      within(listado()).getByText("2 Órdenes nuevas asignadas"),
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
    expect(screen.getByText("No hay órdenes por recoger.")).toBeInTheDocument();
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
    // DISTINGUIBLE del vacío sin búsqueda.
    expect(screen.queryByText("No hay órdenes por recoger.")).toBeNull();
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

    // Sigue diciendo 2: lo pendiente de recoger no cambia porque se filtre la vista.
    expect(
      within(listado()).getByText("2 Órdenes nuevas asignadas"),
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
    expect(screen.getByText("No hay órdenes por recoger.")).toBeInTheDocument();
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

  it("R22: la card de la orden reservada dice «Para mañana» CON PALABRAS, y la de hoy no", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-MAN", esParaManana: true }),
        makeAsignacion({ id: "r2", numRemision: "REM-HOY", esParaManana: false }),
      ],
    });

    // La presencia y la ausencia, EMPAREJADAS y en la misma pantalla: sola, la ausencia
    // pasaría en verde también si la segunda card no se hubiera renderizado.
    expect(within(cardDe("REM-MAN")).getByText("Para mañana")).toBeInTheDocument();
    expect(within(cardDe("REM-HOY")).queryByText("Para mañana")).toBeNull();
  });

  it("R22: también lo dice en la vista DETALLE — la marca no depende de cómo se mire", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-MAN", esParaManana: true }),
      ],
    });

    await cambiarVista(user, "Detalle");

    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Órdenes por recoger" }),
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

  it("R23: la orden reservada APARECE en su grupo de siempre — no se oculta ni se mueve", () => {
    renderModule({
      porRecoger: [
        makeAsignacion({ id: "r1", numRemision: "REM-MAN", esParaManana: true }),
      ],
    });

    const region = listado();
    expect(within(region).getByText(/REM-MAN/)).toBeInTheDocument();
    // Y cuenta en el contador del grupo: reservar no la saca de lo que el mensajero tiene
    // pendiente de recoger.
    expect(
      within(region).getByText("1 Órdenes nuevas asignadas"),
    ).toBeInTheDocument();
    // Sigue habiendo por donde recogerla (la tarjeta de recogida se monta con el grupo lleno).
    expect(accesoRecogida()).toBeInTheDocument();
  });

  it("R11: la card de la reservada dice desde QUÉ DÍA se podrá, con la fecha en palabras", () => {
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

  it("R9: y la reservada SIGUE en su grupo, contada y visible", () => {
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

    // Bloquear no es esconder. La orden se queda donde el mensajero la busca, con su marca y con
    // su explicación: sacarla de la lista sería empezar a ocultarla (R9, y la alternativa A7 que
    // el humano descartó al firmar P3).
    const region = listado();
    expect(within(region).getByText(/REM-MAN/)).toBeInTheDocument();
    expect(within(region).getByText("1 Órdenes nuevas asignadas")).toBeInTheDocument();
    expect(accesoRecogida()).toBeInTheDocument();
  });
});
