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
// Feature 184 — Tanda A (T A.5, R18/R20/R22/R23/R24/R25/R27) — LA PODA, que es lo que hace
// que ese aviso no mienta.
//
// El aviso volvió CONTABLE un hueco que llevaba abierto desde el principio: la selección no se
// podaba NUNCA. Se limpia entera al cambiar filtros (a propósito) y sobrevive al cambio de
// página (a propósito), pero cuando una orden marcada dejaba de estar en el listado —le
// reportan un incidente y sale del flujo— la marca seguía viva, invisible, y el aviso contaba
// órdenes que ya no existen ahí. El caso que mide la feature NO es «marco y cambio de página»
// (eso ya funcionaba): es «marco, la orden desaparece del listado, y el contador deja de
// contarla».
//
// Cómo está montado: 6 órdenes en `pageSize` 3 → 2 páginas, con un estado por página
// (`en_bodega_satelite` la 1, `por_devolver` la 2) para que el aviso se lea junto al botón de
// lote que NO va a llevárselas. El doble de la Server Action paginada recorta de verdad sobre
// un conjunto MUTABLE (`vivas`), así que una orden puede salir del listado a mitad de un caso;
// y el doble de la vigencia responde contra ESE mismo conjunto, que es lo que hace el servidor
// —no una lista escrita a mano que diría que sí a cualquier cosa—.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { catalogoSatelite, paginaBodega } from "@/tests/fixtures/satelite-bodega";

// --- Dobles ---------------------------------------------------------------

const { paginadoMock, vigenciaMock, recibirLoteMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  /** T A.5: la comprobación con la que la pantalla poda la selección. */
  vigenciaMock: vi.fn(),
  /** Una acción CUALQUIERA de la pantalla que relee del servidor, para disparar la poda. */
  recibirLoteMock: vi.fn(),
}));

vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  recibirLote: (...a: unknown[]) => recibirLoteMock(...a),
  asignarDesdeSatelite: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoMock(...a),
  // Este archivo no descarga nada: si el conjunto se pidiera, sería un defecto (R28).
  listarOrdenesBodegaCompleto: vi.fn(async () => ({
    status: "ok",
    items: [],
    total: 0,
  })),
  listarIdsVigentesBodega: (...a: unknown[]) => vigenciaMock(...a),
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
/** La sección de arriba: su botón es la acción que relee el listado sin tocar la selección. */
const ACEPTAR = "Aceptar";

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

/** Una orden de «Por recibir»: no entra al listado, sólo da un botón que relee del servidor. */
const POR_RECIBIR: RecepcionSateliteDTO = {
  ...orden(9),
  id: "o-9",
  numRemision: "REM-09",
  estatusValue: "en_ruta_bodega_satelite",
};

// --- Andamiaje -----------------------------------------------------------

interface FiltroEntrada {
  page?: number;
  pageSize?: number;
  estados?: string[];
  ids?: string[];
}

/**
 * El conjunto que el SERVIDOR tiene ahora mismo. Es mutable a propósito: sacar de aquí una
 * orden es exactamente lo que le pasa a una a la que le reportan un incidente, y es la única
 * forma de medir la poda sin escribir a mano la respuesta de la vigencia.
 */
let vivas: RecepcionSateliteDTO[] = [];

/** Saca del listado la orden indicada (le reportaron un incidente: sale del flujo). */
function saleDelListado(...ids: string[]) {
  vivas = vivas.filter((o) => !ids.includes(o.id));
}

/** Doble de la acción paginada: FILTRA y RECORTA de verdad sobre lo que sigue vivo. */
function servirPaginas() {
  paginadoMock.mockImplementation(async (input: FiltroEntrada = {}) => {
    const filtradas = vivas.filter(
      (o) => !input.estados?.length || input.estados.includes(o.estatusValue),
    );
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

/**
 * Doble de la vigencia: responde sobre el MISMO conjunto que sirve las páginas, que es lo que
 * hace el servidor (el mismo `WHERE` más un `IN` de ids). Devuelve los VIGENTES —el
 * subconjunto de lo preguntado que sigue ahí—, nunca los caducados.
 */
function servirVigencia() {
  vigenciaMock.mockImplementation(async (input: FiltroEntrada = {}) => ({
    status: "ok",
    ids: (input.ids ?? []).filter((id) => vivas.some((o) => o.id === id)),
  }));
}

function montar() {
  vivas = [...CONJUNTO];
  servirPaginas();
  servirVigencia();
  recibirLoteMock.mockResolvedValue({ status: "ok", recibidas: 1 });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        porRecibir={[POR_RECIBIR]}
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

/**
 * El texto de la barra de selección, del que el aviso es una coletilla subordinada.
 *
 * Pedido humano (2026-08-19): desde que esta pantalla monta la barra de `/ordenes`, la seccion
 * tiene DOS regiones `role="status"` —el aviso del minimo de caracteres del buscador (vacio
 * salvo cuando falta teclear) y esta—, asi que se elige por lo que DICE, no por ser la unica.
 */
function barra(): HTMLElement {
  const status = within(region())
    .getAllByRole("status")
    .filter((n) => (n.textContent ?? "").trim() !== "");
  return status[status.length - 1]!;
}

/** El aviso, buscado por lo que DICE: que hay marcas fuera y que no entran. */
function avisoTexto(): string | null {
  const nodo = within(region())
    .queryAllByText(/marcadas en otras páginas/)
    .at(0);
  return nodo?.textContent?.replace(/\s+/g, " ").trim() ?? null;
}

/** El aviso esperado con `n` órdenes fuera de la página visible. */
function aviso(n: number): string {
  return `Tienes ${n} orden(es) marcadas en otras páginas que no entran en esta acción.`;
}

async function irAPagina(
  user: ReturnType<typeof userEvent.setup>,
  numero: number,
  primera = etiqueta((numero - 1) * PAGE_SIZE + 1),
) {
  await user.click(
    within(nav()).getByRole("button", { name: `Ir a la página ${numero}` }),
  );
  await waitFor(() => expect(remisionesVisibles()[0]).toBe(primera));
}

/**
 * Dispara una RELECTURA del listado sin tocar la selección, la página ni los filtros: acepta
 * la orden de «Por recibir», que es una acción de otra sección de la pantalla y termina —como
 * todas— releyendo del servidor. Se ancla a que la tabla enseñe las filas nuevas, que es la
 * señal POSITIVA de que la lectura llegó (esperar a que «algo desaparezca» se cumple también
 * antes de que la acción empiece).
 */
async function releerListado(
  user: ReturnType<typeof userEvent.setup>,
  visiblesTrasLaRelectura: string[],
) {
  await user.click(
    within(screen.getByRole("region", { name: "Por recibir" })).getByRole("button", {
      name: ACEPTAR,
    }),
  );
  await waitFor(() => expect(remisionesVisibles()).toEqual(visiblesTrasLaRelectura));
}

/** Elige una opción del filtro multi de la barra (mismo recorrido que los demás archivos). */
/**
 * PIDE un filtro en el selector de la barra. Pedido humano (2026-08-19): esta pantalla monta
 * `BuscadorFiltros`, la barra de `/ordenes`, y ahi los filtros NO estan puestos de entrada.
 */
async function pedirFiltro(user: ReturnType<typeof userEvent.setup>, label: string) {
  if (screen.queryByRole("listbox", { name: "Filtros" }) === null) {
    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
  }
  const puesto = within(await screen.findByRole("listbox", { name: "Filtros" })).getByRole(
    "option",
    { name: label },
  );
  if (puesto.getAttribute("aria-selected") !== "true") await user.click(puesto);
}

async function filtrarPor(
  user: ReturnType<typeof userEvent.setup>,
  filtro: string,
  opcion: string,
) {
  await pedirFiltro(user, filtro);
  const abierto = screen.queryByRole("listbox", { name: filtro });
  const lista =
    abierto ??
    (await (async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${filtro}:`) }));
      return screen.getByRole("listbox", { name: filtro });
    })());
  await user.click(within(lista).getByRole("option", { name: opcion }));
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
    expect(avisoTexto()).toBe(aviso(2));
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
    expect(avisoTexto()).toBe(aviso(2));
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
    expect(avisoTexto()).toBe(aviso(1));
  });
});

describe("Feature 184 · T A.5 — la poda de la selección", () => {
  it("una orden marcada que SALE del listado deja de estar marcada tras la relectura (R18/R25)", async () => {
    // EL caso de la feature. Nada de esto se ve al cambiar de página: la orden sigue en el
    // conjunto y el aviso acierta. Lo que hasta hoy no se podaba nunca es la marca de una
    // orden que YA NO ESTÁ en el listado —le reportaron un incidente y salió del flujo—, y el
    // aviso, que la 170 dejó contable, empezaba a contar fantasmas.
    const user = userEvent.setup();
    montar();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);
    expect(avisoTexto()).toBe(aviso(2));

    // A la 01 le reportan un incidente y sale del listado. La marca sigue puesta: el
    // navegador no tiene forma de saberlo hasta que vuelva a leer.
    saleDelListado("o-1");
    const llamadasAntes = vigenciaMock.mock.calls.length;

    // Una acción de OTRA sección relee el listado. Sin cambiar de página, sin tocar filtros y
    // sin tocar la selección: lo único que cambia es que el servidor ya no tiene la 01.
    // La página 2 pasa a ser [05, 06] porque el conjunto perdió una fila.
    await releerListado(user, [etiqueta(5), etiqueta(6)]);

    // R18/R25: el número BAJA, porque la 01 dejó de estar marcada. Ancla positiva: se espera
    // al texto nuevo, no a que el viejo desaparezca.
    await waitFor(() => expect(avisoTexto()).toBe(aviso(1)));

    // R24: esa relectura costó UNA comprobación, ni cero ni dos. Podar cambia la selección, y
    // una implementación que reaccionara a ese cambio encadenaría comprobaciones sin fin.
    expect(vigenciaMock.mock.calls.length).toBe(llamadasAntes + 1);

    // Y la 02 —que sí sigue en el listado— conserva su marca: la poda retira lo que ya no
    // existe, no lo que no se ve. En la página 1 no queda NINGÚN aviso, que es lo que
    // distingue «la 01 se retiró de la selección» de «la 01 sigue marcada y no se cuenta».
    await irAPagina(user, 1, etiqueta(2));
    expect(casilla(etiqueta(2))).toBeChecked();
    expect(avisoTexto()).toBeNull();
    expect(barra()).toHaveTextContent("1 seleccionada(s) en esta página");
  });

  it("el aviso desaparece cuando ya no queda ninguna marcada fuera (R25)", async () => {
    const user = userEvent.setup();
    montar();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);
    expect(avisoTexto()).toBe(aviso(2));

    // Las DOS salen del listado (dos incidentes). Tras la relectura no queda nada que contar,
    // y el aviso no se queda diciendo «0 órdenes»: se va.
    saleDelListado("o-1", "o-2");
    await releerListado(user, [etiqueta(6)]);

    await waitFor(() => expect(avisoTexto()).toBeNull());
    // La barra vuelve a hablar del conjunto: no queda ninguna selección viva.
    expect(barra()).toHaveTextContent("4 órdenes");
  });

  it("cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24)", async () => {
    // El contrapeso del caso anterior: la poda retira lo que salió del conjunto, NUNCA lo que
    // simplemente no se ve. Sin este caso, «desmarcar todo lo de otras páginas» pasaría verde
    // en el de arriba.
    const user = userEvent.setup();
    montar();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);

    // R19: lo que se pregunta son las marcas de FUERA de la página visible, y se pregunta al
    // servidor sobre el conjunto con los filtros vigentes — sin ninguna clave de alcance.
    await waitFor(() => expect(vigenciaMock).toHaveBeenCalledTimes(1));
    expect(vigenciaMock.mock.calls[0][0]).toEqual({ ids: ["o-1", "o-2"] });

    // Nadie salió del listado ⇒ nadie se desmarca, y el aviso sigue diciendo dos.
    expect(avisoTexto()).toBe(aviso(2));

    await irAPagina(user, 1);
    expect(casilla(etiqueta(1))).toBeChecked();
    expect(casilla(etiqueta(2))).toBeChecked();
    expect(barra()).toHaveTextContent("2 seleccionada(s) en esta página");

    // R24: volver a la página 1 no deja marcas fuera, así que no cuesta comprobación alguna.
    expect(vigenciaMock).toHaveBeenCalledTimes(1);
  });

  it("sin marcas fuera de la página visible no se consulta la vigencia (R23/R28)", async () => {
    // La poda no puede volverse un peaje por render. Sin marcas invisibles no hay nada que
    // comprobar: ni al montar (R28: la carga inicial no gana una consulta), ni al marcar y
    // desmarcar filas de la página, ni al navegar con la selección vacía.
    const user = userEvent.setup();
    montar();
    expect(vigenciaMock).not.toHaveBeenCalled();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await user.click(casilla(etiqueta(1)));
    expect(vigenciaMock).not.toHaveBeenCalled();

    // Se desmarca lo que quedaba y se navega: sin selección, no hay nada que podar.
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);
    expect(vigenciaMock).not.toHaveBeenCalled();

    // Y la relectura de una acción tampoco la dispara por su cuenta.
    await releerListado(user, [etiqueta(4), etiqueta(5), etiqueta(6)]);
    expect(vigenciaMock).not.toHaveBeenCalled();
  });

  it("si la comprobación falla, la selección queda INTACTA (R22)", async () => {
    // Mismo guion que el caso de la poda, cambiando UNA cosa: la comprobación no se puede
    // hacer. La respuesta se ignora entera —no se poda a medias ni se desmarca «por si
    // acaso»—, porque desmarcar lo que el operador marcó es más caro que contar de más.
    const user = userEvent.setup();
    montar();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);

    vigenciaMock.mockResolvedValue({ status: "forbidden" });
    saleDelListado("o-1");
    await releerListado(user, [etiqueta(5), etiqueta(6)]);

    // Se preguntó (la relectura sí dispara la comprobación)…
    await waitFor(() => expect(vigenciaMock.mock.calls.length).toBeGreaterThan(1));
    // …y como no hubo respuesta utilizable, NADA cambió: siguen las dos marcadas.
    expect(avisoTexto()).toBe(aviso(2));

    // Señal POSITIVA de que la 01 sigue en la selección: en la página 1, donde la 02 está a la
    // vista, el aviso todavía cuenta a la 01 —que ya no existe en el listado—. Es el defecto
    // original, y es lo que debe pasar cuando la comprobación no se pudo hacer.
    await irAPagina(user, 1, etiqueta(2));
    expect(casilla(etiqueta(2))).toBeChecked();
    expect(avisoTexto()).toBe(aviso(1));
  });

  it("cambiar los filtros sigue limpiando la selección ENTERA (R27)", async () => {
    // La poda no sustituye a esto ni lo suaviza: filtrar cambia el conjunto, así que se limpia
    // todo de una vez y sin preguntarle nada al servidor. Si la limpieza dependiera de la
    // comprobación, un fallo de red dejaría marcas vivas bajo un filtro que no las muestra.
    const user = userEvent.setup();
    montar();

    await user.click(casilla(etiqueta(1)));
    await user.click(casilla(etiqueta(2)));
    await irAPagina(user, 2);
    expect(avisoTexto()).toBe(aviso(2));
    const llamadasAntes = vigenciaMock.mock.calls.length;

    // Se filtra por el estado de la página 1: el conjunto pasa a ser tres órdenes en una sola
    // página, y la selección se va entera.
    await filtrarPor(user, "Estado", "Recibidas");
    await waitFor(() => {
      expect(remisionesVisibles()).toEqual([etiqueta(1), etiqueta(2), etiqueta(3)]);
      expect(within(tabla()).queryByRole("status")).not.toBeInTheDocument();
    });

    expect(casilla(etiqueta(1))).not.toBeChecked();
    expect(casilla(etiqueta(2))).not.toBeChecked();
    expect(avisoTexto()).toBeNull();
    expect(barra()).toHaveTextContent("3 de 6 órdenes");
    // Y no costó ninguna comprobación: no hay nada que podar cuando no queda nada marcado.
    expect(vigenciaMock.mock.calls.length).toBe(llamadasAntes);
  });
});
