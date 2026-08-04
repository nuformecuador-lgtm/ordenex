// @vitest-environment jsdom
// Chore Q-K7 (deuda de la feature 170 — FASE 2, T K.3) — el aviso de lo marcado en OTRAS
// páginas del listado «Órdenes de la bodega» del `adminSatelite`.
//
// Qué se arregla: la selección SOBREVIVE al cambio de página (lo marcado en la 1 sigue
// marcado al volver) pero NO PARTICIPA en la acción de lote, que actúa sólo sobre lo marcado
// en la página visible. Hasta ahora nada lo decía: el operador marcaba en la página 1, pasaba
// a la 2, marcaba una más, pulsaba «Enviar a central» y la acción se llevaba UNA orden. No
// falla en ninguna parte —la transición es válida y el toast dice que todo salió bien—; el
// operador se entera cuando vuelve y las ve donde las dejó.
//
// Lo que este archivo mide son los TRES estados del aviso, y el tercero es el que discrimina:
//
//   1. sin nada marcado fuera de la página visible NO se pinta (un aviso permanente es ruido);
//   2. con algo marcado fuera SÍ se pinta, y dice CUÁNTAS;
//   3. ese número es el de FUERA de la página, no el total marcado. Si dijera el total, el
//      aviso mentiría en cuanto se marca una fila de la página actual: diría que tres órdenes
//      se quedan fuera de la acción cuando una de ellas sí entra.
//
// Cómo está montado: 6 órdenes en `pageSize` 3 → 2 páginas, con un estado por página
// (`en_bodega_satelite` la 1, `por_devolver` la 2) para que el aviso se lea junto al botón de
// lote que NO va a llevárselas. El doble de la Server Action paginada recorta de verdad, así
// que navegar cambia las filas.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { catalogoSatelite, paginaBodega } from "@/tests/fixtures/satelite-bodega";

// --- Dobles ---------------------------------------------------------------

const { paginadoMock, conjuntoMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  conjuntoMock: vi.fn(),
}));

vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  recibirLote: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarRecepcionSatelite: (...a: unknown[]) => conjuntoMock(...a),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoMock(...a),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({
  enviarACentral: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({ recuperarABodega: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

// La cámara nunca se abre en estos tests; el mock evita cargar el módulo real.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";

// --- Datos ---------------------------------------------------------------

const ZONA = "Limón";
const TOTAL = 6;
const PAGE_SIZE = 3;

const LISTADO = "Órdenes de la bodega";
const PAGINACION = "Paginación de las órdenes de la bodega";

function etiqueta(i: number): string {
  return `REM-${String(i).padStart(2, "0")}`;
}

/** Página 1 (1-3): en bodega. Página 2 (4-6): por devolver. */
function estadoDe(i: number): string {
  return i <= PAGE_SIZE ? "en_bodega_satelite" : "por_devolver";
}

function orden(i: number): RecepcionSateliteDTO {
  return {
    id: `o-${i}`,
    numGuia: 1000 + i,
    numRemision: etiqueta(i),
    estatusValue: estadoDe(i),
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: ZONA,
    intentosEntrega: 0,
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
  };
}

const CONJUNTO: RecepcionSateliteDTO[] = Array.from({ length: TOTAL }, (_, k) =>
  orden(k + 1),
);

// --- Andamiaje -----------------------------------------------------------

interface FiltroEntrada {
  page?: number;
  pageSize?: number;
}

/** Doble de la acción paginada: RECORTA de verdad, así que navegar cambia las filas. */
function servirPaginas() {
  paginadoMock.mockImplementation(async (input: FiltroEntrada = {}) => {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? PAGE_SIZE;
    const desde = (page - 1) * pageSize;
    return {
      status: "ok",
      items: CONJUNTO.slice(desde, desde + pageSize),
      page,
      pageSize,
      total: TOTAL,
    };
  });
}

function servirConjunto() {
  conjuntoMock.mockResolvedValue({
    status: "ok",
    porRecibir: [],
    recibidas: CONJUNTO.filter((o) => o.estatusValue === "en_bodega_satelite"),
    asignadas: [],
    porDevolver: CONJUNTO.filter((o) => o.estatusValue === "por_devolver"),
    enTransitoACentral: [],
    devueltas: [],
    zonaNombre: ZONA,
    sinZona: false,
  });
}

function montar() {
  servirPaginas();
  servirConjunto();
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        porRecibir={[]}
        ordenesBodega={paginaBodega(CONJUNTO.slice(0, PAGE_SIZE), {
          total: TOTAL,
          pageSize: PAGE_SIZE,
        })}
        catalogoFiltros={catalogoSatelite(CONJUNTO)}
        zonaNombre={ZONA}
        sinZona={false}
        mensajeros={[{ id: "m1", nombre: "Ana Mensajera" }]}
        bloqueoBodega={{
          bloqueada: false,
          porMensajeros: false,
          porCierreBodega: false,
        }}
      />
    </SWRConfig>,
  );
}

function tabla(): HTMLElement {
  return screen.getByRole("table", { name: LISTADO });
}

function region(): HTMLElement {
  return screen.getByRole("region", { name: LISTADO });
}

function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: PAGINACION });
}

function remisionesVisibles(): string[] {
  return within(tabla())
    .getAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label") ?? "")
    .filter((n) => n.startsWith("Seleccionar REM-"))
    .map((n) => n.replace("Seleccionar ", ""));
}

function casilla(remision: string): HTMLElement {
  return within(tabla()).getByRole("checkbox", { name: `Seleccionar ${remision}` });
}

/** El texto de la barra de selección, del que el aviso es una coletilla subordinada. */
function barra(): HTMLElement {
  return within(region()).getByRole("status");
}

/** El aviso, buscado por lo que DICE: que hay marcas fuera y que no entran. */
function avisoTexto(): string | null {
  const nodo = within(region())
    .queryAllByText(/marcadas en otras páginas/)
    .at(0);
  return nodo?.textContent?.replace(/\s+/g, " ").trim() ?? null;
}

async function irAPagina(
  user: ReturnType<typeof userEvent.setup>,
  numero: number,
) {
  await user.click(
    within(nav()).getByRole("button", { name: `Ir a la página ${numero}` }),
  );
  await waitFor(() =>
    expect(remisionesVisibles()[0]).toBe(etiqueta((numero - 1) * PAGE_SIZE + 1)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Q-K7 · aviso de selección en otras páginas (bodega satélite)", () => {
  it("no se pinta nada mientras todo lo marcado está a la vista", async () => {
    const user = userEvent.setup();
    montar();

    // (a) Sin nada marcado. Un aviso permanente («0 en otras páginas») sería ruido en una
    // barra que ya dice dos cosas.
    expect(avisoTexto()).toBeNull();

    // (b) Con DOS marcadas de las tres de la página visible: sigue sin haber nada que
    // avisar, porque no hay ninguna marca fuera de la vista.
    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    expect(barra()).toHaveTextContent("2 seleccionada(s) en esta página");
    expect(avisoTexto()).toBeNull();
  });

  it("avisa al cambiar de página, con el número de las que quedan fuera", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);

    // Las dos marcas siguen vivas —al volver estarán ahí— pero ya no participan en nada de
    // lo que se pulse aquí, y ESO es lo que el aviso dice, con el número delante.
    expect(avisoTexto()).toBe(
      "Tienes 2 orden(es) marcadas en otras páginas que no entran en esta acción.",
    );
    // Y la barra sigue hablando del conjunto: sin nada marcado en ESTA página no hay
    // selección sobre la que actuar.
    expect(barra()).toHaveTextContent(`${TOTAL} órdenes`);
    expect(
      within(region()).queryByRole("button", { name: "Asignar" }),
    ).toBeNull();

    // Al volver, las marcas están donde se dejaron y el aviso desaparece: lo marcado vuelve
    // a estar todo a la vista.
    await irAPagina(user, 1);
    expect(casilla(etiqueta(1))).toBeChecked();
    expect(casilla(etiqueta(2))).toBeChecked();
    expect(avisoTexto()).toBeNull();
  });

  it("cuenta las de FUERA de la página visible, no el total marcado", async () => {
    const user = userEvent.setup();
    montar();

    // Dos en la página 1…
    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);
    // …y una en la 2. Total marcado: TRES. Fuera de la vista: DOS.
    await user.click(casilla(etiqueta(4)));

    // El caso que discrimina. Con el total, el aviso mentiría: diría que se quedan fuera
    // tres órdenes cuando una de ellas —la de esta página— sí entra en la acción.
    expect(avisoTexto()).toBe(
      "Tienes 2 orden(es) marcadas en otras páginas que no entran en esta acción.",
    );
    expect(avisoTexto()).not.toContain("3 orden(es)");

    // Y el aviso concuerda con lo que dice la barra y con lo que la acción se va a llevar:
    // UNA de esta página, que es la única marcada aquí.
    expect(barra()).toHaveTextContent("1 seleccionada(s) en esta página");
    expect(
      within(region()).getByRole("button", { name: "Enviar a central" }),
    ).toBeEnabled();

    // Al volver a la página 1 el número se recalcula contra la NUEVA página visible: ahora
    // la que queda fuera es la de la página 2.
    await irAPagina(user, 1);
    expect(avisoTexto()).toBe(
      "Tienes 1 orden(es) marcadas en otras páginas que no entran en esta acción.",
    );
  });
});
