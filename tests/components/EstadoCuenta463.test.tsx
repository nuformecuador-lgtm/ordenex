// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { UUID_MOV, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import { alternarCasillas, elegirEnBarra, textoDelControl } from "@/tests/fixtures/barra-libro-wallet";

// =================================================================================================
// FICHA 463 (T8) — EL ESTADO DE CUENTA CON BUSCADOR Y ORDEN (467: en la barra única)
// =================================================================================================
//
// Las cuatro superficies (tienda, mensajero, bodega satélite y `/mi-wallet`) montan el MISMO módulo:
//  - el periodo mueve tarjetas y extracto (R10, R16);
//  - buscador canónico, orden y chips releen solo el extracto (R11, R23, R24, R29, R33–R35);
//  - el saldo inicial donde cae en el tiempo según el orden (R38/R39), en pantalla y en el Excel (R43);
//  - el término y el orden en la clave de caché (R41); las tarjetas no se mueven por el libro (R11).
// Los literales de contrato (orden, avisos) se escriben A MANO.
// =================================================================================================

const H = vi.hoisted(() => ({
  ver: vi.fn(),
  completo: vi.fn(),
  verMi: vi.fn(),
  completoMi: vi.fn(),
  cierres: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => H.ver(...a),
  verEstadoCuentaCompletoAction: (...a: unknown[]) => H.completo(...a),
  verMiEstadoCuentaAction: (...a: unknown[]) => H.verMi(...a),
  verMiEstadoCuentaCompletoAction: (...a: unknown[]) => H.completoMi(...a),
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

import {
  EstadoCuenta,
  filasDelPeriodo,
  filtrosDeLectura,
  lectorDeLaCuenta,
  posicionSaldoInicial,
} from "@/components/shared/estado-cuenta/EstadoCuenta";
import { claveEstadoCuenta, esClaveDeLaCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-clave";
import { EstadoCuentaTienda, ROTULOS_TIENDA, PANEL_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";

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

// FICHA 467 — las dos zonas son ahora UNA barra encima del extracto: los filtros se piden en «Filtros».
// Los contratos de la 463 que siguen vigentes se miden aquí con el localizador nuevo; los que la 467
// cambió a propósito —las dos zonas con su alcance (R1/R2/R4/R6/R7 de la 463), «Aplicar»/«Quitar
// periodo» (R15/R17/R19) y el «Limpiar todo» que conservaba el periodo (R30)— se retiraron de aquí: su
// sustituto vive en `EstadoCuentaBarra467.test.tsx`.
const zonaLibro = () => document.body;
const zonaWallet = zonaLibro;
const buscador = () => screen.getByRole("searchbox", { name: "Buscar en el libro" });
const tarjetas = (nombre = "Tania Tienda") => screen.getByRole("region", { name: `Saldo de ${nombre}` });
function filasDeLaTabla(nombre = "Tania Tienda") {
  return within(screen.getByRole("table", { name: `Estado de cuenta de ${nombre}` })).getAllByRole("row").slice(1);
}

/** Elige un chip en la casilla «Tipo de movimiento» (la marca si hace falta). */
async function chip(user: ReturnType<typeof userEvent.setup>, nombre: string) {
  await elegirEnBarra(user, zonaLibro(), "Tipo de movimiento", nombre);
}
const textoChip = () => textoDelControl(zonaLibro(), "Tipo de movimiento");

const TRES = [
  fila({ n: 3, fecha: "2026-09-13", abono: "30.00", saldoCorrido: "60.00" }),
  fila({ n: 2, fecha: "2026-09-12", abono: "20.00", saldoCorrido: "30.00" }),
  fila({ n: 1, fecha: "2026-09-11", abono: "10.00", saldoCorrido: "10.00" }),
];

function montarTienda(inicial = estado({ filas: TRES, total: 3 })) {
  return envolver(<EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={inicial} rotulos={ROTULOS_TIENDA} panel={PANEL_TIENDA} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  H.ver.mockImplementation(async () => ({ status: "ok", estado: estado({ filas: TRES, total: 3 }) }));
  H.cierres.mockResolvedValue({ status: "ok", opciones: [CIERRE_CON_MOVIMIENTOS], hayMas: false });
});

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R23/R27 — el placeholder del buscador por superficie", () => {
  it("R23/R27: el placeholder de la oficina nombra a quién registró; el de `/mi-wallet`, solo la descripción", () => {
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por descripción o quién registró");
    cleanup();
    envolver(<MiEstadoCuenta inicial={estado({ filas: TRES, total: 3 })} cierres={{ opciones: [], hayMas: false, disponible: true }} />);
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por descripción");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R10/R16 — el periodo (467: casilla «Periodo», sin «Aplicar»)", () => {
  it("R16: el periodo lee una vez, desde la página 1; R10: tarjetas nuevas", async () => {
    const user = userEvent.setup();
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: TRES, total: 3, saldoInicial: "777.00" }) });
    montarTienda();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
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

  it("R19 (467 R10): quitar el periodo relee sin periodo y CONSERVA chip, término y orden", async () => {
    const user = userEvent.setup();
    montarTienda();
    // Primero el periodo y DESPUÉS el libro: así la lectura sin periodo y con los filtros del libro es
    // una clave que nunca se pidió (si ya estuviera en caché, SWR la serviría sin llamar, y bien).
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ desde: diaDelMesActual(1) })));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await chip(user, "Cobros");
    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas" })), { timeout: 3000 });

    await alternarCasillas(user, zonaLibro(), "Periodo");
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        chip: "cobros",
        q: "etiquetas",
        sortBy: "fecha",
        sortDir: "asc",
        page: 1,
        pageSize: 20,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R11/R24/R29/R33–R35 — los filtros del libro", () => {
  it("R34/R47: se entra en «Más recientes», sin leer nada y con las tarjetas del servidor", () => {
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00" }));
    const orden = within(zonaLibro()).getByRole("group", { name: "Ordenar el libro" });
    expect(within(orden).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Más recientes", "Más antiguas"]);
    expect(within(orden).getByRole("button", { name: "Más recientes" })).toHaveAttribute("aria-pressed", "true");
    expect(H.ver).not.toHaveBeenCalled();
    expect(tarjetas().textContent).toContain("Saldo inicial₡5");
  });

  it("R35: «Más antiguas» pide al servidor la página 1 en ese orden; «Más recientes» (por defecto) no viaja", async () => {
    const user = userEvent.setup();
    montarTienda();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        sortBy: "fecha",
        sortDir: "asc",
        page: 1,
        pageSize: 20,
      }),
    );
  });

  it("R11: cambiar chip, término u orden NO cambia las tarjetas pintadas (aunque una respuesta trajera otras)", async () => {
    const user = userEvent.setup();
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00", abonos: "60.00" }));
    // El servidor nunca cambia las tarjetas por el libro (probado en integración); aquí se mide que la
    // pantalla tampoco: cada lectura trae las MISMAS tarjetas y se siguen pintando.
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: [TRES[0]], total: 1, saldoInicial: "5.00", abonos: "60.00" }) });
    const antes = tarjetas().textContent;
    await chip(user, "Cobros");
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas" })), { timeout: 3000 });
    await waitFor(() => {
      expect(filasDeLaTabla()).toHaveLength(2);
      // Con «Más antiguas» la primera es el saldo inicial y la segunda, el único movimiento.
      expect(filasDeLaTabla()[1].textContent).toContain("2026-09-13");
    });
    expect(tarjetas().textContent).toBe(antes);
  });

  it("R24: con menos de 3 caracteres no se lee y el campo avisa", async () => {
    const user = userEvent.setup();
    montarTienda();
    await user.type(buscador(), "et");
    expect(await within(zonaLibro()).findByText("Escribe al menos 3 caracteres para buscar")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(H.ver).not.toHaveBeenCalled();
  });

  it("R29: estando en la página 2, cambiar el término o el chip vuelve a la página 1", async () => {
    const user = userEvent.setup();
    const muchas = Array.from({ length: 20 }, (_, i) => fila({ n: i + 1 }));
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: muchas, total: 45 }) });
    montarTienda(estado({ filas: muchas, total: 45 }));
    await user.click(within(screen.getByRole("navigation", { name: "Paginación del estado de cuenta de Tania Tienda" })).getByRole("button", { name: /siguiente/i }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas", page: 1 })), { timeout: 3000 });
    await user.click(within(screen.getByRole("navigation", { name: "Paginación del estado de cuenta de Tania Tienda" })).getByRole("button", { name: /siguiente/i }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas", page: 2 })));
    await chip(user, "Pagos");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ chip: "pagos", page: 1 })));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R38/R39 — el saldo inicial, donde cae en el tiempo", () => {
  it("la regla: «Más antiguas» ⇒ primera de la página 1; «Más recientes» ⇒ última de la última página", () => {
    // `total` múltiplo de `pageSize` (40 de 20 en 20: la última es la 2).
    expect(posicionSaldoInicial("asc", 1, 20, 40)).toBe("primera");
    expect(posicionSaldoInicial("asc", 2, 20, 40)).toBeNull();
    expect(posicionSaldoInicial("desc", 1, 20, 40)).toBeNull();
    expect(posicionSaldoInicial("desc", 2, 20, 40)).toBe("ultima");
    // No múltiplo (41: la última es la 3).
    expect(posicionSaldoInicial("desc", 2, 20, 41)).toBeNull();
    expect(posicionSaldoInicial("desc", 3, 20, 41)).toBe("ultima");
    expect(posicionSaldoInicial("asc", 3, 20, 41)).toBeNull();
    // Sin movimientos: la única página es la 1, y la lleva en los dos sentidos.
    expect(posicionSaldoInicial("desc", 1, 20, 0)).toBe("ultima");
    expect(posicionSaldoInicial("asc", 1, 20, 0)).toBe("primera");
  });

  it("R39 en pantalla: de entrada («Más recientes») es la ÚLTIMA línea", () => {
    montarTienda(estado({ filas: TRES, total: 3 }));
    const filas = filasDeLaTabla();
    expect(filas).toHaveLength(4);
    expect(filas[3].textContent).toContain("Saldo inicial");
    expect(filas[0].textContent).toContain("2026-09-13");
  });

  it("R38 en pantalla: con «Más antiguas» es la PRIMERA línea de la página 1", async () => {
    const user = userEvent.setup();
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: [...TRES].reverse(), total: 3 }) });
    montarTienda();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(filasDeLaTabla()[1].textContent).toContain("2026-09-11"));
    const filas = filasDeLaTabla();
    expect(filas[0].textContent).toContain("Saldo inicial");
    expect(filas[3].textContent).toContain("2026-09-13");
  });

  it("R39 en pantalla: sin movimientos, la única línea es la del saldo inicial", () => {
    montarTienda(estado({ filas: [], total: 0 }));
    const filas = filasDeLaTabla();
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain("Saldo inicial");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R41 — el término y el orden van en la clave de caché", () => {
  const base = { desde: "", hasta: "", chip: "todo", page: 1, pageSize: 20, cierre: "" };

  it("claves distintas si cambian el término o el orden; `esClaveDeLaCuenta` las casa todas", () => {
    const a = claveEstadoCuenta("tienda", UUID_TIENDA, base);
    const b = claveEstadoCuenta("tienda", UUID_TIENDA, { ...base, termino: "etiquetas" });
    const c = claveEstadoCuenta("tienda", UUID_TIENDA, { ...base, sortDir: "asc" });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(c));
    // Sin término ni orden, la clave es la de «Más recientes» sin búsqueda.
    expect(a).toEqual(claveEstadoCuenta("tienda", UUID_TIENDA, { ...base, termino: "", sortDir: "desc" }));
    const deLaCuenta = esClaveDeLaCuenta("tienda", UUID_TIENDA);
    for (const k of [a, b, c]) expect(deLaCuenta(k)).toBe(true);
    expect(esClaveDeLaCuenta("tienda", UUID_MOV(1))(b)).toBe(false);
  });

  it("y la pantalla lo cumple: volver a un orden ya visto lo sirve la caché, uno nuevo se pide", async () => {
    const user = userEvent.setup();
    montarTienda();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenCalledTimes(1));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más recientes" }));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    // La clave de «Más antiguas» ya tiene su respuesta: no se vuelve a pedir.
    await new Promise((r) => setTimeout(r, 50));
    expect(H.ver).toHaveBeenCalledTimes(1);
  });

  it("`filtrosDeLectura`: término por debajo del mínimo y orden por defecto no viajan", () => {
    expect(filtrosDeLectura({ desde: "", hasta: "" }, "todo", null)).toEqual({});
    expect(filtrosDeLectura({ desde: "", hasta: "" }, "todo", null, { termino: "et", sortDir: "desc" })).toEqual({});
    expect(filtrosDeLectura({ desde: "", hasta: "" }, "todo", null, { termino: " etiq ", sortDir: "asc" })).toEqual({
      q: "etiq",
      sortBy: "fecha",
      sortDir: "asc",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R43 — el Excel: filtros, término y orden vigentes; el saldo inicial donde cae", () => {
  const ESTADO = estado({ filas: TRES, total: 3, saldoInicial: "0.00" });

  it("«Más antiguas»: la línea del saldo inicial es la PRIMERA fila del archivo", async () => {
    H.completo.mockResolvedValue({ status: "ok", estado: ESTADO });
    const r = await filasDelPeriodo(
      lectorDeLaCuenta({ tipo: "tienda", id: UUID_TIENDA }),
      { chip: "cobros", q: "etiquetas", sortBy: "fecha", sortDir: "asc" },
      ROTULOS_TIENDA,
    );
    expect(H.completo).toHaveBeenCalledWith({
      cuenta: { tipo: "tienda", id: UUID_TIENDA },
      chip: "cobros",
      q: "etiquetas",
      sortBy: "fecha",
      sortDir: "asc",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.filas).toHaveLength(4);
    expect(r.filas[0].movimiento).toBe("Saldo inicial");
    expect(r.filas[1].fecha).toBe("2026-09-13");
  });

  it("«Más recientes» (sin orden en el filtro): la línea del saldo inicial es la ÚLTIMA fila", async () => {
    H.completo.mockResolvedValue({ status: "ok", estado: ESTADO });
    const r = await filasDelPeriodo(lectorDeLaCuenta({ tipo: "tienda", id: UUID_TIENDA }), {}, ROTULOS_TIENDA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.filas[3].movimiento).toBe("Saldo inicial");
    expect(r.filas[0].fecha).toBe("2026-09-13");
  });

  it("la pantalla manda a la descarga el término y el orden vigentes", async () => {
    const user = userEvent.setup();
    H.completo.mockResolvedValue({ status: "ok", estado: ESTADO });
    montarTienda();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas" })), { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Descargar Estado de cuenta de Tania Tienda" }));
    await waitFor(() =>
      expect(H.completo).toHaveBeenCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        q: "etiquetas",
        sortBy: "fecha",
        sortDir: "asc",
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FICHA 463 (R49, revisión B1) — si una lectura falla, la pantalla se queda con la última BUENA: sus
// tarjetas, su libro y sus filtros. Lo dice junto al libro, no en su lugar.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const AVISO_R49 = /^No se pudo cargar el estado de cuenta\. Se sigue mostrando lo último que se cargó, con sus filtros\.$/;

describe("463 R49 — en el estado de cuenta, una lectura que falla no borra nada ni deja filtros que no se ven", () => {
  it("un periodo que falla: aviso, tarjetas y libro de antes, y el control del periodo vuelve a «Cualquier fecha»", async () => {
    const user = userEvent.setup();
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00", abonos: "60.00" }));
    const tarjetasAntes = tarjetas().textContent;
    const filasAntes = filasDeLaTabla().map((f) => f.textContent);
    H.ver.mockResolvedValue({ status: "forbidden" });

    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.ver).toHaveBeenCalledWith(expect.objectContaining({ desde: diaDelMesActual(1) })));

    const aviso = await screen.findByText(AVISO_R49);
    expect(aviso).toHaveAttribute("role", "alert");
    // Las tarjetas y el libro son los de la lectura buena (sin periodo), con su saldo inicial al final.
    expect(tarjetas().textContent).toBe(tarjetasAntes);
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);
    expect(filasAntes).toHaveLength(4);
    expect(filasAntes[3]).toContain("Saldo inicial");
    // Y el control NO dice que hay un periodo puesto.
    await waitFor(() =>
      expect(within(zonaWallet()).getByRole("button", { name: "Periodo" })).toHaveTextContent("Cualquier fecha"),
    );

    // Y no solo lo pintado: la siguiente lectura del libro se pide SIN el periodo que falló.
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: [TRES[0]], total: 1 }) });
    await chip(user, "Cobros");
    await waitFor(() =>
      expect(H.ver).toHaveBeenLastCalledWith({ cuenta: { tipo: "tienda", id: UUID_TIENDA }, chip: "cobros", page: 1, pageSize: 20 }),
    );
  });

  it("con un periodo ya aplicado, uno nuevo que falla devuelve el control al APLICADO, no a vacío", async () => {
    const user = userEvent.setup();
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: TRES, total: 3, saldoInicial: "777.00" }) });
    montarTienda();
    await aplicarPeriodo(user, zonaWallet(), 1, 10);
    await waitFor(() => expect(tarjetas().textContent).toContain("Saldo inicial₡777"));
    const periodoBueno = within(zonaWallet()).getByRole("button", { name: "Periodo" }).textContent;
    expect(periodoBueno).not.toContain("Cualquier fecha");

    H.ver.mockResolvedValue({ status: "forbidden" });
    await aplicarPeriodo(user, zonaWallet(), 12, 28);
    await screen.findByText(AVISO_R49);
    expect(tarjetas().textContent).toContain("Saldo inicial₡777");
    await waitFor(() =>
      expect(within(zonaWallet()).getByRole("button", { name: "Periodo" }).textContent).toBe(periodoBueno),
    );
  });

  it("cambiar un chip que falla: aviso, el chip vuelve a «Todo» y siguen el libro, el orden y las tarjetas de la lectura buena", async () => {
    const user = userEvent.setup();
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00" }));
    // Una lectura buena que NO es la de entrada: «Más antiguas».
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: [...TRES].reverse(), total: 3, saldoInicial: "5.00" }) });
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(filasDeLaTabla()[1].textContent).toContain("2026-09-11"));
    const tarjetasBuenas = tarjetas().textContent;
    const filasBuenas = filasDeLaTabla().map((f) => f.textContent);
    expect(filasBuenas[0]).toContain("Saldo inicial");

    H.ver.mockResolvedValue({ status: "forbidden" });
    await chip(user, "Cobros");
    await screen.findByText(AVISO_R49);

    await waitFor(() => expect(textoChip()).toBe("Tipo de movimiento: Todo"));
    expect(within(zonaLibro()).getByRole("button", { name: "Más antiguas" })).toHaveAttribute("aria-pressed", "true");
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasBuenas);
    expect(tarjetas().textContent).toBe(tarjetasBuenas);
  });

  it("un término y un orden que fallan: el campo vuelve a vacío y el orden a «Más recientes»", async () => {
    const user = userEvent.setup();
    montarTienda();
    const filasAntes = filasDeLaTabla().map((f) => f.textContent);
    H.ver.mockResolvedValue({ status: "forbidden" });
    await user.type(buscador(), "etiquetas");
    await screen.findByText(AVISO_R49, undefined, { timeout: 3000 });
    await waitFor(() => expect(buscador()).toHaveValue(""));
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);

    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc" })));
    await waitFor(() =>
      expect(within(zonaLibro()).getByRole("button", { name: "Más recientes" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByText(AVISO_R49)).toBeInTheDocument();
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);
  });

  // Revisión m7 — la acción que LANZA (red caída, 500, tiempo agotado), no solo la que responde un error.
  it("(m7) un periodo cuya lectura LANZA: aviso, tarjetas y libro de antes, y el periodo vuelve a «Cualquier fecha»", async () => {
    const user = userEvent.setup();
    montarTienda(estado({ filas: TRES, total: 3, saldoInicial: "5.00", abonos: "60.00" }));
    const tarjetasAntes = tarjetas().textContent;
    const filasAntes = filasDeLaTabla().map((f) => f.textContent);
    H.ver.mockRejectedValue(new Error("Failed to fetch"));

    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.ver).toHaveBeenCalledWith(expect.objectContaining({ desde: diaDelMesActual(1) })));

    expect(await screen.findByText(AVISO_R49)).toHaveAttribute("role", "alert");
    expect(tarjetas().textContent).toBe(tarjetasAntes);
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);
    await waitFor(() =>
      expect(within(zonaWallet()).getByRole("button", { name: "Periodo" })).toHaveTextContent("Cualquier fecha"),
    );
  });

  it("(m7) un chip y un término cuya lectura LANZA: aviso, vuelven a «Todo» y a vacío, y el libro sigue", async () => {
    const user = userEvent.setup();
    montarTienda();
    const filasAntes = filasDeLaTabla().map((f) => f.textContent);
    H.ver.mockRejectedValue(new Error("Failed to fetch"));

    await chip(user, "Cobros");
    await screen.findByText(AVISO_R49);
    await waitFor(() => expect(textoChip()).toBe("Tipo de movimiento: Todo"));
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);

    await user.type(buscador(), "etiquetas");
    await waitFor(() => expect(H.ver).toHaveBeenLastCalledWith(expect.objectContaining({ q: "etiquetas" })), {
      timeout: 3000,
    });
    await waitFor(() => expect(buscador()).toHaveValue(""));
    expect(screen.getByText(AVISO_R49)).toBeInTheDocument();
    expect(filasDeLaTabla().map((f) => f.textContent)).toEqual(filasAntes);
  });

  it("una lectura buena después quita el aviso", async () => {
    const user = userEvent.setup();
    montarTienda();
    H.ver.mockResolvedValue({ status: "forbidden" });
    await chip(user, "Cobros");
    await screen.findByText(AVISO_R49);
    H.ver.mockResolvedValue({ status: "ok", estado: estado({ filas: [TRES[0]], total: 1 }) });
    await chip(user, "Pagos");
    await waitFor(() => {
      expect(filasDeLaTabla()).toHaveLength(2);
      expect(filasDeLaTabla()[0].textContent).toContain("2026-09-13");
    });
    expect(screen.queryByText(AVISO_R49)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R38/R39 (revisión m2) — el saldo inicial se coloca con el orden de lo PINTADO", () => {
  it("mientras llega «Más antiguas», las filas de «Más recientes» siguen con el saldo inicial al final", async () => {
    const user = userEvent.setup();
    H.ver.mockImplementation(() => new Promise(() => {})); // la lectura nueva no llega
    montarTienda();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.ver).toHaveBeenCalledTimes(1));
    const filas = filasDeLaTabla();
    expect(filas).toHaveLength(4);
    expect(filas[0].textContent).toContain("2026-09-13");
    expect(filas[3].textContent).toContain("Saldo inicial");
  });
});
