// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement, ReactNode } from "react";

// FICHA 453 / T4.3 — LA VISTA QUE YA NO SE PUEDE APLICAR ENTERA.
//
// Es la regla que en este repo vale doble: aplicar lo que se puede y callar el resto deja a la
// persona filtrando otra cosa sin saberlo. Por eso lo que se afirma aqui NO es que el aviso
// aparezca —eso es lo facil—, sino que EL FILTRO VIGENTE NO SE HAYA MOVIDO cuando aparece. Se mide
// sobre lo que la pantalla recibe (`onAplicar`), no sobre el aviso: un aviso bonito con el listado
// ya cambiado detras es exactamente el fallo que R25 y R30 prohiben.

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
import { catalogoCargado } from "@/lib/utils/vista-filtro-aplicabilidad";

/** Lo que la pantalla declara HOY: un solo control, y sin la opcion «morado». */
const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
  ],
};

/**
 * Lo que la vista guardo: un valor que ya no existe (`morado`) y un filtro entero que la pantalla
 * ya no declara (`mensajero`, con un identificador dentro que NO puede acabar en pantalla).
 */
const GUARDADO: VistaFiltroPayload = {
  v: 1,
  termino: "guia123",
  activos: ["color", "mensajero"],
  seleccion: { color: ["rojo", "morado"], mensajero: ["8f1c2d34-aaaa-bbbb-cccc-000000000001"] },
};

/** Lo unico que se puede reponer de esa vista. */
const APLICABLE: VistaFiltroPayload = {
  v: 1,
  termino: "guia123",
  activos: ["color"],
  seleccion: { color: ["rojo"] },
};

const VISTA: VistaFiltroDTO = {
  id: "v1",
  nombre: "San José arriba",
  superficie: "ordenes",
  filtro: GUARDADO,
  actualizadaEn: "2026-09-21T00:00:00.000Z",
};

function envolver(ui: ReactNode): ReactElement {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>
  );
}

function montar() {
  const onAplicar = vi.fn();
  render(
    envolver(
      <BuscadorFiltros
        onChange={vi.fn()}
        debounceMs={0}
        filtros={[{ key: "color", label: "Color" }]}
        activos={[]}
        vistas={{
          superficie: "ordenes",
          filtroActual: { v: 1, termino: "", activos: [], seleccion: {} },
          catalogo: catalogoCargado([COLOR]),
          vistaPuestaId: null,
          onAplicar,
        }}
      />,
    ),
  );
  return { onAplicar };
}

async function elegirLaVista(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Vistas guardadas" }));
  await waitFor(() => expect(listarMock).toHaveBeenCalled());
  await user.click(await screen.findByRole("button", { name: "Aplicar «San José arriba»" }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({ status: "ok", vistas: [VISTA] });
});

afterEach(() => cleanup());

describe("La vista incompleta no se aplica a medias en silencio (R25, R30)", () => {
  it("elegirla NO cambia ni una parte del filtro vigente antes de que alguien decida", async () => {
    const user = userEvent.setup();
    const { onAplicar } = montar();

    await elegirLaVista(user);

    // LA ASERCION QUE IMPORTA: la pantalla no ha recibido nada. Ni entero, ni recortado.
    expect(onAplicar).not.toHaveBeenCalled();
  });

  it("enumera CADA parte perdida con su nombre visible y su motivo, y ni un identificador", async () => {
    const user = userEvent.setup();
    montar();

    const aviso = await elegirLaVista(user);

    expect(aviso.textContent).toContain("San José arriba");
    // El valor que ya no existe: se dice EN QUE filtro y CUANTOS son.
    expect(aviso.textContent).toContain("Color");
    // El filtro que la pantalla ya no declara.
    expect(aviso.textContent).toContain("mensajero");
    // Y NUNCA el identificador crudo de lo perdido (R25/R39): un valor fuera del catalogo no
    // tiene etiqueta que enseñar, asi que lo unico pintable seria su id — y no se pinta.
    expect(aviso.textContent).not.toContain("8f1c2d34");
    expect(aviso.textContent).not.toContain("morado");
  });

  it("ofrece EXACTAMENTE dos salidas, ni una mas (R26)", async () => {
    const user = userEvent.setup();
    montar();

    const aviso = await elegirLaVista(user);

    const botones = within(aviso)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim());
    expect(botones).toEqual(["Cancelar", "Aplicar sin eso"]);
  });
});

describe("Las dos salidas hacen lo que dicen (R27, R16)", () => {
  it("«Aplicar sin eso» aplica SOLO lo aplicable y no escribe nada", async () => {
    const user = userEvent.setup();
    const { onAplicar } = montar();

    const aviso = await elegirLaVista(user);
    await user.click(within(aviso).getByRole("button", { name: "Aplicar sin eso" }));

    expect(onAplicar).toHaveBeenCalledWith("v1", APLICABLE);
    // R16 — aplicar NO escribe: la vista guardada se queda como estaba, con su parte perdida.
    expect(actualizarMock).not.toHaveBeenCalled();
    expect(guardarMock).not.toHaveBeenCalled();
    expect(renombrarMock).not.toHaveBeenCalled();
    expect(eliminarMock).not.toHaveBeenCalled();
  });

  it("«Cancelar» deja el filtro vigente intacto", async () => {
    const user = userEvent.setup();
    const { onAplicar } = montar();

    const aviso = await elegirLaVista(user);
    await user.click(within(aviso).getByRole("button", { name: "Cancelar" }));

    expect(onAplicar).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("La vista queda MARCADA incompleta en la lista, con su motivo (R28)", () => {
  it("la marca vive en la lista y el motivo es alcanzable ahi mismo", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole("button", { name: "Vistas guardadas" }));
    await waitFor(() => expect(listarMock).toHaveBeenCalled());

    const marca = await screen.findByText("Incompleta");
    expect(marca).toBeInTheDocument();
    // El motivo no obliga a abrir el aviso para saber por que: viaja con la marca.
    expect(marca.getAttribute("title")).toContain("Color");
  });

  it("y NO aparece en una vista que si se puede reponer entera", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      vistas: [{ ...VISTA, filtro: APLICABLE }],
    });
    montar();

    await user.click(screen.getByRole("button", { name: "Vistas guardadas" }));
    await waitFor(() => expect(listarMock).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Aplicar «San José arriba»" });

    expect(screen.queryByText("Incompleta")).toBeNull();
  });
});
