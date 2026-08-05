// @vitest-environment jsdom
// Feature 170 — FASE 2, T K.3 (R42/R43/R46/R47/R48/R52) — «Órdenes de la bodega» del
// `adminSatelite`, la pantalla de riesgo ALTO del Anexo III (`design.md §11.3`).
//
// Se llama «de riesgo ALTO» porque es la única que CAMBIA DE USO: hasta hoy recibía el
// conjunto entero por props y filtraba en el navegador; desde T K.1 filtra y pagina en el
// servidor. Eso mueve cuatro cosas que el operador usa todos los días, y ninguna falla sola:
//
//  1. R47 — «seleccionar todo» dejaba de significar «todas mis órdenes» y pasa a significar
//     «las de esta página». Si la casilla de cabecera marcara filas que no están a la vista,
//     el operador actuaría a ciegas sobre paquetes que no ha visto.
//  2. R48 — **el punto peligroso**. Las cuatro acciones de lote se ofrecían mirando el
//     CONTENIDO del listado (`hayEstado`) y actúan sobre lo marcado. Con el conjunto entero a
//     la vista las dos cosas coincidían; con una página no. Una acción que actuara sobre el
//     conjunto en vez de sobre la selección **mueve paquetes que el usuario no eligió**, y no
//     falla en ninguna parte: la transición es válida, el servidor la acepta y el toast dice
//     que todo salió bien. Por eso se prueba con datos donde conjunto y selección DIFIEREN.
//  3. R46 — los desplegables de cantón y distrito se derivaban de las órdenes cargadas. Al
//     paginar, derivarlos de la página dejaría al operador concluyendo —sin ningún error—
//     que su bodega no tiene órdenes en el cantón que busca.
//  4. R52 — la descarga proyectaba lo que la tabla pintaba. Esa misma línea, con la tabla
//     paginada, significa «descargá lo que se ve»: el archivo sale, con 25 filas de 60.
//
// Cómo está montado: 60 órdenes de la zona del actor, en los cinco estados y en el ORDEN DEL
// FLUJO que impone el `ORDER BY` (R51), `pageSize` 25 → 3 páginas (la última, de 10). El
// doble de la Server Action paginada FILTRA y RECORTA de verdad, así que navegar y filtrar
// cambian las filas; el doble del listado sin paginar devuelve las 60 agrupadas por estado,
// que es de donde la descarga tiene que sacar el archivo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { enviarACentral } from "@/lib/actions/envio-devolucion-central";
import { recuperarABodega } from "@/lib/actions/resolver-novedad";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

// --- Dobles ---------------------------------------------------------------

const { paginadoMock, conjuntoMock } = vi.hoisted(() => ({
  /** La página que la tabla pinta (T K.1): filtra y recorta como el servidor. */
  paginadoMock: vi.fn(),
  /** El listado SIN recorte, de donde sale la descarga (R52). */
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

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

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

const enviarACentralMock = vi.mocked(enviarACentral);
const recuperarABodegaMock = vi.mocked(recuperarABodega);

// --- Datos ---------------------------------------------------------------

const ZONA = "Limón";
const TOTAL = 60;
const PAGE_SIZE = PAGE_SIZE_SATELITE;
/** Filas de la ÚLTIMA página: 60 - 2×25. Donde `items.length` se delataría (R42). */
const ULTIMA_PAGINA = TOTAL - 2 * PAGE_SIZE;

const LISTADO = "Órdenes de la bodega";
const PAGINACION = "Paginación de las órdenes de la bodega";
const SELECCIONAR_TODO = "Seleccionar todas las órdenes de esta página";

/** Etiqueta única y visible de la fila i (1-based), para localizarla en la tabla. */
function etiqueta(i: number): string {
  return `REM-${String(i).padStart(2, "0")}`;
}

/**
 * Reparto de estado y geografía por posición, pensado para que la PÁGINA y el CONJUNTO no
 * coincidan en nada de lo que los cinco casos miden:
 *
 * | filas | estado | cantón (provincia) | distrito |
 * | 1-30  | `en_bodega_satelite` | 1-25 Escazú (San José), 26-30 Central (San José) | … |
 * | 31-40 | `por_recoger` | Central (San José) | Carmen |
 * | 41-50 | `por_devolver` | Central (Alajuela) — homónimo | Alajuela |
 * | 51-55 | `devolviendo_a_bodega_central` | Barva (Heredia) | San Pedro |
 * | 56-60 | `devuelta` | Barva (Heredia) | San Pedro |
 *
 * Consecuencias buscadas: la página 1 es TODA de un solo cantón y un solo estado (R46), la
 * página 2 mezcla tres estados (R47/R48) y el conjunto tiene cuatro cantones, dos de ellos
 * homónimos.
 */
function estadoDe(i: number): string {
  if (i <= 30) return "en_bodega_satelite";
  if (i <= 40) return "por_recoger";
  if (i <= 50) return "por_devolver";
  if (i <= 55) return "devolviendo_a_bodega_central";
  return "devuelta";
}

function geografiaDe(i: number): {
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string;
} {
  if (i <= 25) {
    return {
      provinciaNombre: "San José",
      cantonNombre: "Escazú",
      distritoNombre: "San Rafael",
    };
  }
  if (i <= 40) {
    return {
      provinciaNombre: "San José",
      cantonNombre: "Central",
      distritoNombre: "Carmen",
    };
  }
  if (i <= 50) {
    return {
      provinciaNombre: "Alajuela",
      cantonNombre: "Central",
      distritoNombre: "Alajuela",
    };
  }
  return {
    provinciaNombre: "Heredia",
    cantonNombre: "Barva",
    distritoNombre: "San Pedro",
  };
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
    ...geografiaDe(i),
  };
}

/** Las 60, en el orden del flujo de la bodega (R51). */
const CONJUNTO: RecepcionSateliteDTO[] = Array.from({ length: TOTAL }, (_, k) =>
  orden(k + 1),
);

/** Las órdenes de un estado, en el orden del conjunto. */
function deEstado(estado: string): RecepcionSateliteDTO[] {
  return CONJUNTO.filter((o) => o.estatusValue === estado);
}

// --- Andamiaje -----------------------------------------------------------

interface FiltroEntrada {
  page?: number;
  pageSize?: number;
  estados?: string[];
  cantones?: string[];
  distritos?: string[];
}

/**
 * El filtro del SERVIDOR (T K.1), reimplementado aquí: comparación por igualdad EXACTA del
 * nombre, como el SQL. No se reusa `filtrarOrdenesSatelite` a propósito —es código de la
 * pantalla— para que el doble no sea lo mismo que se está midiendo.
 */
function filtrarComoElServidor(input: FiltroEntrada): RecepcionSateliteDTO[] {
  return CONJUNTO.filter((o) => {
    if (input.estados?.length && !input.estados.includes(o.estatusValue)) return false;
    if (input.cantones?.length && !input.cantones.includes(o.cantonNombre)) return false;
    if (input.distritos?.length) {
      if (o.distritoNombre === null) return false;
      if (!input.distritos.includes(o.distritoNombre)) return false;
    }
    return true;
  });
}

/**
 * Doble de la Server Action paginada: filtra el conjunto, RECORTA la página pedida y devuelve
 * el `total` del conjunto FILTRADO (no el de la página). Un doble que devolviera siempre la
 * misma lista dejaría pasar una paginación que no navega a ninguna parte.
 */
function servirPaginas() {
  paginadoMock.mockImplementation(async (input: FiltroEntrada = {}) => {
    const filtradas = filtrarComoElServidor(input);
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? PAGE_SIZE;
    const desde = (page - 1) * pageSize;
    return {
      status: "ok",
      items: filtradas.slice(desde, desde + pageSize),
      page,
      pageSize,
      total: filtradas.length,
    };
  });
}

/** Doble del listado SIN recorte: los cinco grupos, como los devuelve `listar()`. */
function servirConjunto() {
  conjuntoMock.mockResolvedValue({
    status: "ok",
    porRecibir: [],
    recibidas: deEstado("en_bodega_satelite"),
    asignadas: deEstado("por_recoger"),
    porDevolver: deEstado("por_devolver"),
    enTransitoACentral: deEstado("devolviendo_a_bodega_central"),
    devueltas: deEstado("devuelta"),
    zonaNombre: ZONA,
    sinZona: false,
  });
}

/** Monta la pantalla con la página 1 pre-cargada por el Server Component. */
function montar() {
  servirPaginas();
  servirConjunto();
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        porRecibir={[]}
        ordenesBodega={paginaBodega(CONJUNTO.slice(0, PAGE_SIZE), { total: TOTAL })}
        // R46: el catálogo se deriva del CONJUNTO, como hace la acción de T K.2. Que sea
        // distinto de lo que trae la página es justo lo que hace medible el requisito.
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

/** El `<nav>` de paginación, localizado por rol y nombre accesible (R43). */
function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: PAGINACION });
}

/** Las remisiones que la tabla está pintando, en orden. */
function remisionesVisibles(): string[] {
  return within(tabla())
    .getAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label") ?? "")
    .filter((n) => n.startsWith("Seleccionar REM-"))
    .map((n) => n.replace("Seleccionar ", ""));
}

/** Casilla de una fila por su remisión. */
function casilla(remision: string): HTMLElement {
  return within(tabla()).getByRole("checkbox", { name: `Seleccionar ${remision}` });
}

async function irAPagina(
  user: ReturnType<typeof userEvent.setup>,
  numero: number,
) {
  await user.click(within(nav()).getByRole("button", { name: `Ir a la página ${numero}` }));
  await waitFor(() =>
    expect(remisionesVisibles()[0]).toBe(etiqueta((numero - 1) * PAGE_SIZE + 1)),
  );
}

/**
 * Elige una opción de un filtro multi de la barra. Mismo recorrido que
 * `tests/unit/components/filter-component.test.tsx`: el panel no se cierra al marcar, así que
 * se reusa el `listbox` si ya está abierto.
 */
async function filtrarPor(
  user: ReturnType<typeof userEvent.setup>,
  filtro: string,
  opcion: string,
) {
  const abierto = screen.queryByRole("listbox", { name: filtro });
  const lista =
    abierto ??
    (await (async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${filtro}:`) }));
      return screen.getByRole("listbox", { name: filtro });
    })());
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

/** Opciones que ofrece un desplegable de la barra, por su etiqueta. */
async function opcionesDe(
  user: ReturnType<typeof userEvent.setup>,
  filtro: string,
): Promise<string[]> {
  const abierto = screen.queryByRole("listbox", { name: filtro });
  const lista =
    abierto ??
    (await (async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${filtro}:`) }));
      return screen.getByRole("listbox", { name: filtro });
    })());
  return within(lista)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

function botonDescarga(): HTMLElement {
  return screen.getByRole("button", { name: `Descargar ${LISTADO}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Riesgo ALTO · «Órdenes de la bodega» del adminSatelite (T K.3)", () => {
  it("el usuario ve las mismas filas que antes en el PRIMER pintado (R44)", () => {
    // Sin `await` y a propósito: la página 1 ya viajó en la respuesta del Server Component.
    // Quitar el `fallbackData` de SWR pasó VERDE en la tanda I porque el test esperaba a que
    // la tabla apareciera; con esa espera, un esqueleto seguido de un viaje al servidor por
    // un dato que ya estaba se daba por bueno.
    montar();
    expect(remisionesVisibles()).toEqual(
      CONJUNTO.slice(0, PAGE_SIZE).map((o) => o.numRemision),
    );
  });

  it("navega entre páginas (R43)", async () => {
    const user = userEvent.setup();
    montar();

    // El control existe y se ENCUENTRA por rol y nombre accesible.
    expect(nav()).toBeInTheDocument();
    expect(remisionesVisibles()).toHaveLength(PAGE_SIZE);
    expect(remisionesVisibles()[0]).toBe(etiqueta(1));

    await user.click(within(nav()).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(remisionesVisibles()[0]).toBe(etiqueta(26)));
    expect(remisionesVisibles()).toHaveLength(PAGE_SIZE);
    // Y las de la página anterior YA NO están: navegar cambia las filas de verdad.
    expect(
      within(tabla()).queryByRole("checkbox", { name: `Seleccionar ${etiqueta(1)}` }),
    ).toBeNull();

    // Última página: 10 filas de un conjunto de 60.
    await user.click(within(nav()).getByRole("button", { name: "Última página" }));
    await waitFor(() => expect(remisionesVisibles()[0]).toBe(etiqueta(51)));
    expect(remisionesVisibles()).toHaveLength(ULTIMA_PAGINA);

    // R42: el contador dice el TOTAL del servidor, no el tamaño de la página. En la última
    // página es donde un contador derivado del array se delata sin ambigüedad.
    expect(within(region()).getByRole("status")).toHaveTextContent(`${TOTAL} órdenes`);
    expect(within(region()).getByRole("status")).not.toHaveTextContent(
      `${ULTIMA_PAGINA} órdenes`,
    );

    await user.click(within(nav()).getByRole("button", { name: "Primera página" }));
    await waitFor(() => expect(remisionesVisibles()[0]).toBe(etiqueta(1)));
  });

  it("seleccionar todo marca exactamente las filas de la página visible (R47)", async () => {
    const user = userEvent.setup();
    montar();
    await irAPagina(user, 2);

    const visibles = remisionesVisibles();
    expect(visibles).toHaveLength(PAGE_SIZE);

    await user.click(within(tabla()).getByRole("checkbox", { name: SELECCIONAR_TODO }));

    // EXACTAMENTE las de la página: ni una menos…
    for (const remision of visibles) expect(casilla(remision)).toBeChecked();
    // …ni una más: el contador de la barra habla de 25, no de las 60 del conjunto.
    expect(within(region()).getByRole("status")).toHaveTextContent(
      `${PAGE_SIZE} seleccionada(s) en esta página`,
    );

    // Y lo que no está a la vista NO queda marcado. Es la comprobación que no se puede
    // esquivar: al volver a la página 1, sus filas siguen sin marcar. Un «seleccionar todo»
    // que abarcara el conjunto las habría marcado sin que el operador las viera.
    await irAPagina(user, 1);
    for (const remision of remisionesVisibles()) {
      expect(casilla(remision), `${remision} quedó marcada sin estar a la vista`).not.toBeChecked();
    }
    expect(within(tabla()).getByRole("checkbox", { name: SELECCIONAR_TODO })).not.toBeChecked();
    // Y la barra vuelve a hablar del conjunto, no de una selección invisible.
    expect(within(region()).getByRole("status")).toHaveTextContent(`${TOTAL} órdenes`);
  });

  it("las acciones de lote se deciden sobre lo seleccionado, no sobre el conjunto (R48)", async () => {
    const user = userEvent.setup();
    enviarACentralMock.mockResolvedValue({ status: "ok" });
    montar();

    // La página 2 mezcla TRES estados: recibidas (26-30), por recoger (31-40) y por devolver
    // (41-50). El conjunto tiene además devueltas y en tránsito, en otra página.
    await irAPagina(user, 2);
    const estadosDeLaPagina = new Set(
      remisionesVisibles().map((r) => CONJUNTO.find((o) => o.numRemision === r)!.estatusValue),
    );
    expect([...estadosDeLaPagina].sort()).toEqual([
      "en_bodega_satelite",
      "por_devolver",
      "por_recoger",
    ]);

    // Sin nada marcado no se ofrece ninguna acción: no hay lote sobre el que actuar.
    expect(within(region()).queryByRole("button", { name: "Enviar a central" })).toBeNull();
    expect(within(region()).queryByRole("button", { name: "Asignar" })).toBeNull();
    expect(
      within(region()).queryByRole("button", { name: "Deshacer asignación" }),
    ).toBeNull();

    // Se marcan TRES `por_devolver` de las diez que hay en el conjunto.
    const elegidas = [etiqueta(41), etiqueta(42), etiqueta(43)];
    for (const remision of elegidas) await user.click(casilla(remision));

    // Solo se ofrece la transición de lo SELECCIONADO, aunque la página tenga órdenes de
    // otros dos estados y el conjunto de otros cuatro.
    expect(within(region()).getByRole("button", { name: "Enviar a central" })).toBeEnabled();
    expect(within(region()).queryByRole("button", { name: "Asignar" })).toBeNull();
    expect(
      within(region()).queryByRole("button", { name: "Deshacer asignación" }),
    ).toBeNull();

    await user.click(within(region()).getByRole("button", { name: "Enviar a central" }));

    // Y la acción recibe EXACTAMENTE las tres marcadas: ni las 25 de la página, ni las 10
    // `por_devolver` del conjunto, ni las 60. Aquí es donde una acción de lote decidida sobre
    // el conjunto movería paquetes que el usuario no eligió.
    await waitFor(() => expect(enviarACentralMock).toHaveBeenCalledTimes(elegidas.length));
    expect(enviarACentralMock.mock.calls.map(([arg]) => arg)).toEqual([
      { ordenId: "o-41" },
      { ordenId: "o-42" },
      { ordenId: "o-43" },
    ]);
  });

  it("una acción de otro estado actúa sobre su selección, no sobre la página (R48)", async () => {
    const user = userEvent.setup();
    recuperarABodegaMock.mockResolvedValue({ status: "ok" });
    montar();

    // Página 3: cinco en tránsito (51-55, sin acción) y cinco devueltas (56-60).
    await irAPagina(user, 3);
    await user.click(casilla(etiqueta(56)));
    await user.click(casilla(etiqueta(57)));

    // «Recuperar» se ofrece; «Enviar a central» no, aunque el CONJUNTO tenga diez órdenes
    // por devolver esperando en la página 2.
    expect(within(region()).getByRole("button", { name: "Recuperar" })).toBeEnabled();
    expect(within(region()).queryByRole("button", { name: "Enviar a central" })).toBeNull();

    await user.click(within(region()).getByRole("button", { name: "Recuperar" }));

    await waitFor(() => expect(recuperarABodegaMock).toHaveBeenCalledTimes(2));
    expect(recuperarABodegaMock.mock.calls.map(([arg]) => arg)).toEqual([
      { ordenId: "o-56" },
      { ordenId: "o-57" },
    ]);
  });

  it("los desplegables de cantón y distrito conservan todas sus opciones (R46)", async () => {
    const user = userEvent.setup();
    montar();

    // La página 1 es TODA de Escazú: derivar las opciones de lo que la tabla pinta dejaría
    // el desplegable con un solo cantón.
    const cantonesDeLaPagina = new Set(
      remisionesVisibles().map((r) => CONJUNTO.find((o) => o.numRemision === r)!.cantonNombre),
    );
    expect([...cantonesDeLaPagina]).toEqual(["Escazú"]);

    // El desplegable ofrece los CUATRO del conjunto, con la provincia desambiguando los dos
    // homónimos (feature 117) y en orden alfabético.
    expect(await opcionesDe(user, "Cantón")).toEqual([
      "Barva (Heredia)",
      "Central (Alajuela)",
      "Central (San José)",
      "Escazú (San José)",
    ]);

    // Y elegir uno no borra los demás: el catálogo no depende de la selección ni de la
    // página que se esté viendo.
    await filtrarPor(user, "Cantón", "Barva (Heredia)");
    await waitFor(() => expect(remisionesVisibles()[0]).toBe(etiqueta(51)));
    expect(await opcionesDe(user, "Cantón")).toHaveLength(4);

    // El distrito depende del cantón elegido, y sus opciones también salen del catálogo del
    // conjunto: «San Pedro» no aparece en ninguna fila de la página 1.
    expect(await opcionesDe(user, "Distrito")).toEqual(["San Pedro"]);
  });

  it("la descarga sigue entregando el dataset completo con los filtros vigentes (R52)", async () => {
    const user = userEvent.setup();
    montar();

    // Se descarga desde la PÁGINA 2 y con un filtro puesto, que es donde la degradación a
    // «descargá lo que se ves» es más fácil de no notar: el filtro de estado «Recibidas» deja
    // 30 órdenes en dos páginas, y la segunda trae CINCO.
    await filtrarPor(user, "Estado", "Recibidas");
    // El número de filas solo no distingue «la página llegó» de «la página está llegando»:
    // el `DataTable` en carga deja un `<tr>` con `role="status"` y filas skeleton, y hay
    // recuentos que cuadran a medio camino. Se exige además que no quede carga en vuelo.
    await waitFor(() => {
      expect(remisionesVisibles()).toHaveLength(PAGE_SIZE);
      expect(within(tabla()).queryByRole("status")).not.toBeInTheDocument();
    });
    await user.click(within(nav()).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => {
      expect(remisionesVisibles()).toHaveLength(5);
      expect(within(tabla()).queryByRole("status")).not.toBeInTheDocument();
    });

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    // Las TREINTA del conjunto que cumplen el filtro, no las 5 que la tabla pinta ni las 25
    // de la primera página.
    expect(filas).toHaveLength(30);
    expect(filas.map((f) => f.numRemision)).toEqual(
      deEstado("en_bodega_satelite").map((o) => o.numRemision),
    );
    // Y el filtro vigente SÍ se respeta: ninguna orden de otro estado entra en el archivo.
    expect(filas.map((f) => f.estatus)).not.toContain("Por devolver");
  });

  it("la descarga sin filtros entrega el conjunto entero, no la página (R52)", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(titulo).toBe(LISTADO);
    expect(filas).toHaveLength(TOTAL);
    expect(filas.map((f) => f.numRemision)).toEqual(CONJUNTO.map((o) => o.numRemision));
  });
});
