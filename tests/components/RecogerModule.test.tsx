// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecogerModule } from "@/app/(app)/mis-asignaciones/_components/RecogerModule";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

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
      bloqueado={props?.bloqueado ?? false}
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

describe("RecogerModule — bloqueo del mensajero (feature 111)", () => {
  it("R12: bloqueado muestra el aviso de bloqueo total", () => {
    renderModule({
      bloqueado: true,
      porRecoger: [makeAsignacion({ id: "r1" })],
    });

    expect(
      screen.getByText(
        /no puedes gestionar entregas ni cobrar hasta resolver tu cierre/i,
      ),
    ).toBeInTheDocument();
  });

  it("R14: bloqueado oculta los controles de recoger (input + escáner) y deja el listado", () => {
    renderModule({
      bloqueado: true,
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
      screen.queryByText(/no puedes gestionar entregas ni cobrar/i),
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
