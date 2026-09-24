// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { VistaFiltroDTO, VistaFiltroPayload } from "@/lib/types/vista-filtro";

// FICHA 453 / T5.1 — LAS VISTAS, CABLEADAS EN LA SUPERFICIE REAL DE `/ordenes`.
//
// Lo que se mide aquí no es el control —eso ya tiene su archivo— sino el efecto: qué se le pide
// al servidor después de aplicar, qué queda puesto en la barra, qué desaparece de la dirección y
// en qué página queda la tabla. Es el único sitio donde las tres piezas viajan juntas.
//
// El reset a la página 1 se mide DESDE LA PÁGINA 2 a propósito: desde la 1 el reset es invisible
// —React se ahorra el render— y el caso quedaría verde con el reset borrado.

const replaceMock = vi.fn();
const pushMock = vi.fn();

/** La dirección por la que se entra. `let` porque cada caso entra por una distinta. */
let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/ordenes",
  useSearchParams: () => parametros,
}));

const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

const listarVistasMock = vi.fn();
const guardarVistaMock = vi.fn();
const renombrarVistaMock = vi.fn();
const actualizarVistaMock = vi.fn();
const eliminarVistaMock = vi.fn();
vi.mock("@/lib/actions/vistas-filtro", () => ({
  listarVistasFiltro: (...a: unknown[]) => listarVistasMock(...a),
  guardarVistaFiltro: (...a: unknown[]) => guardarVistaMock(...a),
  renombrarVistaFiltro: (...a: unknown[]) => renombrarVistaMock(...a),
  actualizarVistaFiltro: (...a: unknown[]) => actualizarVistaMock(...a),
  eliminarVistaFiltro: (...a: unknown[]) => eliminarVistaMock(...a),
}));

import { olvidarParamsBorrados } from "@/hooks/useFiltrosUrl";
import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  mensajeros: [],
  zonas: [
    { id: "z1", nombre: "GAM" },
    { id: "z2", nombre: "Guanacaste" },
  ],
  tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José", disponible: true }],
  cantones: [{ id: "c1", nombre: "Escazú", padreId: "p1", disponible: true }],
  distritos: [{ id: "d1", nombre: "San Rafael", padreId: "c1", disponible: true }],
};

/** La vista de trabajo del enunciado: término + zona. */
const GUARDADO: VistaFiltroPayload = {
  v: 1,
  termino: "guia123",
  activos: ["zona_id"],
  seleccion: { zona_id: ["z1"] },
};

const VISTA: VistaFiltroDTO = {
  id: "v1",
  nombre: "San José arriba",
  superficie: "ordenes",
  filtro: GUARDADO,
  actualizadaEn: "2026-09-21T00:00:00.000Z",
};

function makeOrden(id: string): OrdenListItemDTO {
  return {
    id,
    numGuia: 1001,
    numRemision: `REM-${id}`,
    estatusId: "est-entregada",
    estatusValue: "entregado",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda Uno",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: "d1",
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as OrdenListItemDTO;
}

function renderListado(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** La ÚLTIMA entrada con la que se llamó a `listarOrdenes`. */
function ultimaLlamada(): {
  page?: number;
  filter?: Record<string, unknown>;
} {
  return listarOrdenesMock.mock.calls.at(-1)?.[0] ?? {};
}

function campoBuscar(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement;
}

async function abrirVistas(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Vistas guardadas" }));
  await waitFor(() => expect(listarVistasMock).toHaveBeenCalled());
}

async function aplicarLaVista(user: ReturnType<typeof userEvent.setup>) {
  await abrirVistas(user);
  await user.click(await screen.findByRole("button", { name: "Aplicar «San José arriba»" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  parametros = new URLSearchParams();
  olvidarParamsBorrados();
  listarOrderStatusMock.mockResolvedValue({
    status: "ok",
    estatus: [
      { id: "est-pendiente", value: "pendiente" },
      { id: "est-entregada", value: "entregado" },
    ],
  });
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [makeOrden("o1")],
    page: 1,
    pageSize: 25,
    total: 60,
  });
  listarVistasMock.mockResolvedValue({ status: "ok", vistas: [VISTA] });
});

afterEach(() => cleanup());

describe("/ordenes — aplicar una vista repone las TRES piezas de la barra (R18)", () => {
  it("deja el campo, el control montado y su valor exactamente como se guardaron", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await aplicarLaVista(user);

    // (1) el término, en el campo de búsqueda —que NO se remontó: es la costura de la 328—;
    expect(campoBuscar().value).toBe("guia123");
    // (2) el control de Zona, MONTADO (no estaba antes de aplicar);
    // (3) y con su valor puesto: una zona marcada se resume con su propia etiqueta.
    expect(await screen.findByRole("button", { name: "Zona: GAM" })).toBeInTheDocument();
    // Y lo que de verdad decide lo que se ve: lo que se le pide al servidor.
    await waitFor(() =>
      expect(ultimaLlamada().filter).toEqual({ q: "guia123", zona_id: ["z1"] }),
    );
  });
});

describe("/ordenes — aplicar REEMPLAZA el filtro vigente, no lo acumula (R19)", () => {
  it("una parte del filtro anterior que la vista no trae DESAPARECE", async () => {
    const user = userEvent.setup();
    // Se entra con un estado ya filtrado desde la dirección: ese es «el filtro anterior».
    parametros = new URLSearchParams("status_id=est-entregada");
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() =>
      expect(ultimaLlamada().filter).toEqual({ status_id: ["est-entregada"] }),
    );

    await aplicarLaVista(user);

    await waitFor(() =>
      expect(ultimaLlamada().filter).toEqual({ q: "guia123", zona_id: ["z1"] }),
    );
    // Y el control del estado ya no está ni montado: un filtro sin control en pantalla no
    // puede seguir filtrando.
    expect(screen.queryByRole("button", { name: /^Estado:/ })).toBeNull();
  });
});

describe("/ordenes — aplicar devuelve la tabla a la PRIMERA página (R20)", () => {
  it("medido desde la página 2: aplicar la deja en la 1", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));

    await aplicarLaVista(user);

    await waitFor(() => expect(ultimaLlamada().page).toBe(1));
  });
});

describe("/ordenes — aplicar RETIRA los params propios de la dirección (R21)", () => {
  it("saca los suyos, no añade ninguno y respeta los ajenos", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("q=viejo&zona_id=z2&cierre=abierto");
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    replaceMock.mockClear();

    await aplicarLaVista(user);

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const destino = String(replaceMock.mock.calls.at(-1)?.[0]);
    // Los propios de la barra fuera…
    expect(destino).not.toContain("q=");
    expect(destino).not.toContain("zona_id=");
    // …el ajeno intacto, y ni un param nuevo: recargar no repone lo que la vista reemplazó.
    expect(destino).toBe("/ordenes?cierre=abierto");
  });
});

describe("/ordenes — tocar el filtro deja de presentar la vista como puesta (R22)", () => {
  it("la marca vive mientras la vista está puesta y se apaga al primer cambio", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await aplicarLaVista(user);
    // Se espera MÁS que el debounce de los dos canónicos (500 ms) antes de mirar la marca: una
    // emisión tardía —la que produciría una siembra que sí emitiera— la apagaría medio segundo
    // después de aplicar, con la persona mirando. Sin esta espera el caso quedaría verde porque
    // `findByText` resuelve en cuanto encuentra, antes de que la emisión aterrice.
    await new Promise((listo) => setTimeout(listo, 700));
    await abrirVistas(user);
    expect(await screen.findByText("Puesta ahora")).toBeInTheDocument();

    // Cerrar el panel y cambiar el término: el filtro ya no es el de la vista.
    await user.keyboard("{Escape}");
    await user.clear(campoBuscar());
    await user.type(campoBuscar(), "otra cosa");
    await waitFor(() => expect(ultimaLlamada().filter).toMatchObject({ q: "otra cosa" }));

    await abrirVistas(user);
    expect(screen.queryByText("Puesta ahora")).toBeNull();
  });
});

describe("/ordenes — sin catálogo NO se clasifica, NO se aplica, y se dice (R29)", () => {
  it("con el catálogo geográfico caído el botón no aplica y ninguna vista sale «Incompleta»", async () => {
    const user = userEvent.setup();
    // Es lo que `page.tsx` entrega cuando la lectura del catálogo falla.
    renderListado(<OrdenesListado catalogoFiltros={null} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await abrirVistas(user);

    expect(await screen.findByRole("button", { name: "Aplicar «San José arriba»" })).toBeDisabled();
    expect(screen.getByText(/no han terminado de cargar/i)).toBeInTheDocument();
    expect(screen.queryByText("Incompleta")).toBeNull();
    // Y el filtro sigue siendo el de antes: no se ha pedido nada nuevo.
    expect(ultimaLlamada().filter).toBeUndefined();
  });

  it("y con el catálogo de ESTADOS vacío tampoco: los dos fallan igual de callados", async () => {
    const user = userEvent.setup();
    // `catalogoFetcher` devuelve `[]` cuando la lectura de estados falla. Con 22 estados en
    // producción, un catálogo vacío solo puede ser eso.
    listarOrderStatusMock.mockResolvedValue({ status: "forbidden" });
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await abrirVistas(user);

    expect(await screen.findByRole("button", { name: "Aplicar «San José arriba»" })).toBeDisabled();
    expect(screen.queryByText("Incompleta")).toBeNull();
  });
});

describe("/ordenes — todo se alcanza sin salir del listado (R37)", () => {
  it("aplicar, guardar, renombrar y borrar viven en la barra, y nadie navega", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await abrirVistas(user);

    expect(screen.getByRole("button", { name: "Aplicar «San José arriba»" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cambiar el nombre de «San José arriba»" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Borrar «San José arriba»" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar filtros actuales/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aplicar «San José arriba»" }));

    // La tabla sigue ahí y no ha habido navegación: aplicar no es ir a ningún sitio.
    await waitFor(() => expect(campoBuscar().value).toBe("guia123"));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("guardar manda la superficie y las TRES piezas de lo que hay puesto (R5)", async () => {
    const user = userEvent.setup();
    listarVistasMock.mockResolvedValue({ status: "ok", vistas: [] });
    guardarVistaMock.mockResolvedValue({
      status: "ok",
      vista: { ...VISTA, id: "v-nueva", nombre: "Nueva" },
    });
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    await user.type(campoBuscar(), "guia999");
    await waitFor(() => expect(ultimaLlamada().filter).toMatchObject({ q: "guia999" }));

    await abrirVistas(user);
    await user.click(screen.getByRole("button", { name: /Guardar filtros actuales/ }));
    const modal = screen.getByRole("dialog");
    await user.type(within(modal).getByRole("textbox", { name: "Nombre" }), "Nueva");
    await user.click(within(modal).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(guardarVistaMock).toHaveBeenCalledWith({
        superficie: "ordenes",
        nombre: "Nueva",
        filtro: { v: 1, termino: "guia999", activos: [], seleccion: {} },
      }),
    );
  });
});

describe("/ordenes — el ORDEN del listado no entra en la vista (requirements P1)", () => {
  it("aplicar una vista no reordena la tabla", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    // Se cambia el orden a mano ANTES de aplicar…
    await user.click(
      within(screen.getByRole("group", { name: "Dirección del orden por fecha de creación" }))
        .getByRole("button", { name: "Más antiguas" }),
    );
    await waitFor(() =>
      expect(listarOrdenesMock.mock.calls.at(-1)?.[0]?.sortDir).toBe("asc"),
    );

    await aplicarLaVista(user);

    // …y sigue donde lo dejó la persona: la vista guarda filtros, no secuencias.
    await waitFor(() =>
      expect(ultimaLlamada().filter).toEqual({ q: "guia123", zona_id: ["z1"] }),
    );
    expect(listarOrdenesMock.mock.calls.at(-1)?.[0]?.sortDir).toBe("asc");
  });
});
