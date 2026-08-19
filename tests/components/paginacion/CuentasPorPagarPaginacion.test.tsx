// @vitest-environment jsdom
// Feature 170 — FASE 2, T L.2 (R42/R43/R45/R50/R52) — «Cuentas por pagar a mensajeros» del
// `maestro`/`admin`, la segunda pantalla de riesgo ALTO del Anexo III (`design.md §11.3`).
//
// Es de riesgo ALTO porque CAMBIA DE USO: hasta hoy recibía el conjunto entero por props y
// buscaba por nombre en el navegador; desde T L.1 la búsqueda y la página las resuelve el
// servidor. El humano renunció a la verificación en pantalla, así que esto es la única red.
// Lo que puede romperse aquí, y ninguna de las cuatro cosas falla sola:
//
//  1. R45 — la búsqueda pasaba a mirar SOLO la página. Escribir el nombre de un mensajero que
//     está en la página 3 no lo encontraría, y la pantalla no diría que ha mirado 25 filas de
//     60: diría «no hay resultados», que es una frase distinta y falsa.
//  2. R50 — **el punto delicado**. Cada fila DESPLIEGA el desglose por cierre de su mensajero.
//     Con el conjunto entero a la vista, «la fila que se expande» y «la fila que estaba ahí al
//     cargar» eran la misma; con páginas, no. Un desglose que se resolviera contra las filas
//     que llegaron por props abriría, en la página 3, la cuenta de OTRA persona —con sus
//     montos— sin ningún error: el panel se abre, carga y enseña dinero.
//  3. R52 — la descarga proyectaba lo que la tabla pintaba. Esa misma línea, ya paginada,
//     significa «descargá lo que se ve»: el archivo sale, con 25 filas de 60.
//  4. R42 — el contador nace en esta tanda; si saliera de las filas de la página diría «25
//     mensajeros» habiendo 60 con cuentas pendientes.
//
// Cómo está montado: 60 mensajeros, `pageSize` 25 → 3 páginas (la última, de 10). Los nombres
// llevan un apellido por bloque para que una búsqueda case con filas que NO están en la página
// visible, y el mensajero 51 —página 3— tiene una cuenta por pagar de ₡500, que es la que
// se sigue hasta el desglose y hasta el archivo. El doble de la Server Action paginada FILTRA
// y RECORTA de verdad, así que navegar y buscar cambian las filas.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { walletMensajeroConfig } from "@/lib/config/wallet-mensajero";
// Feature 201 (tanda B): estas tres aserciones siguen a UNA fila concreta (¿el desglose de la
// página 3 enseña el dinero del 51 o el del que ocupaba su sitio en la página 1?), y por eso el
// importe esperado se DERIVA del dato del doble en vez de escribirse a mano. Antes se derivaba
// con un `₡${…}` que copiaba el formato; ahora se deriva con el MISMO formateador que pinta la
// tabla. Lo que se mide no cambia: sigue siendo de QUÉ fila es el importe.
import { money } from "@/lib/config/moneda";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

// --- Dobles ---------------------------------------------------------------

const { paginadoMock, conjuntoMock, desgloseMock } = vi.hoisted(() => ({
  /** La página que la tabla pinta (T L.1): filtra y recorta como el servidor. */
  paginadoMock: vi.fn(),
  /** El CONJUNTO sin recorte, con la búsqueda ya aplicada, de donde sale el archivo (R52). */
  conjuntoMock: vi.fn(),
  /** El desglose por cierre de UN mensajero, que se pide al expandir su fila (R50). */
  desgloseMock: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarCompletoAction: (...a: unknown[]) => conjuntoMock(...a),
  listarCuentasPorPagarPaginadoAction: (...a: unknown[]) => paginadoMock(...a),
  listarPagosDeMensajeroAction: (...a: unknown[]) => desgloseMock(...a),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
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

import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

// --- Datos ---------------------------------------------------------------

const TOTAL = 60;
const PAGE_SIZE = walletMensajeroConfig.DEFAULT_PAGE_SIZE;
/** Filas de la ÚLTIMA página: 60 - 2×25. Donde `items.length` se delataría (R42). */
const ULTIMA_PAGINA = TOTAL - 2 * PAGE_SIZE;

const LISTADO = "Cuentas por pagar a mensajeros";
const PAGINACION = "Paginación de las cuentas por pagar";

/**
 * Un apellido por MITAD del conjunto, y treinta no es un número cualquiera: es más que una
 * página (25) y menos que el conjunto (60). Así, con una búsqueda puesta, «la página», «lo
 * encontrado» y «el conjunto» son tres números distintos —25, 30 y 60— y ninguna aserción
 * puede pasar por casualidad. Además «Solís» son los mensajeros 31-60: en la página 1 sin
 * filtro no hay ni uno, que es lo que hace medible «la búsqueda mira el conjunto».
 */
function apellido(i: number): string {
  return i <= 30 ? "Rojas" : "Solís";
}

/** Filas que casan con un apellido: 30, ni la página ni el conjunto. */
const FILAS_POR_APELLIDO = 30;

/**
 * Nombre con el índice a DOS cifras para que el orden alfabético del listado (T L.1, R51) y el
 * orden de los índices sean el mismo: así «la página 2 empieza por el 26» es comprobable.
 */
function nombre(i: number): string {
  return `Mensajero ${String(i).padStart(2, "0")} ${apellido(i)}`;
}

/**
 * Una fila del listado. Los tres montos son STRING del servidor y NO guardan relación
 * aritmética entre sí a propósito: la pantalla no puede derivar ninguno de los otros dos.
 *
 * El 51 —página 3— debe ₡500. Es el que la tanda J midió: un importe que se calculara
 * sobre la página diría que no se debe nada cuando se deben 500.
 */
function fila(i: number): CuentaPorPagarResumenDTO {
  const cuentaPorPagar = i === 51 ? "500.00" : i === 60 ? "0.00" : `${i}.25`;
  return {
    mensajeroId: `m-${String(i).padStart(2, "0")}`,
    mensajeroNombre: nombre(i),
    devengado: `${1000 + i}.75`,
    pagado: `${500 + i}.50`,
    cuentaPorPagar,
    signo: cuentaPorPagar === "0.00" ? "cero" : "positivo",
  };
}

/** Las 60, en el orden alfabético del listado (T L.1, R51). */
const CONJUNTO: CuentaPorPagarResumenDTO[] = Array.from({ length: TOTAL }, (_, k) =>
  fila(k + 1),
);

// --- Andamiaje -----------------------------------------------------------

interface EntradaPagina {
  page?: number;
  pageSize?: number;
  busqueda?: string;
}

/**
 * La búsqueda del SERVIDOR (T L.1), reimplementada aquí: subcadena, sin distinguir mayúsculas
 * y SENSIBLE a acentos. No se importa `filtrarPorBusquedaMensajero` a propósito —es el módulo
 * que la pantalla usa para el archivo— para que el doble no sea lo mismo que se está midiendo.
 */
function filtrarComoElServidor(busqueda: string | undefined): CuentaPorPagarResumenDTO[] {
  const q = (busqueda ?? "").trim().toLowerCase();
  if (q === "") return CONJUNTO;
  return CONJUNTO.filter((m) => m.mensajeroNombre.toLowerCase().includes(q));
}

/**
 * Doble de la Server Action paginada: filtra el conjunto, RECORTA la página pedida y devuelve
 * el `total` del conjunto FILTRADO (no el de la página). Un doble que devolviera siempre la
 * misma lista dejaría pasar una paginación que no navega a ninguna parte.
 */
function servirPaginas() {
  paginadoMock.mockImplementation(async (input: EntradaPagina = {}) => {
    const filtrados = filtrarComoElServidor(input.busqueda);
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? PAGE_SIZE;
    const desde = (page - 1) * pageSize;
    return {
      status: "ok",
      items: filtrados.slice(desde, desde + pageSize),
      page,
      pageSize,
      total: filtrados.length,
    };
  });
}

/**
 * Doble del CONJUNTO sin recorte (T M.1, cierre de Q-L2): `listarCuentasPorPagarCompleto`
 * devuelve las filas que casan la búsqueda —el filtro es del SERVIDOR, igual que en la página—
 * y ya no las 60 para que el navegador descarte las que sobran. Se reusa `filtrarComoElServidor`
 * a propósito: si el archivo y la tabla salieran de dos filtros distintos, aquí no se vería.
 */
function servirConjunto() {
  conjuntoMock.mockImplementation(async (input: { busqueda?: string } = {}) => {
    const items = filtrarComoElServidor(input?.busqueda);
    return { status: "ok", items, total: items.length };
  });
}

/**
 * Doble del desglose por cierre: devuelve el movimiento y el saldo DE ESE mensajero, tomados
 * del conjunto. Si la pantalla pidiera el desglose de otra fila, aquí se vería su dinero.
 */
function servirDesglose() {
  desgloseMock.mockImplementation(async (input: { mensajeroId: string }) => {
    const m = CONJUNTO.find((c) => c.mensajeroId === input.mensajeroId);
    if (!m) return { status: "not_found" as const };
    return {
      status: "ok" as const,
      data: {
        mensajeroId: m.mensajeroId,
        mensajeroNombre: m.mensajeroNombre,
        movimientos: [
          {
            id: `mov-${m.mensajeroId}`,
            mensajeroId: m.mensajeroId,
            tipo: "devengo" as const,
            categoria: "pago_devengado" as const,
            monto: m.devengado,
            origenTipo: "cierre_dia",
            origenId: "c1",
            descripcion: null,
            fechaMovimiento: "2026-07-12T10:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        cuenta: {
          devengado: m.devengado,
          pagado: m.pagado,
          cuentaPorPagar: m.cuentaPorPagar,
          signo: m.signo,
        },
      },
    };
  });
}

/** Monta la pantalla con la página 1 pre-cargada por el Server Component. */
function montar() {
  servirPaginas();
  servirConjunto();
  servirDesglose();
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CuentasPorPagarTable
        initialData={{
          items: CONJUNTO.slice(0, PAGE_SIZE),
          total: TOTAL,
          pageSize: PAGE_SIZE,
        }}
      />
    </SWRConfig>,
  );
}

function tabla(): HTMLElement {
  return screen.getByRole("table", { name: LISTADO });
}

/** El `<nav>` del listado, localizado por rol y nombre accesible (R43). */
function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: PAGINACION });
}

/**
 * El contador de cabecera. Se localiza por ROL y por lo que dice: es el único `status` de la
 * pantalla que habla de mensajeros (el otro posible es el «Cargando» de una tabla).
 */
function contador(): HTMLElement {
  const encontrado = screen
    .getAllByRole("status")
    .find((el) => /mensajeros/.test(el.textContent ?? ""));
  if (encontrado === undefined) throw new Error("no hay contador de cabecera");
  return encontrado;
}

/** Los mensajeros que la tabla está pintando, en orden, por el nombre de su botón de desglose. */
function nombresVisibles(): string[] {
  return within(tabla())
    .queryAllByRole("button", { name: /^Ver desglose de / })
    .map((b) => (b.getAttribute("aria-label") ?? "").replace("Ver desglose de ", ""));
}

async function irAPagina(user: ReturnType<typeof userEvent.setup>, numero: number) {
  await user.click(within(nav()).getByRole("button", { name: `Ir a la página ${numero}` }));
  await waitFor(() =>
    expect(nombresVisibles()[0]).toBe(nombre((numero - 1) * PAGE_SIZE + 1)),
  );
}

/**
 * Escribe en el buscador y espera a que la tabla enseñe el resultado del SERVIDOR. La espera
 * es generosa porque el texto no viaja en cada tecla: la pantalla aguarda a que el usuario
 * deje de escribir (cada lectura de este listado agrega el libro entero de cada mensajero).
 */
async function buscar(user: ReturnType<typeof userEvent.setup>, texto: string) {
  await user.type(screen.getByRole("searchbox", { name: "Buscar por mensajero" }), texto);
  const esperados = filtrarComoElServidor(texto);
  await waitFor(
    () =>
      expect(nombresVisibles()).toEqual(
        esperados.slice(0, PAGE_SIZE).map((m) => m.mensajeroNombre),
      ),
    { timeout: 3000 },
  );
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

describe("Riesgo ALTO · «Cuentas por pagar a mensajeros» (T L.2)", () => {
  it("el usuario ve las mismas filas que antes en el PRIMER pintado (R44)", () => {
    // Sin `await` y a propósito: la página 1 ya viajó en la respuesta del Server Component.
    // Quitar el `fallbackData` de SWR pasó VERDE en la tanda I porque el test esperaba a que
    // la tabla apareciera; con esa espera, un esqueleto seguido de un viaje al servidor por un
    // dato que ya estaba se daba por bueno.
    montar();
    expect(nombresVisibles()).toEqual(
      CONJUNTO.slice(0, PAGE_SIZE).map((m) => m.mensajeroNombre),
    );
    // Y los montos son los del servidor: la fila 1 debe `1.25`, que la feature 230
    // pinta `₡1`. Se añade el devengado de esa misma fila (`1001.75` -> `₡1.002`)
    // porque ahí se ve el acarreo Y la agrupación de miles, que un importe de un
    // solo dígito no puede mostrar.
    expect(within(tabla()).getByText("₡1")).toBeInTheDocument();
    expect(within(tabla()).getByText("₡1.002")).toBeInTheDocument();
  });

  it("navega entre páginas (R43)", async () => {
    const user = userEvent.setup();
    montar();

    // El control existe y se ENCUENTRA por rol y nombre accesible.
    expect(nav()).toBeInTheDocument();
    expect(nombresVisibles()).toHaveLength(PAGE_SIZE);
    expect(nombresVisibles()[0]).toBe(nombre(1));

    await user.click(within(nav()).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(nombresVisibles()[0]).toBe(nombre(26)));
    expect(nombresVisibles()).toHaveLength(PAGE_SIZE);
    // Y las de la página anterior YA NO están: navegar cambia las filas de verdad.
    expect(
      within(tabla()).queryByRole("button", { name: `Ver desglose de ${nombre(1)}` }),
    ).toBeNull();

    // Última página: 10 filas de un conjunto de 60.
    await user.click(within(nav()).getByRole("button", { name: "Última página" }));
    await waitFor(() => expect(nombresVisibles()[0]).toBe(nombre(51)));
    expect(nombresVisibles()).toHaveLength(ULTIMA_PAGINA);

    // R42: el contador dice el TOTAL del servidor, no el tamaño de la página. En la última
    // página es donde un contador derivado del array se delata sin ambigüedad.
    expect(contador()).toHaveTextContent(`${TOTAL} mensajeros`);
    expect(contador()).not.toHaveTextContent(`${ULTIMA_PAGINA} mensajeros`);

    await user.click(within(nav()).getByRole("button", { name: "Primera página" }));
    await waitFor(() => expect(nombresVisibles()[0]).toBe(nombre(1)));
  });

  it("expandir el desglose funciona en cualquier página (R50)", async () => {
    const user = userEvent.setup();
    montar();

    // Se hace en la PÁGINA 3, no en la 1: es donde un desglose resuelto contra las filas que
    // llegaron por props abriría la cuenta de otra persona sin fallar en ninguna parte.
    await irAPagina(user, 3);
    const elegido = CONJUNTO[50]; // el 51: debe ₡500
    expect(nombresVisibles()).toContain(elegido.mensajeroNombre);

    await user.click(
      screen.getByRole("button", { name: `Ver desglose de ${elegido.mensajeroNombre}` }),
    );

    // El panel que se abre es el de ESA fila: lo dice su nombre accesible…
    const desglose = await screen.findByRole("region", {
      name: `Desglose de ${elegido.mensajeroNombre}`,
    });
    // …y el desglose se pidió al servidor para ESE mensajero, no para el que ocupaba esa
    // posición en la página 1.
    await waitFor(() => expect(desgloseMock).toHaveBeenCalledTimes(1));
    expect(desgloseMock).toHaveBeenCalledWith({
      mensajeroId: elegido.mensajeroId,
      page: 1,
      pageSize: 20,
    });
    expect(desgloseMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ mensajeroId: CONJUNTO[0].mensajeroId }),
    );

    // Y el dinero que enseña es el del LIBRO ENTERO de ese mensajero (₡500 pendientes),
    // el mismo que su fila: cambiar de página no lo recalcula (R49/R50).
    expect(within(desglose).getByText("₡500")).toBeInTheDocument();
    // `pagado` solo aparece en el saldo del panel (el movimiento del doble es un devengo),
    // así que este es el monto que distingue a un mensajero de otro sin ambigüedad.
    expect(within(desglose).getByText(money(elegido.pagado))).toBeInTheDocument();

    // Ninguna otra fila quedó desplegada de paso.
    expect(screen.getAllByRole("region", { name: /^Desglose de / })).toHaveLength(1);

    // El control de paginación del desglose tiene nombre PROPIO: dos `<nav>` llamados
    // «Paginación» a secas no distinguirían el listado de la fila abierta.
    expect(
      screen.getByRole("navigation", {
        name: `Paginación del desglose de ${elegido.mensajeroNombre}`,
      }),
    ).toBeInTheDocument();
    expect(nav()).toBeInTheDocument();
  });

  it("expandir en la página 1 no arrastra el desglose a las demás (R50)", async () => {
    const user = userEvent.setup();
    montar();

    const primero = CONJUNTO[0];
    await user.click(
      screen.getByRole("button", { name: `Ver desglose de ${primero.mensajeroNombre}` }),
    );
    await screen.findByRole("region", { name: `Desglose de ${primero.mensajeroNombre}` });

    // En la página 2, esa fila no está: su desglose tampoco puede estarlo.
    await irAPagina(user, 2);
    expect(screen.queryAllByRole("region", { name: /^Desglose de / })).toHaveLength(0);

    // Y el de una fila de ESTA página se abre igual de bien.
    const otro = CONJUNTO[25]; // el 26
    await user.click(
      screen.getByRole("button", { name: `Ver desglose de ${otro.mensajeroNombre}` }),
    );
    const abierto = await screen.findByRole("region", {
      name: `Desglose de ${otro.mensajeroNombre}`,
    });
    expect(within(abierto).getByText(money(otro.cuentaPorPagar))).toBeInTheDocument();
  });

  it("cambiar de página no toca lo escrito en el buscador ni los importes de la fila (R50)", async () => {
    const user = userEvent.setup();
    montar();

    // «Solís» son los mensajeros 31-60: TREINTA filas, o sea dos páginas del conjunto
    // filtrado. Hace falta que sean dos de verdad: con una sola, «Página siguiente» estaría
    // deshabilitado y este caso no probaría nada (medido — la mutación 10 pasó verde así).
    await buscar(user, "Solís");
    const buscador = screen.getByRole("searchbox", {
      name: "Buscar por mensajero",
    }) as HTMLInputElement;
    expect(buscador.value).toBe("Solís");
    expect(contador()).toHaveTextContent(`${FILAS_POR_APELLIDO} de ${TOTAL} mensajeros`);
    expect(nombresVisibles()).toHaveLength(PAGE_SIZE);
    // El importe de la fila 51 es el de su libro entero: ₡500 pendientes.
    expect(within(tabla()).getByText("₡500")).toBeInTheDocument();

    await user.click(within(nav()).getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(nombresVisibles()[0]).toBe(nombre(56)));

    // La búsqueda sigue escrita y APLICADA: paginar no la borra ni la reinterpreta. Si se
    // borrara, esta segunda página traería a los «Rojas» de vuelta sin que nadie lo pidiera.
    expect(buscador.value).toBe("Solís");
    expect(nombresVisibles()).toEqual(
      CONJUNTO.slice(55, 60).map((m) => m.mensajeroNombre),
    );
    expect(contador()).toHaveTextContent(`${FILAS_POR_APELLIDO} de ${TOTAL} mensajeros`);
    // Y los importes siguen siendo los STRING del servidor, fila a fila.
    expect(within(tabla()).getByText(money(CONJUNTO[55].cuentaPorPagar))).toBeInTheDocument();
    expect(within(tabla()).getByText(money(CONJUNTO[55].devengado))).toBeInTheDocument();
  });

  it("la búsqueda mira el CONJUNTO y devuelve a la página 1 (R45)", async () => {
    const user = userEvent.setup();
    montar();

    // Se busca desde la PÁGINA 3, que es donde una búsqueda de cliente se delata: en esas
    // diez filas no hay ni un «Rojas».
    await irAPagina(user, 3);
    expect(nombresVisibles().some((n) => n.includes("Rojas"))).toBe(false);

    await buscar(user, "Rojas");

    // Vuelve a la página 1 del conjunto filtrado: sin eso, la tabla se quedaría vacía junto a
    // un contador que dice que hay treinta resultados.
    expect(nombresVisibles()[0]).toBe(nombre(1));
    expect(nombresVisibles()).toHaveLength(PAGE_SIZE);
    expect(contador()).toHaveTextContent(`${FILAS_POR_APELLIDO} de ${TOTAL} mensajeros`);
    expect(within(nav()).getByRole("button", { name: "Ir a la página 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Y el texto llegó al servidor TAL CUAL, sin recortar ni pasar a minúsculas.
    const conBusqueda = paginadoMock.mock.calls
      .map(([input]) => input as EntradaPagina)
      .filter((input) => (input?.busqueda ?? "") !== "");
    expect(conBusqueda.at(-1)?.busqueda).toBe("Rojas");
    expect(conBusqueda.at(-1)?.page).toBe(1);
  });

  it("la descarga sigue entregando el dataset completo (R52)", async () => {
    const user = userEvent.setup();
    montar();

    // Se descarga desde la PÁGINA 3, que trae DIEZ filas: si el archivo saliera de lo que la
    // tabla pinta, tendría diez y nadie lo notaría hasta liquidar de menos.
    await irAPagina(user, 3);
    expect(nombresVisibles()).toHaveLength(ULTIMA_PAGINA);

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(titulo).toBe(LISTADO);
    expect(filas).toHaveLength(TOTAL);
    expect(filas.map((f) => f.mensajero)).toEqual(CONJUNTO.map((m) => m.mensajeroNombre));
    // Money-safe: los montos van como los devolvió el servidor, sin símbolo y sin recalcular.
    expect(filas[50].cuentaPorPagar).toBe("500.00");
    expect(String(filas[50].cuentaPorPagar)).not.toContain("₡");
  });

  it("la descarga con búsqueda entrega el conjunto filtrado, no la página (R52)", async () => {
    const user = userEvent.setup();
    montar();

    // Con «Solís» quedan TREINTA (31-60) y la tabla enseña veinticinco: los tres números que
    // el archivo podría traer son distintos, así que ninguna de las dos trampas cuela. La de
    // este caso es la contraria a la del anterior: descargar el conjunto SIN filtrar daría 60
    // filas, o sea datos que el usuario no está viendo.
    await buscar(user, "Solís");
    expect(nombresVisibles()).toHaveLength(PAGE_SIZE);

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(FILAS_POR_APELLIDO);
    expect(filas.map((f) => f.mensajero)).toEqual(
      CONJUNTO.slice(30, 60).map((m) => m.mensajeroNombre),
    );
    expect(filas.map((f) => f.mensajero)).not.toContain(nombre(1));
  });
});
