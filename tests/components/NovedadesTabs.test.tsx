// @vitest-environment jsdom
// FEATURE 236 (T4.1/T4.2/T4.3/T4.5 — R1/R2/R8/R12/R13/R15/R16) — LAS TRES PESTAÑAS DE `/novedades`.
//
// **El defecto que cierran.** Hasta el 2026-08-19 esta pantalla listaba DOS POBLACIONES bajo UNA
// sola pestaña, porque el predicado del servidor era un `OR` de dos igualdades de estado. Una orden
// sobre la que un mensajero pedía ayuda aparecía bajo «En devolución», bajo un subtítulo que no era
// cierto de ella y con un juego de botones que presuponía una devolución que nunca ocurrió.
//
// **Lo que este archivo mide y ningún test de servidor puede medir:** que la pantalla ofrece las
// tres superficies, que cada panel es el SUYO (rótulos, nombres accesibles y estado vacío propios,
// no los del vecino) y que cambiar de pestaña no reinicia la paginación de la otra.
//
// ⚠️ LOS TEXTOS SE AFIRMAN COMO LITERAL, no contra la constante que los genera. Comparar un texto
// con su propia fuente está siempre verde: seguiría pasando con el rótulo mal escrito, que es
// exactamente lo que este repo ya pagó una vez (siete etiquetas rotas que doce mil tests daban por
// buenas). Si un literal de aquí y `TEXTOS_POR_GRUPO` divergen, esto se pone rojo y hay que venir a
// decidir cuál manda.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadesTabs } from "@/app/(app)/novedades/_components/NovedadesTabs";
import { listarNovedadesAction } from "@/lib/actions/novedades";
import type { NovedadDTO } from "@/lib/types/novedad";

vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({ reprogramarNovedad: vi.fn() }));
vi.mock("@/lib/actions/habilitar-novedad", () => ({ habilitarNovedad: vi.fn() }));
vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));
vi.mock("@/lib/actions/rechazos-sla-tienda", () => ({
  listarRechazosSlaTiendaAction: vi.fn(),
}));

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

const listarNovedadesMock = vi.mocked(listarNovedadesAction);

function novedad(over: Partial<NovedadDTO> & { id: string }): NovedadDTO {
  return {
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "devuelta",
    intentosContacto: 0,
    destinatario: "Ana Cliente",
    telefonoDest: "88887777",
    direccion: "Av. Central 120",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 24500,
    latitud: 9.9281,
    longitud: -84.0907,
    notas: null,
    tiendaNombre: "Tienda Demo",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: null,
    causa: "not_found",
    intentosEntrega: 2,
    ...over,
  };
}

const VACIO = { items: [], total: 0, page: 1, pageSize: 10 };

function renderTabs(
  over: {
    ayuda?: { items: NovedadDTO[]; total: number; page: number; pageSize: number };
    devolucion?: { items: NovedadDTO[]; total: number; page: number; pageSize: number };
  } = {},
) {
  return render(
    <NovedadesTabs
      novedades={{
        ayuda: over.ayuda ?? VACIO,
        devolucion: over.devolucion ?? VACIO,
      }}
      rechazosSla={VACIO}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NovedadesTabs — las tres superficies (236/R1/R13)", () => {
  it("R1/R13: hay TRES pestañas, con sus rótulos en español y sin jerga", () => {
    renderTabs();

    const lista = screen.getByRole("tablist", { name: "Vistas de novedades" });
    expect(
      within(lista)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual([
      "Ayuda solicitada",
      "En devolución",
      "Rechazadas por plazo vencido",
    ]);
  });

  it("D6: la de AYUDA va PRIMERA, y es la que está seleccionada al entrar", () => {
    renderTabs();

    // El orden lo fija `GRUPOS_NOVEDAD`, no este componente: alguien está esperando respuesta
    // AHORA y una devolución no espera a nadie con esa urgencia.
    const tabs = within(
      screen.getByRole("tablist", { name: "Vistas de novedades" }),
    ).getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Ayuda solicitada");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // Y el rótulo NO usa el verbo del mensajero: «gestionar» significa otra cosa en esta app, y
    // desde ayuda es la ficha 237. Es el apartamiento deliberado del §F2 del diseño de la pila.
    expect(screen.queryByRole("tab", { name: "Ayuda a gestionar" })).toBeNull();
  });

  it("R16: la pestaña de ayuda vacía HABLA — dice qué aparecerá ahí y cuándo", async () => {
    const user = userEvent.setup();
    // Es el PRIMER estado que la tienda va a conocer y durante un tiempo el único: medido el
    // 2026-08-19 en producción, `ayuda_tienda` = 0 sobre 141 órdenes vivas en 11 estatus. Un vacío
    // mudo se lee como una pantalla rota.
    renderTabs({ devolucion: { items: [novedad({ id: "o1" })], total: 1, page: 1, pageSize: 10 } });

    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText("Ningún mensajero te pidió ayuda"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "Cuando un mensajero necesite que resuelvas algo de una orden que lleva encima, aparecerá acá con su mensaje.",
      ),
    ).toBeInTheDocument();
    // Y NO se renderiza una lista sin filas: el vacío es un `role="status"`, no una `<ul>` pelada.
    expect(
      within(panel).queryByRole("list", { name: "Órdenes con ayuda solicitada" }),
    ).toBeNull();
    // Tampoco hereda el vacío del vecino, que afirma algo que no es cierto de esta población
    // («cuando una de tus órdenes vuelva a la tienda»: estas nunca volvieron, siguen en la calle).
    expect(within(panel).queryByText("No tenés órdenes en devolución")).toBeNull();

    // CONTROL POSITIVO de las dos ausencias: con órdenes, ese mismo panel SÍ monta su lista y el
    // texto del vacío desaparece. Sin este par, las negativas pasarían con el panel sin montar.
    cleanup();
    renderTabs({
      ayuda: {
        items: [novedad({ id: "a1", estatusValue: "ayuda_tienda" })],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    });
    const conFilas = screen.getByRole("tabpanel");
    expect(
      within(conFilas).getByRole("list", { name: "Órdenes con ayuda solicitada" }),
    ).toBeInTheDocument();
    expect(within(conFilas).queryByText("Ningún mensajero te pidió ayuda")).toBeNull();
    await user.tab(); // deja el foco en un sitio estable; no afirma nada
  });

  it("T4.2: cada panel tiene SUS nombres accesibles, no los del otro", async () => {
    const user = userEvent.setup();
    renderTabs({
      ayuda: {
        items: [novedad({ id: "a1", estatusValue: "ayuda_tienda" })],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      devolucion: { items: [novedad({ id: "o1" })], total: 1, page: 1, pageSize: 10 },
    });

    // Pestaña de AYUDA (la de entrada).
    const ayuda = screen.getByRole("tabpanel");
    expect(
      within(ayuda).getByRole("list", { name: "Órdenes con ayuda solicitada" }),
    ).toBeInTheDocument();
    expect(
      within(ayuda).getByRole("navigation", {
        name: "Paginación de las órdenes con ayuda solicitada",
      }),
    ).toBeInTheDocument();
    expect(
      within(ayuda).getByRole("button", { name: "Descargar Ayuda solicitada" }),
    ).toBeInTheDocument();
    // Y NINGUNO de los del vecino.
    expect(within(ayuda).queryByRole("list", { name: "Órdenes en devolución" })).toBeNull();
    expect(
      within(ayuda).queryByRole("navigation", { name: "Paginación de novedades" }),
    ).toBeNull();
    expect(within(ayuda).queryByRole("button", { name: "Descargar Novedades" })).toBeNull();

    // Pestaña de DEVOLUCIÓN: el espejo exacto, que es lo que convierte las cuatro ausencias de
    // arriba en una afirmación y no en «no había nada montado».
    await user.click(screen.getByRole("tab", { name: "En devolución" }));
    const devolucion = await waitFor(() => {
      const p = screen
        .getAllByRole("tabpanel")
        .find((n) => within(n).queryByRole("list", { name: "Órdenes en devolución" }));
      if (!p) throw new Error("el panel de devoluciones no está visible");
      return p;
    });
    expect(
      within(devolucion).getByRole("navigation", { name: "Paginación de novedades" }),
    ).toBeInTheDocument();
    expect(
      within(devolucion).getByRole("button", { name: "Descargar Novedades" }),
    ).toBeInTheDocument();
    expect(
      within(devolucion).queryByRole("list", { name: "Órdenes con ayuda solicitada" }),
    ).toBeNull();
  });
});

describe("NovedadesTabs — R12: la paginación sobrevive al cambio de pestaña", () => {
  it("cambiar de pestaña y volver NO reinicia la página de la otra", async () => {
    const user = userEvent.setup();
    // `keepMounted`: cada panel tiene su propia paginación por Server Action y su propio estado.
    // Si el panel se desmontara al cambiar de pestaña, volver lo devolvería a la página 1 — y la
    // tienda perdería su sitio cada vez que mira la otra superficie.
    listarNovedadesMock.mockResolvedValue({
      status: "ok",
      items: [novedad({ id: "o2", numRemision: "REM-002" })],
      total: 25,
      page: 2,
      pageSize: 10,
    });
    renderTabs({
      devolucion: { items: [novedad({ id: "o1" })], total: 25, page: 1, pageSize: 10 },
    });

    await user.click(screen.getByRole("tab", { name: "En devolución" }));
    const paginacion = await screen.findByRole("navigation", {
      name: "Paginación de novedades",
    });
    expect(within(paginacion).getByText("1-10 de 25")).toBeInTheDocument();

    await user.click(within(paginacion).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(within(paginacion).getByText("11-20 de 25")).toBeInTheDocument(),
    );

    // Ida y vuelta por la pestaña de ayuda.
    await user.click(screen.getByRole("tab", { name: "Ayuda solicitada" }));
    await user.click(screen.getByRole("tab", { name: "En devolución" }));

    // Sigue en la 2. Con el panel desmontado esto diría «1-10 de 25».
    expect(
      within(
        screen.getByRole("navigation", { name: "Paginación de novedades" }),
      ).getByText("11-20 de 25"),
    ).toBeInTheDocument();
    // Y el re-fetch se hizo UNA sola vez: cambiar de pestaña no vuelve a pedir la página.
    expect(listarNovedadesMock).toHaveBeenCalledTimes(1);
  });
});

describe("NovedadesTabs — R2/R8: la partición es del SERVIDOR, no de la pantalla", () => {
  it("el panel pinta LO QUE RECIBE: no filtra una orden de otro grupo", () => {
    // La 235 aprendió a la mala que un corte de cliente deja la orden alcanzable por otras vías: el
    // apartado de ayuda del portal del mensajero era un `useMemo` y la orden seguía siendo parada
    // del optimizador, del mapa y del panel de gestión. Aquí el corte nace en el servidor o no
    // nace, y este caso lo prueba desde el lado del cliente: si al panel de ayuda le llega una
    // orden `devuelta`, la PINTA. Un módulo que la filtrara pasaría por correcto tapando que el
    // predicado del servidor está mal.
    renderTabs({
      ayuda: {
        items: [
          novedad({ id: "a1", estatusValue: "ayuda_tienda", destinatario: "Ana Cliente" }),
          novedad({ id: "o9", estatusValue: "devuelta", destinatario: "Beto Cliente" }),
        ],
        total: 2,
        page: 1,
        pageSize: 10,
      },
    });

    const lista = screen.getByRole("list", { name: "Órdenes con ayuda solicitada" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    // Y cada fila lleva SU juego de botones, decidido por el estado de LA FILA y no por la pestaña:
    // la de ayuda tiene la conversación, la intrusa tiene «Reprogramar».
    expect(
      within(lista).getByRole("button", {
        name: "Abrir la conversación de la orden de Ana Cliente",
      }),
    ).toBeInTheDocument();
    expect(
      within(lista).getByRole("button", { name: "Reprogramar la orden de Beto Cliente" }),
    ).toBeInTheDocument();
    // El control negativo del par: la de ayuda NO gana «Reprogramar» por estar al lado de una
    // devolución, ni la devolución gana la conversación por estar en la pestaña de ayuda.
    expect(
      within(lista).queryByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    ).toBeNull();
    expect(
      within(lista).queryByRole("button", {
        name: "Abrir la conversación de la orden de Beto Cliente",
      }),
    ).toBeNull();
  });
});
