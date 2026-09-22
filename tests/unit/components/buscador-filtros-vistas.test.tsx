// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement, ReactNode } from "react";

// FICHA 453 / T4.2 — EL CONTROL DE VISTAS DENTRO DE LA BARRA COMPARTIDA.
//
// La barra la montan DIECISEIS consumidores en doce pantallas, asi que el primer caso de este
// archivo no es una formalidad: sin la prop, la barra tiene que ser EXACTAMENTE la de antes —ni un
// control, ni una peticion, ni una emision (R31)—. La ficha 428 dejo la leccion de por que hace
// falta afirmarlo aqui: cuando aquella añadio una prop opt-in a un componente compartido, encender
// el default no ponia rojo NINGUN test de las otras pantallas, porque todas localizan por nombre
// accesible y ese no cambiaba.
//
// Las acciones van MOCKEADAS: lo que se prueba aqui es la pantalla —que pide confirmacion, que
// compone el mensaje del nombre en uso, que no escribe al aplicar—, no el borde, que tiene sus
// propios tests contra Postgres.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ordenes",
  useSearchParams: () => new URLSearchParams(),
}));

const listarMock = vi.fn();
const guardarMock = vi.fn();
const renombrarMock = vi.fn();
const actualizarMock = vi.fn();
const eliminarMock = vi.fn();

vi.mock("@/lib/actions/vistas-filtro", () => ({
  listarVistasFiltro: (...a: unknown[]) => listarMock(...a),
  guardarVistaFiltro: (...a: unknown[]) => guardarMock(...a),
  renombrarVistaFiltro: (...a: unknown[]) => renombrarMock(...a),
  actualizarVistaFiltro: (...a: unknown[]) => actualizarMock(...a),
  eliminarVistaFiltro: (...a: unknown[]) => eliminarMock(...a),
}));

import { ToastProvider } from "@/providers/ToastProvider";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import type { FilterDef } from "@/components/shared/FilterComponent";
import type { VistaFiltroDTO, VistaFiltroPayload } from "@/lib/types/vista-filtro";
import {
  catalogoCargado,
  catalogoNoDisponible,
} from "@/lib/utils/vista-filtro-aplicabilidad";

const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
  ],
};

const FILTROS_BARRA: FilterDef[] = [COLOR];

function payload(parcial: Partial<VistaFiltroPayload> = {}): VistaFiltroPayload {
  return { v: 1, termino: "", activos: [], seleccion: {}, ...parcial };
}

function vista(
  id: string,
  nombre: string,
  filtro: VistaFiltroPayload | null = payload({ activos: ["color"], seleccion: { color: ["rojo"] } }),
): VistaFiltroDTO {
  return { id, nombre, superficie: "ordenes", filtro, actualizadaEn: "2026-09-21T00:00:00.000Z" };
}

function envolver(ui: ReactNode): ReactElement {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>
  );
}

/** La barra con las vistas encendidas, como la monta `/ordenes`. */
function montarConVistas(
  opciones: {
    catalogoDisponible?: boolean;
    vistaPuestaId?: string | null;
    filtroActual?: VistaFiltroPayload;
    children?: ReactNode;
  } = {},
) {
  const onAplicar = vi.fn();
  const onGuardada = vi.fn();
  const vistaRender = render(
    envolver(
      <BuscadorFiltros
        onChange={vi.fn()}
        debounceMs={0}
        filtros={[{ key: "color", label: "Color" }]}
        activos={[]}
        onLimpiarTodo={vi.fn()}
        vistas={{
          superficie: "ordenes",
          filtroActual: opciones.filtroActual ?? payload({ termino: "guia123" }),
          catalogo:
            opciones.catalogoDisponible === false
              ? catalogoNoDisponible()
              : catalogoCargado(FILTROS_BARRA),
          vistaPuestaId: opciones.vistaPuestaId ?? null,
          onAplicar,
          onGuardada,
        }}
      >
        {opciones.children}
      </BuscadorFiltros>,
    ),
  );
  return { onAplicar, onGuardada, vistaRender };
}

function disparador(): HTMLElement {
  return screen.getByRole("button", { name: "Vistas guardadas" });
}

/** Abre el panel y espera a que la lista llegue. */
async function abrirPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(disparador());
  await waitFor(() => expect(listarMock).toHaveBeenCalled());
}

/** El modal abierto, por su rol. */
function modal(): HTMLElement {
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({ status: "ok", vistas: [] });
});

afterEach(() => cleanup());

describe("BuscadorFiltros — SIN la prop `vistas` la barra no cambia en NADA (R31)", () => {
  it("no monta ningun disparador de vistas y no pide ninguna lista", async () => {
    render(
      envolver(
        <BuscadorFiltros
          onChange={vi.fn()}
          debounceMs={0}
          filtros={[{ key: "color", label: "Color" }]}
          activos={[]}
        />,
      ),
    );

    expect(screen.queryByRole("button", { name: "Vistas guardadas" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Vistas/ })).toBeNull();
    // Ni una peticion: las otras once pantallas no ganan una consulta por entrar.
    await waitFor(() => expect(listarMock).not.toHaveBeenCalled());
  });
});

describe("BuscadorFiltros — el sitio del control es FIJO y es el primero (R36)", () => {
  it("el disparador va ANTES del campo y ANTES de los children", () => {
    montarConVistas({ children: <span data-testid="hijo">hijo</span> });
    const boton = disparador();
    const hijo = screen.getByTestId("hijo");
    const campo = screen.getByRole("searchbox", { name: "Buscar" });

    // `DOCUMENT_POSITION_FOLLOWING`: lo comparado viene DESPUES del disparador.
    expect(boton.compareDocumentPosition(hijo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boton.compareDocumentPosition(campo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("NO se mueve cuando aparece «Limpiar todo»", async () => {
    const user = userEvent.setup();
    montarConVistas();
    const fila = disparador().parentElement as HTMLElement;
    const antes = [...fila.children].indexOf(disparador());

    await user.type(screen.getByRole("searchbox", { name: "Buscar" }), "guia");
    expect(await screen.findByRole("button", { name: "Limpiar todo" })).toBeInTheDocument();

    expect([...fila.children].indexOf(disparador())).toBe(antes);
    expect(antes).toBe(0);
  });
});

describe("BuscadorFiltros — sin vistas guardadas se ofrece guardar, y eso NO es un error (R38)", () => {
  it("lo dice en voz normal y ofrece guardar los filtros de ahora", async () => {
    const user = userEvent.setup();
    montarConVistas();

    await abrirPanel(user);

    expect(
      await screen.findByText(/Todavía no has guardado ninguna vista/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar filtros actuales/ })).toBeInTheDocument();
    // Un estado legitimo no se anuncia como fallo: ni `role="alert"` ni la palabra «error».
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("BuscadorFiltros — guardar (R9-R13)", () => {
  it("guarda con el nombre tecleado y el filtro que hay puesto", async () => {
    const user = userEvent.setup();
    const filtroActual = payload({ termino: "guia123", activos: ["color"], seleccion: { color: ["rojo"] } });
    guardarMock.mockResolvedValue({
      status: "ok",
      vista: vista("v-nueva", "San José arriba", filtroActual),
    });
    const { onGuardada } = montarConVistas({ filtroActual });

    await abrirPanel(user);
    await user.click(screen.getByRole("button", { name: /Guardar filtros actuales/ }));
    await user.type(within(modal()).getByRole("textbox", { name: "Nombre" }), "San José arriba");
    await user.click(within(modal()).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(guardarMock).toHaveBeenCalledWith({
        superficie: "ordenes",
        nombre: "San José arriba",
        filtro: filtroActual,
      }),
    );
    // Lo recien guardado ES lo que esta puesto, asi que la pantalla se entera sin aplicar nada.
    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith("v-nueva"));
  });

  it("R13 — el tope se dice con LOS DOS numeros, no con «no puedes guardar mas»", async () => {
    const user = userEvent.setup();
    guardarMock.mockResolvedValue({ status: "limite_excedido", maximo: 20, actuales: 20 });
    montarConVistas();

    await abrirPanel(user);
    await user.click(screen.getByRole("button", { name: /Guardar filtros actuales/ }));
    await user.type(within(modal()).getByRole("textbox", { name: "Nombre" }), "Otra mas");
    await user.click(within(modal()).getByRole("button", { name: "Guardar" }));

    const aviso = await within(modal()).findByRole("alert");
    expect(aviso.textContent).toContain("20");
    expect(aviso.textContent).toMatch(/máximo/i);
  });

  it("R12 — «no hay nada que guardar» llega redactado del servidor y se enseña tal cual", async () => {
    const user = userEvent.setup();
    guardarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { filtro: ["No hay filtros puestos: pon alguno antes de guardar la vista."] },
    });
    montarConVistas({ filtroActual: payload() });

    await abrirPanel(user);
    await user.click(screen.getByRole("button", { name: /Guardar filtros actuales/ }));
    await user.type(within(modal()).getByRole("textbox", { name: "Nombre" }), "Vacia");
    await user.click(within(modal()).getByRole("button", { name: "Guardar" }));

    expect((await within(modal()).findByRole("alert")).textContent).toContain(
      "No hay filtros puestos",
    );
  });
});

describe("BuscadorFiltros — renombrar, con las mismas reglas de nombre (R14)", () => {
  beforeEach(() => {
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "San José arriba")] });
  });

  it("renombra con el nombre nuevo", async () => {
    const user = userEvent.setup();
    renombrarMock.mockResolvedValue({ status: "ok", vista: vista("v1", "San José bajo") });
    montarConVistas();

    await abrirPanel(user);
    await user.click(
      await screen.findByRole("button", { name: "Cambiar el nombre de «San José arriba»" }),
    );
    const campo = within(modal()).getByRole("textbox", { name: "Nombre" });
    await user.clear(campo);
    await user.type(campo, "San José bajo");
    await user.click(within(modal()).getByRole("button", { name: "Cambiar el nombre" }));

    await waitFor(() =>
      expect(renombrarMock).toHaveBeenCalledWith({ id: "v1", nombre: "San José bajo" }),
    );
  });

  it("R11 — el nombre en uso se dice NOMBRANDOLO, y el texto lo compone la pantalla", async () => {
    const user = userEvent.setup();
    // La accion devuelve `conflict` a secas: no lleva carga, asi que el nombre solo lo sabe
    // quien lo acaba de teclear.
    renombrarMock.mockResolvedValue({ status: "conflict" });
    montarConVistas();

    await abrirPanel(user);
    await user.click(
      await screen.findByRole("button", { name: "Cambiar el nombre de «San José arriba»" }),
    );
    const campo = within(modal()).getByRole("textbox", { name: "Nombre" });
    await user.clear(campo);
    await user.type(campo, "Repetida");
    await user.click(within(modal()).getByRole("button", { name: "Cambiar el nombre" }));

    const aviso = await within(modal()).findByRole("alert");
    expect(aviso.textContent).toContain("Repetida");
  });

  it("R9 — el nombre vacio lo rechaza el servidor y su mensaje se enseña", async () => {
    const user = userEvent.setup();
    renombrarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: ["Ponle un nombre a la vista."] },
    });
    montarConVistas();

    await abrirPanel(user);
    await user.click(
      await screen.findByRole("button", { name: "Cambiar el nombre de «San José arriba»" }),
    );
    await user.clear(within(modal()).getByRole("textbox", { name: "Nombre" }));
    await user.click(within(modal()).getByRole("button", { name: "Cambiar el nombre" }));

    expect((await within(modal()).findByRole("alert")).textContent).toContain("Ponle un nombre");
  });
});

describe("BuscadorFiltros — borrar pide confirmacion NOMBRANDO la vista (R17)", () => {
  beforeEach(() => {
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "San José arriba")] });
  });

  it("no borra hasta la confirmacion, y la confirmacion dice cual", async () => {
    const user = userEvent.setup();
    eliminarMock.mockResolvedValue({ status: "ok" });
    montarConVistas();

    await abrirPanel(user);
    await user.click(await screen.findByRole("button", { name: "Borrar «San José arriba»" }));

    expect(modal().textContent).toContain("San José arriba");
    expect(eliminarMock).not.toHaveBeenCalled();

    await user.click(within(modal()).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(eliminarMock).toHaveBeenCalledWith({ id: "v1" }));
  });

  it("cancelar no borra nada", async () => {
    const user = userEvent.setup();
    montarConVistas();

    await abrirPanel(user);
    await user.click(await screen.findByRole("button", { name: "Borrar «San José arriba»" }));
    await user.click(within(modal()).getByRole("button", { name: "Cancelar" }));

    expect(eliminarMock).not.toHaveBeenCalled();
  });
});

describe("BuscadorFiltros — aplicar una vista entera (R18) y NO escribir al hacerlo (R16)", () => {
  it("entrega el filtro guardado a la pantalla y no llama a ninguna escritura", async () => {
    const user = userEvent.setup();
    const guardado = payload({
      termino: "guia123",
      activos: ["color"],
      seleccion: { color: ["rojo", "azul"] },
    });
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "San José arriba", guardado)] });
    const { onAplicar } = montarConVistas();

    await abrirPanel(user);
    await user.click(await screen.findByRole("button", { name: "Aplicar «San José arriba»" }));

    expect(onAplicar).toHaveBeenCalledWith("v1", guardado);
    expect(guardarMock).not.toHaveBeenCalled();
    expect(actualizarMock).not.toHaveBeenCalled();
    expect(renombrarMock).not.toHaveBeenCalled();
    expect(eliminarMock).not.toHaveBeenCalled();
  });

  it("R15 — «Guardar cambios» aparece solo con una vista puesta, y reemplaza su filtro", async () => {
    const user = userEvent.setup();
    const filtroActual = payload({ termino: "otro", activos: ["color"], seleccion: { color: ["azul"] } });
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "San José arriba")] });
    actualizarMock.mockResolvedValue({ status: "ok", vista: vista("v1", "San José arriba", filtroActual) });
    montarConVistas({ vistaPuestaId: "v1", filtroActual });

    await abrirPanel(user);
    await user.click(
      await screen.findByRole("button", { name: /Guardar cambios en «San José arriba»/ }),
    );

    await waitFor(() =>
      expect(actualizarMock).toHaveBeenCalledWith({ id: "v1", filtro: filtroActual }),
    );
  });
});

describe("BuscadorFiltros — lo que NO se puede aplicar, no se aplica y se dice", () => {
  it("R29 — con el catalogo sin resolver no se clasifica ni se aplica ninguna vista", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "San José arriba")] });
    const { onAplicar } = montarConVistas({ catalogoDisponible: false });

    await abrirPanel(user);
    const boton = await screen.findByRole("button", { name: "Aplicar «San José arriba»" });

    expect(boton).toBeDisabled();
    await user.click(boton);
    expect(onAplicar).not.toHaveBeenCalled();
    // Y se DICE por que, en vez de dejar un boton muerto sin explicacion.
    expect(screen.getByText(/no han terminado de cargar/i)).toBeInTheDocument();
    // Ninguna vista sale marcada «Incompleta» por una lectura que fallo (el sesgo del modulo).
    expect(screen.queryByText("Incompleta")).toBeNull();
  });

  it("R8 — una vista ilegible no se aplica, pero se sigue pudiendo renombrar y borrar", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "Rara", null)] });
    montarConVistas();

    await abrirPanel(user);

    expect(await screen.findByRole("button", { name: "Aplicar «Rara»" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cambiar el nombre de «Rara»" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Borrar «Rara»" })).toBeEnabled();
  });
});

describe("BuscadorFiltros — los textos visibles no hablan en jerga (R39)", () => {
  it("ni «selección», ni «payload», ni «clave», ni «superficie»", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({ status: "ok", vistas: [vista("v1", "San José arriba")] });
    montarConVistas({ vistaPuestaId: "v1" });

    await abrirPanel(user);
    const enElPanel = document.body.textContent ?? "";
    await user.click(screen.getByRole("button", { name: /Guardar filtros actuales/ }));
    const enElFormulario = document.body.textContent ?? "";

    for (const texto of [enElPanel, enElFormulario]) {
      expect(texto.toLowerCase()).not.toContain("selecc");
      expect(texto.toLowerCase()).not.toContain("payload");
      expect(texto.toLowerCase()).not.toContain("superficie");
      expect(texto.toLowerCase()).not.toContain("clave");
    }
  });
});
