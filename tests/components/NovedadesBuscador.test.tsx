// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LIMPIAR_BUSQUEDA,
  NovedadesModule,
  SIN_COINCIDENCIAS_TITULO,
} from "@/app/(app)/novedades/_components/NovedadesModule";
import { NovedadesTabs } from "@/app/(app)/novedades/_components/NovedadesTabs";
import { avisoLimite } from "@/app/(app)/novedades/_components/NovedadesFiltrosBarra";
import { TEXTOS_POR_GRUPO } from "@/app/(app)/novedades/_components/novedad-grupo-textos";
import {
  listarAyudaTiendaCompletoAction,
  listarNovedadesCompletoAction,
} from "@/lib/actions/novedades";
import type { NovedadDTO } from "@/lib/types/novedad";

// FICHA 325 — EL BUSCADOR Y LOS FILTROS DE `/novedades`, ejercidos sobre el módulo real.
//
// Lo que estos casos protegen, y que ningún test de la mitad pura puede ver:
//
//  1. que la barra acota **el conjunto entero** y no las diez de la página. Es LA decisión de la
//     ficha, y el caso está construido para que filtrar `items` salga ROJO: la orden que se busca
//     NO está en la página que el módulo recibe por props;
//  2. que un filtro por campo acota de verdad, con el gesto real (pedirlo en el selector y marcar
//     una opción);
//  3. que **cambiar de pestaña no deja una lista vacía sin explicación** — ni arrastrando el
//     filtro de la otra, ni afirmando «no tenés órdenes» sobre una tienda que sí las tiene.
//
// Se mockean las CUATRO lecturas del módulo (una pareja por grupo): vitest lanza al resolver el
// import, así que una que faltara mataría el archivo entero antes del primer caso, no dejaría un
// caso rojo.
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
  listarNovedadesCompletoAction: vi.fn(),
  listarAyudaTiendaAction: vi.fn(),
  listarAyudaTiendaCompletoAction: vi.fn(),
}));

vi.mock("@/lib/actions/resolver-novedad", () => ({
  reprogramarNovedad: vi.fn(),
  rechazarNovedad: vi.fn(),
}));
vi.mock("@/lib/actions/habilitar-novedad", () => ({ habilitarNovedad: vi.fn() }));
vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
}));
vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({ gestionarDesdeAyuda: vi.fn() }));
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

const completoDevolucionMock = vi.mocked(listarNovedadesCompletoAction);
const completoAyudaMock = vi.mocked(listarAyudaTiendaCompletoAction);

const base: NovedadDTO = {
  id: "o1",
  numGuia: 1001,
  numRemision: "REM-2026-0001",
  estatusValue: "devuelta",
  intentosContacto: 0,
  mensajeroNombre: "Marta Mensajera",
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  producto: "Zapatos deportivos",
  peso: 1.5,
  direccion: "Av. Central 120",
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
};

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({ ...base, ...over });

const DEVOLUCION = TEXTOS_POR_GRUPO.devolucion;
const AYUDA = TEXTOS_POR_GRUPO.ayuda;

/** El campo de búsqueda de una pestaña, buscado por SU nombre accesible (hay dos en el árbol). */
function buscador(nombre: string) {
  return screen.getByRole("searchbox", { name: nombre });
}

/** Los destinatarios que la lista está pintando ahora mismo, uno por card. */
function destinatariosVisibles(listaLabel: string): string[] {
  const lista = screen.queryByRole("list", { name: listaLabel });
  if (lista === null) return [];
  return within(lista)
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

/** ¿La lista está pintando a esta persona? Se mide sobre el texto de las cards. */
function pinta(listaLabel: string, quien: string): boolean {
  return destinatariosVisibles(listaLabel).some((texto) => texto.includes(quien));
}

/**
 * PIDE un filtro en el selector de la barra de un grupo. Es el mismo gesto de `/ordenes`: los
 * filtros no están puestos de entrada, se piden uno a uno.
 */
async function pedirFiltro(
  user: ReturnType<typeof userEvent.setup>,
  regionLabel: string,
  filtro: string,
) {
  const barra = screen.getByRole("region", { name: regionLabel });
  await user.click(within(barra).getByRole("button", { name: /^Filtros/ }));
  await user.click(
    within(await screen.findByRole("listbox", { name: "Filtros" })).getByRole("option", {
      name: filtro,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  completoDevolucionMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
  completoAyudaMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
});

afterEach(() => {
  cleanup();
});

describe("el buscador de /novedades acota sobre el conjunto ENTERO", () => {
  /**
   * EL CASO QUE DECIDE LA FICHA. La página que el módulo recibe trae UNA orden (Ana). El listado
   * completo del grupo trae DOS, y la que se busca —Benito— **no está en esa página**.
   *
   * Si la implementación filtrara `items`, aquí no habría nada que enseñar y el caso saldría rojo
   * con «ninguna coincide». Que Benito aparezca es la prueba de que se filtró sobre el conjunto.
   */
  it("encuentra una orden que NO está en la página visible", async () => {
    const user = userEvent.setup();
    const ana = novedad({ id: "ana", destinatario: "Ana Cliente" });
    const benito = novedad({ id: "benito", destinatario: "Benito Ramírez", numGuia: 2002 });
    completoDevolucionMock.mockResolvedValue({
      status: "ok",
      items: [ana, benito],
      total: 2,
    });

    render(
      <NovedadesModule grupo="devolucion" items={[ana]} total={2} page={1} pageSize={1} />,
    );

    expect(pinta(DEVOLUCION.listaAriaLabel, "Benito")).toBe(false);

    await user.type(buscador(DEVOLUCION.buscadorAriaLabel), "Benito");

    await waitFor(
      () => expect(pinta(DEVOLUCION.listaAriaLabel, "Benito")).toBe(true),
      { timeout: 3000 },
    );
    // Y acota: Ana, que SÍ estaba en la página, desaparece.
    expect(pinta(DEVOLUCION.listaAriaLabel, "Ana Cliente")).toBe(false);
  });

  it("un término que no casa con nadie dice «ninguna coincide», NO «no tenés órdenes»", async () => {
    const user = userEvent.setup();
    const ana = novedad({ id: "ana", destinatario: "Ana Cliente" });
    completoDevolucionMock.mockResolvedValue({ status: "ok", items: [ana], total: 1 });

    render(
      <NovedadesModule grupo="devolucion" items={[ana]} total={1} page={1} pageSize={10} />,
    );

    await user.type(buscador(DEVOLUCION.buscadorAriaLabel), "Pancracio");

    expect(await screen.findByText(SIN_COINCIDENCIAS_TITULO, {}, { timeout: 3000 }))
      .toBeInTheDocument();
    // R16 afirma algo de los DATOS. Con la barra puesta esa frase sería falsa.
    expect(screen.queryByText(DEVOLUCION.vacioTitulo)).toBeNull();
    // Y hay salida: la lista no se queda vacía y muda.
    expect(screen.getByRole("button", { name: LIMPIAR_BUSQUEDA })).toBeInTheDocument();
  });

  it("«Limpiar la búsqueda» devuelve la lista y vacía el campo", async () => {
    const user = userEvent.setup();
    const ana = novedad({ id: "ana", destinatario: "Ana Cliente" });
    completoDevolucionMock.mockResolvedValue({ status: "ok", items: [ana], total: 1 });

    render(
      <NovedadesModule grupo="devolucion" items={[ana]} total={1} page={1} pageSize={10} />,
    );

    await user.type(buscador(DEVOLUCION.buscadorAriaLabel), "Pancracio");
    await screen.findByText(SIN_COINCIDENCIAS_TITULO, {}, { timeout: 3000 });

    await user.click(screen.getByRole("button", { name: LIMPIAR_BUSQUEDA }));

    await waitFor(() => expect(pinta(DEVOLUCION.listaAriaLabel, "Ana Cliente")).toBe(true));
    expect(buscador(DEVOLUCION.buscadorAriaLabel)).toHaveValue("");
  });

  it("sin tocar la barra NO se pide el listado completo: la visita cuesta lo de siempre", () => {
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "ana" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(completoDevolucionMock).not.toHaveBeenCalled();
  });

  it("si el listado completo supera el tope, la barra LO DICE y no finge filtrar", async () => {
    const user = userEvent.setup();
    completoDevolucionMock.mockResolvedValue({
      status: "limite_excedido",
      total: 6000,
      limite: 5000,
    });

    render(
      <NovedadesModule
        grupo="devolucion"
        items={[novedad({ id: "ana", destinatario: "Ana Cliente" })]}
        total={6000}
        page={1}
        pageSize={10}
      />,
    );

    await user.type(buscador(DEVOLUCION.buscadorAriaLabel), "Pancracio");

    expect(await screen.findByText(avisoLimite(6000, 5000), {}, { timeout: 3000 }))
      .toBeInTheDocument();
    // No se pinta un resultado inventado ni se afirma que no hay coincidencias: sigue la página.
    expect(pinta(DEVOLUCION.listaAriaLabel, "Ana Cliente")).toBe(true);
    expect(screen.queryByText(SIN_COINCIDENCIAS_TITULO)).toBeNull();
  });
});

describe("los filtros de /novedades", () => {
  const marta = novedad({
    id: "marta",
    destinatario: "Ana Cliente",
    mensajeroNombre: "Marta Mensajera",
    zonaNombre: "GAM Oeste",
  });
  const pedro = novedad({
    id: "pedro",
    destinatario: "Benito Ramírez",
    mensajeroNombre: "Pedro Motorizado",
    zonaNombre: "GAM Este",
  });

  async function montarDevolucion(user: ReturnType<typeof userEvent.setup>, filtro: string) {
    completoDevolucionMock.mockResolvedValue({
      status: "ok",
      items: [marta, pedro],
      total: 2,
    });
    render(
      <NovedadesModule
        grupo="devolucion"
        items={[marta, pedro]}
        total={2}
        page={1}
        pageSize={10}
      />,
    );
    await pedirFiltro(user, DEVOLUCION.filtrosAriaLabel, filtro);
  }

  it("el filtro de MENSAJERO acota la lista", async () => {
    const user = userEvent.setup();
    await montarDevolucion(user, "Mensajero");

    const barra = screen.getByRole("region", { name: DEVOLUCION.filtrosAriaLabel });
    await user.click(await within(barra).findByRole("button", { name: /Mensajero/ }));
    await user.click(await screen.findByRole("option", { name: "Pedro Motorizado" }));

    await waitFor(
      () => expect(pinta(DEVOLUCION.listaAriaLabel, "Ana Cliente")).toBe(false),
      { timeout: 3000 },
    );
    expect(pinta(DEVOLUCION.listaAriaLabel, "Benito")).toBe(true);
  });

  it("el filtro de ZONA acota la lista", async () => {
    const user = userEvent.setup();
    await montarDevolucion(user, "Zona");

    const barra = screen.getByRole("region", { name: DEVOLUCION.filtrosAriaLabel });
    await user.click(await within(barra).findByRole("button", { name: /Zona/ }));
    await user.click(await screen.findByRole("option", { name: "GAM Oeste" }));

    await waitFor(
      () => expect(pinta(DEVOLUCION.listaAriaLabel, "Benito")).toBe(false),
      { timeout: 3000 },
    );
    expect(pinta(DEVOLUCION.listaAriaLabel, "Ana Cliente")).toBe(true);
  });

  it("pedir un filtro y NO marcar nada no acota: la lista sigue entera", async () => {
    const user = userEvent.setup();
    await montarDevolucion(user, "Mensajero");

    // El conjunto se pide igualmente (el control necesita sus opciones), pero nada se filtra.
    await waitFor(() => expect(completoDevolucionMock).toHaveBeenCalled());
    expect(destinatariosVisibles(DEVOLUCION.listaAriaLabel)).toHaveLength(2);
    expect(screen.queryByText(SIN_COINCIDENCIAS_TITULO)).toBeNull();
  });

  it("cada pestaña ofrece SUS filtros: la causa solo en devolución, el contacto solo en ayuda", async () => {
    const user = userEvent.setup();
    completoDevolucionMock.mockResolvedValue({ status: "ok", items: [marta], total: 1 });
    render(
      <NovedadesModule grupo="devolucion" items={[marta]} total={1} page={1} pageSize={10} />,
    );

    const barra = screen.getByRole("region", { name: DEVOLUCION.filtrosAriaLabel });
    await user.click(within(barra).getByRole("button", { name: /^Filtros/ }));
    const ofrecidos = within(await screen.findByRole("listbox", { name: "Filtros" }))
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(ofrecidos).toEqual([
      "Mensajero",
      "Zona",
      "Provincia",
      "Cantón",
      "Causa de devolución",
    ]);
  });
});

describe("cambiar de pestaña no deja al usuario con una lista vacía sin explicación", () => {
  const enAyuda = novedad({
    id: "ayuda-1",
    estatusValue: "ayuda_tienda",
    causa: null,
    destinatario: "Ana Cliente",
  });
  const enDevolucion = novedad({ id: "dev-1", destinatario: "Benito Ramírez" });

  function montarTabs() {
    return render(
      <NovedadesTabs
        novedades={{
          ayuda: { items: [enAyuda], total: 1, page: 1, pageSize: 10 },
          devolucion: { items: [enDevolucion], total: 1, page: 1, pageSize: 10 },
        }}
        rechazosSla={{ items: [], total: 0, page: 1, pageSize: 10 }}
      />,
    );
  }

  /**
   * EL FALLO A EVITAR, ejercido de punta a punta: se busca algo que no existe en la pestaña de
   * ayuda —hasta dejarla en «ninguna coincide»— y se pasa a la otra. La de devolución tiene que
   * aparecer ENTERA y con su barra limpia. Un filtro compartido entre pestañas la habría dejado
   * vacía y sin nada en pantalla que lo explicara.
   */
  it("el filtro de una pestaña no acota la otra, y su campo llega vacío", async () => {
    const user = userEvent.setup();
    completoAyudaMock.mockResolvedValue({ status: "ok", items: [enAyuda], total: 1 });
    completoDevolucionMock.mockResolvedValue({
      status: "ok",
      items: [enDevolucion],
      total: 1,
    });
    montarTabs();

    await user.type(buscador(AYUDA.buscadorAriaLabel), "Pancracio");
    expect(await screen.findByText(SIN_COINCIDENCIAS_TITULO, {}, { timeout: 3000 }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: DEVOLUCION.pestana }));

    // La otra pestaña se ve entera…
    await waitFor(() => expect(pinta(DEVOLUCION.listaAriaLabel, "Benito")).toBe(true));
    // …su campo de búsqueda está vacío…
    expect(buscador(DEVOLUCION.buscadorAriaLabel)).toHaveValue("");
    // …y su lista no está diciendo «ninguna coincide» (el aviso vive en la pestaña oculta).
    const panelDevolucion = screen
      .getByRole("region", { name: DEVOLUCION.filtrosAriaLabel })
      .closest("[role='tabpanel']");
    expect(panelDevolucion).not.toBeNull();
    expect(
      within(panelDevolucion as HTMLElement).queryByText(SIN_COINCIDENCIAS_TITULO),
    ).toBeNull();
  });

  it("el filtro puesto sobrevive al ir y volver: sigue visible, así que el vacío se explica solo", async () => {
    const user = userEvent.setup();
    completoAyudaMock.mockResolvedValue({ status: "ok", items: [enAyuda], total: 1 });
    completoDevolucionMock.mockResolvedValue({
      status: "ok",
      items: [enDevolucion],
      total: 1,
    });
    montarTabs();

    await user.type(buscador(AYUDA.buscadorAriaLabel), "Pancracio");
    await screen.findByText(SIN_COINCIDENCIAS_TITULO, {}, { timeout: 3000 });

    await user.click(screen.getByRole("tab", { name: DEVOLUCION.pestana }));
    await waitFor(() => expect(pinta(DEVOLUCION.listaAriaLabel, "Benito")).toBe(true));
    await user.click(screen.getByRole("tab", { name: AYUDA.pestana }));

    // Al volver, el término sigue EN EL CAMPO: la lista corta se explica sola.
    expect(buscador(AYUDA.buscadorAriaLabel)).toHaveValue("Pancracio");
  });
});
