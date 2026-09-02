// @vitest-environment jsdom
// FICHA 355 — «las satélite deberían poder filtrar por estado igual que la central, solo que
// con sus órdenes nada más» (pedido humano del 2026-09-02, con las dos capturas delante).
//
// Este archivo mide LA PANTALLA, no la declaración: que el desplegable enseña el catálogo con
// las etiquetas de la central, y —lo que de verdad importa— que ofrecer más estados NO ensancha
// lo que el `adminSatelite` alcanza.
//
// EL LÍMITE, dicho con precisión, porque es lo que hay que defender: el recorte real lo impone
// el servicio, acotado a su zona y a los cinco estados del listado. La selección INTERSECA esa
// lista blanca y nunca la amplía; un `estados: ["entregada"]` no devuelve entregadas y tampoco
// devuelve «todas»: devuelve NADA. Elegir un estado inalcanzable tiene que dar CERO filas con
// una explicación, no un listado completo y no un error.
//
// EL DOBLE MODELA LAS TRES CAPAS DEL SERVIDOR, y sin las tres el caso no probaría nada:
//
//   1. EL BORDE (`lib/types/recepcion-satelite.ts`): `z.array(z.enum(ESTADOS_BODEGA_SATELITE))`.
//      Un value ajeno NO se ignora: tumba la petición entera. Por eso el doble responde un
//      estado de error, y por eso un cliente que mandara la selección SIN intersecar rompería
//      la pantalla en vez de filtrar de más.
//   2. EL SERVICIO (`RecepcionSateliteService`): `estatusValues: estadosDelListado(estados)`,
//      la intersección con la lista blanca. Se REUSA la función real —no es código de la
//      pantalla, es la regla del servidor— para que el doble no pueda divergir de ella.
//      ⚠️ Y su regla clave: selección VACÍA o AUSENTE significa LOS CINCO. De ahí que
//      `estados: []` no se pueda mandar al servidor y el corte tenga que ser del cliente.
//   3. EL REPOSITORIO (`findRecepcionSatelitePaginada`): `estatusValues` vacío ⇒ conjunto
//      vacío, cortado antes de consultar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  ESTADOS_BODEGA_SATELITE,
  estadosDelListado,
} from "@/lib/utils/estados-bodega-satelite";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

const { paginadoMock, completoMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  completoMock: vi.fn(),
}));

vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoMock(...a),
  listarOrdenesBodegaCompleto: (...a: unknown[]) => completoMock(...a),
  listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok", ids: [] })),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({ enviarACentral: vi.fn() }));
vi.mock("@/lib/actions/resolver-novedad", () => ({ recuperarABodega: vi.fn() }));
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: vi.fn(async () => listarOrderStatusOk()),
}));

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

import { listarOrderStatusOk } from "@/tests/fixtures/order-status-catalogo";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

// --- Datos ---------------------------------------------------------------

const ZONA = "Limón";
const LISTADO = "Órdenes de la bodega";
const ERROR_CARGA = "No se pudieron cargar las órdenes de la bodega.";

/** Etiqueta del estado tal como la dice el catálogo compartido (la MISMA que `/ordenes`). */
const EN_BODEGA = ORDER_STATUS_LABELS.en_bodega_satelite;
const DEVUELTA = ORDER_STATUS_LABELS.devuelta;
const ENTREGADA = ORDER_STATUS_LABELS.entregada;

function etiqueta(i: number): string {
  return `REM-${String(i).padStart(2, "0")}`;
}

/**
 * Diez órdenes en DOS de los cinco estados del listado. Nada más: el listado real nunca
 * devuelve otra cosa, y montar aquí una `entregada` inventaría un mundo en el que el fallo
 * sería visible por una razón que en producción no existe.
 */
function orden(i: number): RecepcionSateliteDTO {
  return {
    ...CAMPOS_BASE_ORDEN,
    id: `o-${i}`,
    numGuia: 1000 + i,
    numRemision: etiqueta(i),
    estatusValue: i <= 6 ? "en_bodega_satelite" : "devuelta",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: ZONA,
    intentosEntrega: 0,
    provinciaNombre: "Limón",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
  };
}

const CONJUNTO: RecepcionSateliteDTO[] = Array.from({ length: 10 }, (_, k) =>
  orden(k + 1),
);

/**
 * Las diez remisiones del listado sin filtrar, EN ORDEN. Es el ancla de la carga inicial de
 * los cuatro casos.
 *
 * ⚠️ Y es una lista, no un `toHaveLength(10)`, por una razon con historia en este repo
 * (`tests/unit/guards/ancla-de-carga.guardia.test.ts`): durante la carga el `DataTable` pinta
 * una fila `role="status"` («Cargando») mas skeletons `aria-hidden`, asi que hay estados
 * TRANSITORIOS que satisfacen un conteo. Un `waitFor` anclado solo a un numero puede darse por
 * cumplido con la tabla a medio pintar — y estos cuatro casos son los que verifican el LIMITE
 * DE ALCANCE del `adminSatelite`, donde un verde a media carga no afirmaria lo que dice
 * afirmar. Decir CUALES diez no tiene estado intermedio que lo cumpla, y ademas documenta el
 * punto de partida contra el que se comparan los filtros.
 */
const TODAS_LAS_REMISIONES: string[] = CONJUNTO.map((o) => o.numRemision);

// --- El doble del servidor ------------------------------------------------

interface EntradaListado {
  estados?: string[];
  page?: number;
  pageSize?: number;
}

/** Capa 1 — el BORDE: `z.enum` sobre los cinco. Un value ajeno tumba la petición entera. */
function elBordeRechaza(input: EntradaListado): boolean {
  return (input.estados ?? []).some(
    (v) => !(ESTADOS_BODEGA_SATELITE as readonly string[]).includes(v),
  );
}

/** Capas 2 y 3 — el servicio interseca; el repositorio corta si no queda ningún estado. */
function filasDelServidor(input: EntradaListado): RecepcionSateliteDTO[] {
  const estatusValues = estadosDelListado(input.estados);
  if (estatusValues.length === 0) return [];
  return CONJUNTO.filter((o) =>
    (estatusValues as readonly string[]).includes(o.estatusValue),
  );
}

function servirServidor() {
  paginadoMock.mockImplementation(async (input: EntradaListado = {}) => {
    if (elBordeRechaza(input)) return { status: "datos_invalidos" };
    const filas = filasDelServidor(input);
    return {
      status: "ok",
      items: filas,
      page: input.page ?? 1,
      pageSize: input.pageSize ?? PAGE_SIZE_SATELITE,
      total: filas.length,
    };
  });
  completoMock.mockImplementation(async (input: EntradaListado = {}) => {
    if (elBordeRechaza(input)) return { status: "datos_invalidos" };
    const filas = filasDelServidor(input);
    return { status: "ok", items: filas, total: filas.length };
  });
}

// --- Andamiaje de la pantalla --------------------------------------------

function montar() {
  servirServidor();
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        ordenesBodega={paginaBodega(CONJUNTO)}
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

/** Las remisiones que la tabla está pintando, en orden. */
function remisionesVisibles(): string[] {
  return within(tabla())
    .getAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label") ?? "")
    .filter((n) => n.startsWith("Seleccionar REM-"))
    .map((n) => n.replace("Seleccionar ", ""));
}

/** PIDE un filtro en el selector de la barra (los controles no están puestos de entrada). */
async function pedirFiltro(user: ReturnType<typeof userEvent.setup>, label: string) {
  if (screen.queryByRole("listbox", { name: "Filtros" }) === null) {
    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
  }
  const puesto = within(
    await screen.findByRole("listbox", { name: "Filtros" }),
  ).getByRole("option", { name: label });
  if (puesto.getAttribute("aria-selected") !== "true") await user.click(puesto);
}

/** El `listbox` del filtro de estado, abriéndolo si hace falta. */
async function abrirEstado(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await pedirFiltro(user, "Estado");
  const abierto = screen.queryByRole("listbox", { name: "Estado" });
  if (abierto !== null) return abierto;
  await user.click(screen.getByRole("button", { name: /^Estado:/ }));
  return screen.getByRole("listbox", { name: "Estado" });
}

async function marcarEstados(
  user: ReturnType<typeof userEvent.setup>,
  ...opciones: string[]
) {
  const lista = await abrirEstado(user);
  for (const opcion of opciones) {
    await user.click(within(lista).getByRole("option", { name: opcion }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("bodega satélite · el desplegable de estado es el de la central", () => {
  it("ofrece el catálogo entero con SUS etiquetas, y ya no los cinco nombres propios", async () => {
    const user = userEvent.setup();
    montar();

    const lista = await abrirEstado(user);
    const opciones = within(lista)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());

    // Lo que el humano señaló en la captura de la central y no estaba aquí: el catálogo.
    expect(opciones).toContain(ENTREGADA);
    expect(opciones).toContain(ORDER_STATUS_LABELS.ayuda_tienda);
    expect(opciones).toContain(ORDER_STATUS_LABELS.devolucion_por_confirmar);
    expect(opciones).toContain(ORDER_STATUS_LABELS.devolviendo_a_bodega_central);
    expect(opciones.length).toBeGreaterThan(ESTADOS_BODEGA_SATELITE.length);

    // Y las etiquetas propias de esta pantalla ya no existen: el mismo estado dejaba de
    // llamarse de dos maneras según dónde se mirara.
    expect(opciones).toContain(EN_BODEGA);
    expect(opciones).not.toContain("Recibidas");
    expect(opciones).not.toContain("Asignadas (por recoger)");
    expect(opciones).not.toContain("En tránsito a central");
    expect(opciones).not.toContain("Devueltas");
  });

  it("el buscador del desplegable dice sobre qué busca, como en `/ordenes`", async () => {
    const user = userEvent.setup();
    montar();

    await abrirEstado(user);
    // La tercera diferencia de las capturas: «Buscar…» contra «Filtrar estados…».
    // La caja es HERMANA del `listbox` dentro del panel (y es un `type="search"`, así que su
    // rol es `searchbox`, no `textbox`).
    expect(screen.getByRole("searchbox", { name: "Buscar en Estado" })).toHaveAttribute(
      "placeholder",
      "Filtrar estados…",
    );
  });
});

describe("bodega satélite · ofrecer más estados NO amplía el alcance", () => {
  it("elegir un estado que su alcance no devuelve da CERO filas, no el listado entero", async () => {
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(remisionesVisibles()).toEqual(TODAS_LAS_REMISIONES));
    const lecturasAntes = paginadoMock.mock.calls.length;

    await marcarEstados(user, ENTREGADA);

    // (a) Ninguna orden. Si la selección se omitiera —o se ampliara la lista blanca— aquí
    //     estarían las diez de la bodega, que es exactamente lo que no se puede permitir.
    await waitFor(() => expect(remisionesVisibles()).toEqual([]));

    // (b) NI UNA CONSULTA. `estados: []` en el servidor significa «los cinco», así que la
    //     única forma correcta de pedir «ninguna» es no pedir nada.
    expect(paginadoMock.mock.calls.length).toBe(lecturasAntes);

    // (c) El vacío se EXPLICA, y no es un error: la tabla no enseña el aviso de fallo.
    //     La explicación va bajo el CONTADOR y no en el vacío de la tabla, que a 390 px queda
    //     fuera de la vista (medido con Playwright; ver `mensajeEstadosFueraDelListado`).
    expect(
      within(region()).getByText(
        `Ninguna orden de esta bodega puede estar en «${ENTREGADA}»: ese estado no forma parte de este listado.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(ERROR_CARGA)).not.toBeInTheDocument();

    // Y va DENTRO de la región `role="status"` de la barra: al cambiar el filtro, un lector de
    // pantalla lo anuncia en vez de dejar una tabla que se vació sin decir nada.
    const anunciadas = within(region())
      .getAllByRole("status")
      .map((n) => n.textContent ?? "");
    expect(
      anunciadas.some((t) => t.includes(`Ninguna orden de esta bodega puede estar en «${ENTREGADA}»`)),
      "la explicación no está en ninguna región anunciada",
    ).toBe(true);
  });

  it("y el ARCHIVO dice lo mismo que la pantalla: tampoco trae nada", async () => {
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(remisionesVisibles()).toEqual(TODAS_LAS_REMISIONES));

    await marcarEstados(user, ENTREGADA);
    await waitFor(() => expect(remisionesVisibles()).toEqual([]));

    // La descarga es el CONJUNTO con los filtros vigentes. Sin el mismo corte, el archivo
    // saldría con las diez órdenes mientras la tabla enseña cero, y nadie lo notaría hasta
    // abrirlo.
    await user.click(
      screen.getByRole("button", { name: new RegExp(`^Descargar ${LISTADO}`) }),
    );
    await waitFor(() => expect(completoMock).not.toHaveBeenCalled());
  });

  it("una selección MEZCLADA trae la parte alcanzable, y avisa de la otra", async () => {
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(remisionesVisibles()).toEqual(TODAS_LAS_REMISIONES));

    await marcarEstados(user, ENTREGADA, DEVUELTA);

    // Sólo las cuatro `devuelta`: la parte inalcanzable no suma ni resta.
    await waitFor(() =>
      expect(remisionesVisibles()).toEqual([7, 8, 9, 10].map(etiqueta)),
    );
    expect(
      (paginadoMock.mock.calls.at(-1)?.[0] as { estados?: string[] })?.estados,
    ).toEqual(["devuelta"]);

    // Y la pantalla dice por qué «Entregada» no aporta nada, para que el resultado no se lea
    // como un filtro que se ignoró en silencio.
    expect(
      within(region()).getByText(
        `«${ENTREGADA}» no es un estado de este listado: no suma órdenes.`,
      ),
    ).toBeInTheDocument();
  });

  it("CONTROL POSITIVO: un estado del listado sí filtra, y el servidor lo recibe", async () => {
    // Sin este caso, los tres de arriba pasarían igual de verdes con un desplegable roto que
    // no emitiera nada.
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(remisionesVisibles()).toEqual(TODAS_LAS_REMISIONES));

    await marcarEstados(user, EN_BODEGA);

    await waitFor(() =>
      expect(remisionesVisibles()).toEqual([1, 2, 3, 4, 5, 6].map(etiqueta)),
    );
    expect(
      (paginadoMock.mock.calls.at(-1)?.[0] as { estados?: string[] })?.estados,
    ).toEqual(["en_bodega_satelite"]);
    expect(screen.queryByText(ERROR_CARGA)).not.toBeInTheDocument();
  });
});
