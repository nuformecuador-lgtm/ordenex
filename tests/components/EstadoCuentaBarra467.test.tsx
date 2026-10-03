// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { UUID_BODEGA, UUID_MENSAJERO, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import {
  alternarCasillas,
  casillasOfrecidas,
  elegirEnBarra,
  opcionesDelControl,
  ponerCasillas,
  textoDelControl,
} from "@/tests/fixtures/barra-libro-wallet";
import { elegirSoloLosMovimientos } from "@/tests/fixtures/descarga-detalle-por-orden";

const H = vi.hoisted(() => ({
  ver: vi.fn(),
  completo: vi.fn(),
  verMi: vi.fn(),
  completoMi: vi.fn(),
  cierres: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => H.ver(...a),
  // Ficha 468: la descarga lee el KARDEX.
  estadoCuentaKardexAction: (...a: unknown[]) => H.completo(...a),
  verMiEstadoCuentaAction: (...a: unknown[]) => H.verMi(...a),
  miEstadoCuentaKardexAction: (...a: unknown[]) => H.completoMi(...a),
  estadoCuentaKardexConDetalleAction: vi.fn(),
  miEstadoCuentaKardexConDetalleAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-filtros", () => ({
  cierresDeLaCuentaAction: (...a: unknown[]) => H.cierres(...a),
  conceptosConMovimientosAction: vi.fn(),
}));
vi.mock("@/lib/actions/conciliacion-satelites", () => ({
  listarConsolidacionesSateliteAction: vi.fn(async () => ({ status: "ok", items: [], total: 0, page: 1, pageSize: 25 })),
  listarConsolidacionesSateliteCompletoAction: vi.fn(),
  marcarConsolidacionRecibidaAction: vi.fn(),
  revertirConciliacionAction: vi.fn(),
}));
vi.mock("@/lib/actions/liquidacion", () => ({
  listarPagosDeTiendaAction: vi.fn(async () => ({ status: "ok", pagos: [] })),
  anularPagoAction: vi.fn(),
  previsualizarRepartoMensajeroAction: vi.fn(async () => ({ status: "forbidden" })),
  registrarRepartoMensajeroAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet", () => ({
  verDetalleDeMovimientoAction: vi.fn(),
  verDetalleDeMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { EstadoCuentaSatelite } from "@/app/(app)/wallet/satelites/_components/EstadoCuentaSatelite";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import type { CierresDeLaTienda } from "@/app/(app)/mi-wallet/_components/mi-wallet-cierres";

const CIERRE_CON_MOVIMIENTOS = {
  cierreId: "5e1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b",
  dia: "2026-09-12",
  hora: "18:00",
  mensajero: "Juan Pérez Mora",
  movimientos: 3,
};

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

// =================================================================================================
// FICHA 467 (T6) — LA BARRA ÚNICA DEL ESTADO DE CUENTA, IGUAL QUE LA DE `/ordenes`
// =================================================================================================
//
// El lector está doblado (acciones de `estado-cuenta`). Se mide lo que la 467 cambia en el componente
// compartido que montan las cuatro superficies: una barra (R1–R4), sus casillas por superficie (R7) y
// su orden (R9), qué relee cada filtro (R10, R14, R15), las opciones del Tipo de movimiento (R21), el
// Cierre de `/mi-wallet` con sus avisos (R22), el nombre dentro del disparador (R23), el buscador
// (R24), «Limpiar todo» (R25, R26), el fallo (R27, R28), las lecturas en vuelo (R29), la URL (R30), la
// descarga (R31) y la entrada sin tocar nada (R35). Los literales de contrato van escritos a mano.

const barra = () => document.body;
const buscador = () => screen.getByRole("searchbox", { name: "Buscar en el libro" });
const tarjetas = (nombre = "Tania Tienda") => screen.getByRole("region", { name: `Saldo de ${nombre}` });
const tablaDe = (nombre = "Tania Tienda") => screen.getByRole("table", { name: `Estado de cuenta de ${nombre}` });
function filasDeLaTabla(nombre = "Tania Tienda") {
  return within(tablaDe(nombre)).getAllByRole("row").slice(1);
}
const periodoBoton = () => screen.queryByRole("button", { name: "Periodo" });
const cierreBoton = () => screen.queryByRole("button", { name: /^Cierre: / });

function antes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const TRES = [
  fila({ n: 3, fecha: "2026-09-13", abono: "30.00", saldoCorrido: "60.00" }),
  fila({ n: 2, fecha: "2026-09-12", abono: "20.00", saldoCorrido: "30.00" }),
  fila({ n: 1, fecha: "2026-09-11", abono: "10.00", saldoCorrido: "10.00" }),
];

/** La tienda de la oficina (con su selector de cierre). */
function montarTienda(inicial = estado({ filas: TRES, total: 3 })) {
  return envolver(<EstadoCuentaTienda inicial={inicial} puedeRegistrar={false} />);
}

const SUPERFICIES: { nombre: string; cuenta: string; casillas: string[]; montar: () => void }[] = [
  {
    nombre: "tienda",
    cuenta: "Tania Tienda",
    casillas: ["Periodo", "Tipo de movimiento", "Cierre"],
    montar: () => envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />),
  },
  {
    nombre: "mensajero",
    cuenta: "Mario Mensajero",
    casillas: ["Periodo", "Tipo de movimiento", "Cierre"],
    montar: () =>
      envolver(
        <EstadoCuentaMensajero
          inicial={estado({ tipo: "mensajero", id: UUID_MENSAJERO, nombre: "Mario Mensajero", filas: [], total: 0 })}
          puedeRegistrar={false}
        />,
      ),
  },
  {
    nombre: "bodega satélite",
    cuenta: "Bodega Norte",
    casillas: ["Periodo", "Tipo de movimiento"],
    montar: () =>
      envolver(
        <EstadoCuentaSatelite
          inicial={estado({ tipo: "bodega", id: UUID_BODEGA, nombre: "Bodega Norte", filas: [], total: 0 })}
          puedeConciliar={false}
        />,
      ),
  },
  {
    nombre: "/mi-wallet",
    cuenta: "Tania Tienda",
    casillas: ["Periodo", "Tipo de movimiento", "Cierre"],
    montar: () =>
      envolver(<MiEstadoCuenta inicial={estado({ filas: TRES, total: 3 })} cierres={{ opciones: [], hayMas: false, disponible: true }} />),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  H.ver.mockImplementation(async () => ({ status: "ok", estado: estado({ filas: TRES, total: 3 }) }));
  H.verMi.mockImplementation(async () => ({ status: "ok", estado: estado({ filas: TRES, total: 3 }) }));
  H.cierres.mockResolvedValue({ status: "ok", opciones: [CIERRE_CON_MOVIMIENTOS], hayMas: false });
});

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R1/R3/R7/R11 — las cuatro superficies: una barra, sus casillas, nada antes de las tarjetas", () => {
  it.each(SUPERFICIES)("$nombre", async ({ cuenta, casillas, montar }) => {
    const user = userEvent.setup();
    montar();
    // R1 — ningún control de filtro antes de las tarjetas; la barra va después y antes de la tabla.
    expect(screen.queryByRole("region", { name: "Filtros de toda la wallet" })).toBeNull();
    const filtros = screen.getByRole("button", { name: /^Filtros/ });
    expect(antes(tarjetas(cuenta), filtros)).toBe(true);
    expect(antes(filtros, tablaDe(cuenta))).toBe(true);
    expect(within(tarjetas(cuenta)).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    // R7 — las casillas de ESTA superficie, en su orden; R11 — todas desmarcadas al entrar.
    const { etiquetas, marcadas } = await casillasOfrecidas(user, barra());
    expect(etiquetas).toEqual(casillas);
    expect(marcadas).toEqual([]);
    // R3 — ni alcance ni «Aplicar», tampoco con todas las casillas puestas.
    await ponerCasillas(user, barra(), ...casillas);
    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain("Estos filtros cambian toda la wallet");
    expect(texto).not.toContain("Estos filtros solo afectan al libro de movimientos");
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar periodo" })).toBeNull();
    // Sin chips sueltos: el conmutador de la 458 ya no está.
    expect(screen.queryByRole("group", { name: `Filtrar el estado de cuenta de ${cuenta}` })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R2/R4/R9/R23 — la fila", () => {
  it("R2/R9: orden → Periodo → Tipo de movimiento → Cierre → buscador → Filtros → Limpiar todo; Descargar y columnas detrás", async () => {
    const user = userEvent.setup();
    montarTienda();
    await alternarCasillas(user, barra(), "Cierre", "Tipo de movimiento", "Periodo");
    const piezas = [
      screen.getByRole("group", { name: "Ordenar el libro" }),
      periodoBoton() as HTMLElement,
      screen.getByRole("combobox", { name: "Tipo de movimiento" }),
      cierreBoton() as HTMLElement,
      buscador(),
      screen.getByRole("button", { name: /^Filtros/ }),
      screen.getByRole("button", { name: "Limpiar todo" }),
    ];
    for (let i = 1; i < piezas.length; i++) expect(antes(piezas[i - 1], piezas[i])).toBe(true);

    const descargar = screen.getByRole("button", { name: "Descargar Estado de cuenta de Tania Tienda" });
    let contenedor: HTMLElement = buscador();
    while (contenedor.parentElement !== null && !contenedor.parentElement.contains(descargar)) contenedor = contenedor.parentElement;
    const fila = contenedor.parentElement as HTMLElement;
    expect(contenedor.contains(descargar)).toBe(false);
    expect(antes(contenedor, descargar)).toBe(true);
    expect(antes(descargar, within(fila).getByRole("button", { name: /columnas/i }))).toBe(true);
  });

  it("R4: el orden son dos botones de SOLO icono con su nombre accesible", () => {
    montarTienda();
    const orden = screen.getByRole("group", { name: "Ordenar el libro" });
    const botones = within(orden).getAllByRole("button");
    expect(botones.map((b) => b.getAttribute("aria-label"))).toEqual(["Más recientes", "Más antiguas"]);
    for (const b of botones) {
      expect(b.textContent?.trim()).toBe("");
      expect(b.querySelector("svg")).not.toBeNull();
    }
    expect(within(orden).getByRole("button", { name: "Más recientes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("R23: cada control dice su nombre dentro del disparador, a la altura del buscador", async () => {
    const user = userEvent.setup();
    montarTienda();
    await ponerCasillas(user, barra(), "Periodo", "Tipo de movimiento", "Cierre");
    expect(textoDelControl(barra(), "Tipo de movimiento")).toBe("Tipo de movimiento: Todo");
    expect(cierreBoton()).toHaveTextContent(/^Cierre: Todos los cierres$/);
    const alto = (el: Element) => el.className.split(/\s+/).includes("h-8");
    expect(alto(screen.getByRole("combobox", { name: "Tipo de movimiento" }))).toBe(true);
    expect(alto(cierreBoton() as HTMLElement)).toBe(true);
    expect(alto(buscador().parentElement as HTMLElement)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R21 — las opciones del Tipo de movimiento: los chips de ese tipo de cuenta, sin «Todo»", () => {
  it.each([
    ["tienda", 0, ["Cierres", "Pagos", "Cobros", "Correcciones"]],
    ["mensajero", 1, ["Cierres", "Pagos", "Premios", "Correcciones"]],
    ["bodega", 2, ["Declarado", "Recibido"]],
  ] as const)("%s", async (_t, i, esperadas) => {
    SUPERFICIES[i].montar();
    expect(await opcionesDelControl(userEvent.setup(), barra(), "Tipo de movimiento")).toEqual([...esperadas]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R8/R10/R14/R15 — qué relee cada filtro", () => {
  it("R8: marcar las casillas no lee nada", async () => {
    const user = userEvent.setup();
    montarTienda();
    await ponerCasillas(user, barra(), "Periodo", "Tipo de movimiento", "Cierre");
    await new Promise((r) => setTimeout(r, 700));
    expect(H.ver).not.toHaveBeenCalled();
    expect(H.cierres).not.toHaveBeenCalled();
  });

  it("R14: el periodo relee tarjetas y extracto, página 1", async () => {
    const user = userEvent.setup();
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: TRES, total: 3, saldoInicial: "777.00" }) });
    montarTienda();
    await aplicarPeriodo(user, barra(), 1, 28);
    await waitFor(() => expect(H.ver).toHaveBeenCalledTimes(1));
    expect(H.ver).toHaveBeenCalledWith({
      cuenta: { tipo: "tienda", id: UUID_TIENDA },
      desde: diaDelMesActual(1),
      hasta: diaDelMesActual(28),
      page: 1,
      pageSize: 20,
    });
    await waitFor(() => expect(tarjetas().textContent).toContain("Saldo inicial₡777"));
  });

  it("R15: tipo, cierre, término y orden no cambian las tarjetas y piden la página 1", async () => {
    const user = userEvent.setup();
    const muchas = Array.from({ length: 20 }, (_, i) => fila({ n: i + 1 }));
    montarTienda(estado({ filas: muchas, total: 45, saldoInicial: "5.00", abonos: "60.00" }));
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: muchas, total: 45, saldoInicial: "5.00", abonos: "60.00" }) });
    const antesTarjetas = tarjetas().textContent;
    const siguiente = () =>
      user.click(within(screen.getByRole("navigation", { name: "Paginación del estado de cuenta de Tania Tienda" })).getByRole("button", { name: /siguiente/i }));

    await siguiente();
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    await elegirEnBarra(user, barra(), "Tipo de movimiento", "Cobros");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ chip: "cobros", page: 1 })));

    await siguiente();
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ chip: "cobros", page: 2 })));
    await ponerCasillas(user, barra(), "Cierre");
    await user.click(cierreBoton() as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ cierreId: CIERRE_CON_MOVIMIENTOS.cierreId, page: 1 })),
    );

    await siguiente();
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc", page: 1 })));

    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas", page: 1 })), { timeout: 3000 });
    expect(tarjetas().textContent).toBe(antesTarjetas);
  });

  it("R10: desmarcar el Tipo de movimiento con valor lo quita, en UNA lectura", async () => {
    const user = userEvent.setup();
    montarTienda();
    await elegirEnBarra(user, barra(), "Tipo de movimiento", "Pagos");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ chip: "pagos" })));
    // Una clave que no esté en caché: primero «Más antiguas».
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ chip: "pagos", sortDir: "asc" })));
    H.ver.mockClear();

    await alternarCasillas(user, barra(), "Tipo de movimiento");
    await waitFor(() => expect(H.ver).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 700));
    expect(H.ver).toHaveBeenCalledTimes(1);
    expect(H.ver).toHaveBeenCalledWith({ cuenta: { tipo: "tienda", id: UUID_TIENDA }, sortBy: "fecha", sortDir: "asc", page: 1, pageSize: 20 });
  });

  it("R10: desmarcar el Periodo y el Cierre con valor los quita", async () => {
    const user = userEvent.setup();
    montarTienda();
    // Primero el cierre y después el periodo: así «solo el periodo» es una clave que nunca se pidió.
    await ponerCasillas(user, barra(), "Cierre");
    await user.click(cierreBoton() as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ cierreId: CIERRE_CON_MOVIMIENTOS.cierreId })));
    await aplicarPeriodo(user, barra(), 1, 28);
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith(
        expect.objectContaining({ desde: diaDelMesActual(1), cierreId: CIERRE_CON_MOVIMIENTOS.cierreId }),
      ),
    );

    await alternarCasillas(user, barra(), "Cierre");
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        desde: diaDelMesActual(1),
        hasta: diaDelMesActual(28),
        page: 1,
        pageSize: 20,
      }),
    );
    H.ver.mockClear();
    await alternarCasillas(user, barra(), "Periodo");
    // Sin filtros es la lectura inicial: la sirve la caché (o, si se pide, va sin periodo).
    await new Promise((r) => setTimeout(r, 700));
    for (const [input] of H.ver.mock.calls) expect(input).not.toHaveProperty("desde");
    await waitFor(() => expect(periodoBoton()).toBeNull());
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R22 — el Cierre de `/mi-wallet` conserva sus opciones y sus avisos", () => {
  function montarMi(cierres: CierresDeLaTienda) {
    return envolver(<MiEstadoCuenta inicial={estado({ filas: TRES, total: 3 })} cierres={cierres} />);
  }

  it.each([
    [{ opciones: [], hayMas: false, disponible: false }, "No pudimos cargar tus cierres. Probá recargando la página.", true],
    [{ opciones: [], hayMas: false, disponible: true }, "Todavía no hay cierres en tu wallet.", true],
    [
      { opciones: [{ cierreId: CIERRE_CON_MOVIMIENTOS.cierreId, fecha: "2026-09-12T18:00:00.000Z", movimientos: 3 }], hayMas: true, disponible: true },
      "Mostramos los cierres más recientes.",
      false,
    ],
  ] as [CierresDeLaTienda, string, boolean][])("aviso n.º %#: «%s»", async (cierres, aviso, deshabilitado) => {
    const user = userEvent.setup();
    montarMi(cierres);
    expect(screen.queryByText(aviso)).toBeNull(); // sin la casilla, ni control ni aviso
    await ponerCasillas(user, barra(), "Cierre");
    expect(screen.getByText(aviso)).toBeInTheDocument();
    const selector = screen.getByRole("combobox", { name: "Filtrar por cierre" });
    expect(selector).toHaveTextContent("Cierre: Todos los cierres");
    if (deshabilitado) expect(selector).toBeDisabled();
    else expect(selector).not.toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R24 — el buscador compartido", () => {
  it("avisa de los caracteres que faltan, no lee con menos de 3 y busca con el placeholder de la superficie", async () => {
    const user = userEvent.setup();
    montarTienda();
    // FICHA 469 (R24): la oficina nombra también la guía y la remisión.
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por guía, remisión, descripción o quién registró");
    await user.type(buscador(), "et");
    expect(await screen.findByText("Escribe al menos 3 caracteres para buscar")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(H.ver).not.toHaveBeenCalled();
    await user.type(buscador(), "i");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "eti" })), { timeout: 3000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R25/R26 — «Limpiar todo»", () => {
  it("R26: no aparece sin texto ni casillas; aparece con una casilla aunque esté vacía", async () => {
    const user = userEvent.setup();
    montarTienda();
    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();
    await ponerCasillas(user, barra(), "Tipo de movimiento");
    expect(screen.getByRole("button", { name: "Limpiar todo" })).toBeInTheDocument();
  });

  it("R25: vacía término, periodo, tipo y cierre, desmarca las casillas y conserva el orden", async () => {
    const user = userEvent.setup();
    montarTienda();
    await aplicarPeriodo(user, barra(), 1, 28);
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ desde: diaDelMesActual(1) })));
    await elegirEnBarra(user, barra(), "Tipo de movimiento", "Cobros");
    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas" })), { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc" })));

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        sortBy: "fecha",
        sortDir: "asc",
        page: 1,
        pageSize: 20,
      }),
    );
    expect(buscador()).toHaveValue("");
    expect(screen.getByRole("button", { name: "Más antiguas" })).toHaveAttribute("aria-pressed", "true");
    expect((await casillasOfrecidas(user, barra())).marcadas).toEqual([]);
    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
const AVISO = /^No se pudo cargar el estado de cuenta\. Se sigue mostrando lo último que se cargó, con sus filtros\.$/;

describe("467 R27/R28 — lo que filtra se ve, también tras un fallo", () => {
  it("desmarcar el Tipo de movimiento con valor y que falle: vuelve la casilla con su valor; tarjetas y libro intactos", async () => {
    const user = userEvent.setup();
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00" }));
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: [TRES[0]], total: 1, saldoInicial: "5.00" }) });
    await elegirEnBarra(user, barra(), "Tipo de movimiento", "Cobros");
    await waitFor(() => {
      expect(within(tablaDe()).queryByRole("status")).toBeNull();
      expect(filasDeLaTabla()).toHaveLength(2);
    });
    // Una lectura buena que no es la de entrada (para que quitar el chip no la sirva la caché).
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ chip: "cobros", sortDir: "asc" })));
    await waitFor(() => expect(within(tablaDe()).queryByRole("status")).toBeNull());
    const filasBuenas = filasDeLaTabla().map((f) => f.textContent);
    const tarjetasBuenas = tarjetas().textContent;

    H.ver.mockResolvedValue({ status: "forbidden" });
    await alternarCasillas(user, barra(), "Tipo de movimiento");
    await screen.findByText(AVISO);
    await waitFor(() => expect(textoDelControl(barra(), "Tipo de movimiento")).toBe("Tipo de movimiento: Cobros"));
    expect((await casillasOfrecidas(user, barra())).marcadas).toEqual(["Tipo de movimiento"]);
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasBuenas);
    expect(tarjetas().textContent).toBe(tarjetasBuenas);
  });

  it("un cierre que LANZA: aviso, el control vuelve a «Todos los cierres» y el libro sigue", async () => {
    const user = userEvent.setup();
    montarTienda();
    const filasAntes = filasDeLaTabla().map((f) => f.textContent);
    H.ver.mockRejectedValue(new Error("Failed to fetch"));
    await ponerCasillas(user, barra(), "Cierre");
    await user.click(cierreBoton() as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await screen.findByText(AVISO);
    await waitFor(() => expect(cierreBoton()).toHaveTextContent(/^Cierre: Todos los cierres$/));
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R29 — mientras se lee, nada se deshabilita y solo pinta lo último pedido", () => {
  it("dos cambios seguidos: se pinta el segundo; ningún control deshabilitado", async () => {
    const pendientes: Array<{ input: Record<string, unknown>; soltar: (v: unknown) => void }> = [];
    H.ver.mockImplementation((input: Record<string, unknown>) => new Promise((r) => pendientes.push({ input, soltar: r })));
    const user = userEvent.setup();
    montarTienda();
    await ponerCasillas(user, barra(), "Periodo", "Tipo de movimiento", "Cierre");
    await elegirEnBarra(user, barra(), "Tipo de movimiento", "Cobros");
    await waitFor(() => expect(pendientes).toHaveLength(1));
    for (const control of [
      buscador(),
      periodoBoton() as HTMLElement,
      screen.getByRole("combobox", { name: "Tipo de movimiento" }),
      cierreBoton() as HTMLElement,
      screen.getByRole("button", { name: /^Filtros/ }),
      screen.getByRole("button", { name: "Más antiguas" }),
      screen.getByRole("button", { name: "Limpiar todo" }),
    ]) {
      expect(control).toBeEnabled();
      expect(control).not.toHaveAttribute("data-disabled");
    }
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(pendientes).toHaveLength(2));
    // Llega antes la segunda y después la primera, ya vieja: se pinta la segunda.
    pendientes[1].soltar({ status: "ok", estado: estado({ filas: [TRES[2]], total: 1 }) });
    pendientes[0].soltar({ status: "ok", estado: estado({ filas: TRES, total: 3 }) });
    await waitFor(() => {
      expect(filasDeLaTabla()).toHaveLength(2);
      expect(filasDeLaTabla()[1].textContent).toContain("2026-09-11");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R30/R31/R35 — URL, descarga y entrada", () => {
  it("R30/R35: sin tocar la barra, ni se lee la URL ni el servidor; tarjetas y página 1 son las de entrada", async () => {
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00" }));
    expect(tarjetas().textContent).toContain("Saldo inicial₡5");
    expect(filasDeLaTabla()).toHaveLength(4);
    expect(filasDeLaTabla()[0].textContent).toContain("2026-09-13");
    expect(buscador()).toHaveValue("");
    await new Promise((r) => setTimeout(r, 700));
    expect(H.ver).not.toHaveBeenCalled();
  });

  it("R31: la descarga lleva periodo, tipo, cierre, término y orden vigentes", async () => {
    const user = userEvent.setup();
    H.completo.mockResolvedValue({ status: "ok", estado: estado({ filas: TRES, total: 3 }) });
    montarTienda();
    await aplicarPeriodo(user, barra(), 1, 28);
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ desde: diaDelMesActual(1) })));
    await elegirEnBarra(user, barra(), "Tipo de movimiento", "Cobros");
    await ponerCasillas(user, barra(), "Cierre");
    await user.click(cierreBoton() as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas", cierreId: CIERRE_CON_MOVIMIENTOS.cierreId })), { timeout: 3000 });

    // La tienda ofrece la hoja con detalle (464); esta prueba mide la descarga de SIEMPRE.
    await elegirSoloLosMovimientos(user);
    await user.click(screen.getByRole("button", { name: "Descargar Estado de cuenta de Tania Tienda" }));
    await waitFor(() =>
      expect(H.completo).toHaveBeenCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        desde: diaDelMesActual(1),
        hasta: diaDelMesActual(28),
        chip: "cobros",
        cierreId: CIERRE_CON_MOVIMIENTOS.cierreId,
        q: "etiquetas",
        sortBy: "fecha",
        sortDir: "asc",
      }),
    );
  });
});
