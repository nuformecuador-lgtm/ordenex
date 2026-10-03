// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { UUID_MOV, estado, fila } from "@/tests/fixtures/estado-cuenta";
import type { OrdenAporteDTO, OrdenDeDetalleDTO } from "@/lib/types/detalle-movimiento";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 469 (T11–T13) — LA BÚSQUEDA POR GUÍA, EN PANTALLA
// =================================================================================================
//
// El servidor decide si el término es una guía (R33) y devuelve `modoBusqueda`. Aquí se mide lo que la
// pantalla hace con eso:
//  - el aviso (R21) solo con la lectura PINTADA en modo guía, nunca en modo texto (R23), y el de la
//    lectura que sigue pintada si la nueva falla (regla R49 de la 463);
//  - el vacío propio (R22);
//  - `resaltar` viaja al detalle SOLO en modo guía (R28), en la clave SWR (dos términos, dos lecturas);
//  - el bloque «Guía buscada» con el aporte del servidor tal cual (R25/R27) y la fila resaltada con
//    texto, no solo color (R26);
//  - los placeholders (R24) y la satélite sin guía (R36).
// Los literales de contrato (R21, R22) se escriben A MANO.
// =================================================================================================

const H = vi.hoisted(() => ({
  ver: vi.fn(),
  verMi: vi.fn(),
  ordenesDeFila: vi.fn(),
  detalleCaja: vi.fn(),
  detalleMi: vi.fn(),
  listar: vi.fn(),
  resumen: vi.fn(),
  desglose: vi.fn(),
  autoria: vi.fn(),
  conceptos: vi.fn(),
  quienes: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => H.ver(...a),
  estadoCuentaKardexAction: vi.fn(),
  estadoCuentaKardexConDetalleAction: vi.fn(),
  verMiEstadoCuentaAction: (...a: unknown[]) => H.verMi(...a),
  miEstadoCuentaKardexAction: vi.fn(),
  miEstadoCuentaKardexConDetalleAction: vi.fn(),
  verOrdenesDeFilaAction: (...a: unknown[]) => H.ordenesDeFila(...a),
}));
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: (...a: unknown[]) => H.listar(...a),
  libroCajaKardexAction: vi.fn(),
  libroCajaKardexConDetalleAction: vi.fn(),
  verResumenCajaAction: (...a: unknown[]) => H.resumen(...a),
  listarMovimientosDeFilaAction: vi.fn(),
  registrarMovimientoManualAction: vi.fn(),
  verDetalleDeMovimientoAction: (...a: unknown[]) => H.detalleCaja(...a),
  verDetalleDeMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: (...a: unknown[]) => H.detalleMi(...a),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: (...a: unknown[]) => H.desglose(...a),
  registrarEgresoAdministrativoAction: vi.fn(),
  reversarEgresoAdministrativoAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  listarPlantillasPaginadoAction: vi.fn(async () => ({ status: "ok", items: [], page: 1, pageSize: 25, total: 0 })),
  listarPlantillasCompletoAction: vi.fn(),
  crearPlantillaAction: vi.fn(),
  actualizarPlantillaAction: vi.fn(),
  eliminarPlantillaAction: vi.fn(),
  setActivaPlantillaAction: vi.fn(),
}));
vi.mock("@/lib/actions/rechazo-tienda-cobro", () => ({
  listarCobrosRechazoTiendaAction: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
  aprobarCobroRechazoTiendaAction: vi.fn(),
  rechazarCobroRechazoTiendaAction: vi.fn(),
}));
vi.mock("@/lib/actions/libro-caja-autoria", () => ({
  autoriaDelLibroCajaAction: (...a: unknown[]) => H.autoria(...a),
}));
vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => H.conceptos(...a),
  cierresDeLaCuentaAction: vi.fn(),
  quienesDelLibroCajaAction: (...a: unknown[]) => H.quienes(...a),
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/wallet",
}));

import { BUSQUEDA_POR_GUIA_TEXTO } from "@/components/shared/wallet/busqueda-por-guia-labels";
import { EstadoCuenta, terminoDeGuia } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { ESTADO_CUENTA_TEXTO } from "@/components/shared/estado-cuenta/estado-cuenta-labels";
import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import { claveDetalle } from "@/app/(app)/wallet/_components/DetalleMovimientoCierre";
import { claveDetalleMiMovimiento } from "@/app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre";
import { WalletModule } from "@/app/(app)/wallet/_components/WalletModule";
import { money } from "@/app/(app)/wallet/_components/wallet-labels";

const GUIA = "38589325";
const AVISO = `Guía o remisión «${GUIA}»: solo se muestran los movimientos en los que esa orden aporta dinero.`;
const VACIO = "Esa guía o remisión no aporta dinero a ningún movimiento de este libro con los filtros elegidos.";

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

const buscador = () => screen.getByRole("searchbox", { name: "Buscar en el libro" });

function orden(over: Partial<OrdenDeDetalleDTO> = {}): OrdenDeDetalleDTO {
  return {
    ordenId: "11111111-1111-4111-8111-111111111111",
    guia: "48127",
    destinatario: "María Fernández",
    tiendaNombre: "Tienda Central",
    resultados: ["entregado"],
    aporte: "1700.00",
    resaltada: false,
    ...over,
  };
}

const BUSCADA: OrdenDeDetalleDTO = orden({
  ordenId: "22222222-2222-4222-8222-222222222222",
  guia: GUIA,
  destinatario: "Ana Quesada",
  aporte: "2950.50",
  resaltada: true,
});
const DESTACADA: OrdenAporteDTO = {
  ordenId: BUSCADA.ordenId,
  guia: BUSCADA.guia,
  destinatario: BUSCADA.destinatario,
  tiendaNombre: BUSCADA.tiendaNombre,
  resultados: BUSCADA.resultados,
  aporte: BUSCADA.aporte,
};

function detalleOk(ordenes: OrdenDeDetalleDTO[], destacadas: OrdenAporteDTO[]) {
  return {
    status: "ok" as const,
    data: {
      monto: "28800.00",
      cierre: { fecha: "2026-09-11T00:00:00.000Z", mensajeroNombre: "Kevin Solano" },
      ordenesDelCierre: 23,
      total: ordenes.length,
      page: 1,
      pageSize: 25,
      ordenes,
      destacadas,
    },
  };
}

const UNA = [fila({ n: 1, fecha: "2026-09-11", abono: "10.00", saldoCorrido: "10.00" })];
const TRES = [
  fila({ n: 3, fecha: "2026-09-13", abono: "30.00", saldoCorrido: "60.00" }),
  fila({ n: 2, fecha: "2026-09-12", abono: "20.00", saldoCorrido: "30.00" }),
  ...UNA,
];

/** El lector de la cuenta: con la guía, modo guía (una fila); con otro término, modo texto. */
function lectorPorTermino(over: { guiaVacia?: boolean } = {}) {
  return async (f: { q?: string }) => {
    if (f.q === GUIA) {
      return {
        status: "ok",
        estado: estado({ filas: over.guiaVacia ? [] : UNA, total: over.guiaVacia ? 0 : 1, modoBusqueda: "guia" }),
      };
    }
    if (f.q !== undefined) return { status: "ok", estado: estado({ filas: UNA, total: 1, modoBusqueda: "texto" }) };
    return { status: "ok", estado: estado({ filas: TRES, total: 3 }) };
  };
}

async function buscar(user: ReturnType<typeof userEvent.setup>, termino: string, lector = H.ver) {
  await user.clear(buscador());
  await user.type(buscador(), termino);
  await waitFor(() => expect(lector).toHaveBeenLastCalledWith(expect.objectContaining({ q: termino })), { timeout: 3000 });
}

beforeEach(() => {
  vi.clearAllMocks();
  H.ver.mockImplementation(lectorPorTermino());
  H.verMi.mockImplementation(lectorPorTermino());
  H.ordenesDeFila.mockResolvedValue(detalleOk([orden()], []));
  H.detalleMi.mockResolvedValue(detalleOk([orden()], []));
  H.detalleCaja.mockResolvedValue(detalleOk([orden()], []));
});

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("469 T11 — los textos (contrato)", () => {
  it("R21/R22: el aviso y el vacío, literales", () => {
    expect(BUSQUEDA_POR_GUIA_TEXTO.aviso(GUIA)).toEqual(AVISO);
    expect(BUSQUEDA_POR_GUIA_TEXTO.vacio).toEqual(VACIO);
    expect(BUSQUEDA_POR_GUIA_TEXTO.guiaBuscada).toEqual("Guía buscada");
  });

  it("R35: los textos nuevos no usan la sigla «SLA» ni jerga técnica", () => {
    const textos = [
      BUSQUEDA_POR_GUIA_TEXTO.aviso("NA-107"),
      BUSQUEDA_POR_GUIA_TEXTO.vacio,
      BUSQUEDA_POR_GUIA_TEXTO.guiaBuscada,
      BUSQUEDA_POR_GUIA_TEXTO.bloque("Flete", "2026-09-11"),
      ESTADO_CUENTA_TEXTO.buscarPlaceholder.oficina,
      ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda,
    ];
    for (const t of textos) {
      expect(t).not.toMatch(/\bSLA\b|acuerdo de nivel|\bquery\b|\bfilter\b|\bmatch\b|\bsearch\b/i);
    }
  });

  it("R21/R23/R28: `terminoDeGuia` solo da término con la lectura en modo guía", () => {
    const sel = (termino: string) => ({ seleccion: { termino } });
    expect(terminoDeGuia(undefined)).toBeNull();
    expect(terminoDeGuia({ ...sel(GUIA), estado: estado({ modoBusqueda: "guia" }) })).toBe(GUIA);
    expect(terminoDeGuia({ ...sel(` ${GUIA} `), estado: estado({ modoBusqueda: "guia" }) })).toBe(GUIA);
    expect(terminoDeGuia({ ...sel(GUIA), estado: estado({ modoBusqueda: "texto" }) })).toBeNull();
    expect(terminoDeGuia({ ...sel(GUIA), estado: estado({}) })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("469 T12 — el estado de cuenta: aviso y vacío según la lectura PINTADA", () => {
  it("R21/R23: con la guía sale el aviso; con un texto normal, no", async () => {
    const user = userEvent.setup();
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    expect(screen.queryByText(AVISO)).toBeNull();

    await buscar(user, GUIA);
    expect(await screen.findByText(AVISO)).toHaveAttribute("role", "status");

    await buscar(user, "etiquetas");
    await waitFor(() => expect(screen.queryByText(AVISO)).toBeNull());
    expect(screen.queryByText(/Guía o remisión/)).toBeNull();
  });

  it("R22: búsqueda por guía sin movimientos ⇒ su texto, no el vacío genérico", async () => {
    H.ver.mockImplementation(lectorPorTermino({ guiaVacia: true }));
    const user = userEvent.setup();
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    await buscar(user, GUIA);
    expect(await screen.findByText(VACIO)).toBeInTheDocument();
    expect(screen.queryByText(ESTADO_CUENTA_TEXTO.vacio)).toBeNull();
  });

  it("R49 (463): si la lectura nueva falla, el aviso sigue siendo el de la lectura pintada", async () => {
    const user = userEvent.setup();
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    await buscar(user, GUIA);
    expect(await screen.findByText(AVISO)).toBeInTheDocument();

    H.ver.mockImplementation(async () => ({ status: "forbidden" }));
    await buscar(user, "etiquetas");
    expect(await screen.findByRole("alert")).toHaveTextContent(ESTADO_CUENTA_TEXTO.errorConservado);
    expect(screen.getByText(AVISO)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("469 T13 — el detalle de una fila: `resaltar` solo en modo guía", () => {
  const abrir = () => screen.getAllByRole("button", { name: /^Ver las órdenes que componen/ })[0];

  it("R28: en modo texto el detalle se pide SIN `resaltar` y no hay bloque ni fila resaltada", async () => {
    const user = userEvent.setup();
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    await buscar(user, "etiquetas");
    // Ancla de CONTENIDO: la fila del 11 (la que trae la lectura de texto) está y la del 13 ya no.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Ver las órdenes que componen .* del 2026-09-11$/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Ver las órdenes que componen .* del 2026-09-13$/ })).toBeNull();
    });
    await user.click(abrir());
    await waitFor(() => expect(H.ordenesDeFila).toHaveBeenCalledTimes(1));
    expect(H.ordenesDeFila.mock.calls[0][0]).not.toHaveProperty("resaltar");
    expect(screen.queryByText("Guía buscada")).toBeNull();
  });

  it("R25/R26/R27: en modo guía viaja `resaltar`; bloque arriba con el aporte TAL CUAL y la fila con texto", async () => {
    H.ordenesDeFila.mockResolvedValue(detalleOk([orden(), BUSCADA], [DESTACADA]));
    const user = userEvent.setup();
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    await buscar(user, GUIA);
    await screen.findByText(AVISO);
    await user.click(abrir());
    await waitFor(() =>
      expect(H.ordenesDeFila).toHaveBeenCalledWith(
        expect.objectContaining({ cuenta: { tipo: "tienda", id: expect.any(String) }, movimientoId: UUID_MOV(1), resaltar: GUIA }),
      ),
    );
    const bloque = await screen.findByRole("region", { name: /^Guía buscada en / });
    expect(within(bloque).getByText("Ana Quesada")).toBeInTheDocument();
    // R27 — el MISMO string del servidor, pintado con `money`: el bloque y la fila dicen lo mismo.
    expect(within(bloque).getByText(money("2950.50"))).toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: /^Órdenes que componen/ });
    const filaBuscada = within(tabla).getByText("Ana Quesada").closest("tr")!;
    expect(within(filaBuscada).getByText(money("2950.50"))).toBeInTheDocument();
    // R26 — no solo color: la fila lleva el texto «Guía buscada»; la otra no.
    expect(within(filaBuscada).getByText("Guía buscada")).toBeInTheDocument();
    const otra = within(tabla).getByText("María Fernández").closest("tr")!;
    expect(within(otra).queryByText("Guía buscada")).toBeNull();
    expect(filaBuscada.className).toMatch(/bg-info-soft/);
    expect(otra.className).not.toMatch(/bg-info-soft/);
    // B1 (revisión 469): `--color-info-soft` no gira en `.dark` y el texto sí; sin la variante
    // oscura el bloque y la fila quedaban a ~1,1:1. Mismo idioma que `Badge` info.
    expect(bloque.className.split(/\s+/)).toContain("dark:bg-info/15");
    expect(filaBuscada.className.split(/\s+/)).toContain("dark:bg-info/15");
    expect(otra.className).not.toMatch(/dark:bg-info/);
  });

  it("mensajero: también manda `resaltar` en modo guía", async () => {
    H.ver.mockImplementation(async (f: { q?: string }) => ({
      status: "ok",
      estado: estado({ tipo: "mensajero", nombre: "Juan Pérez", filas: [fila({ n: 1, libro: "mensajero", categoria: "pago_devengado" })], total: 1, ...(f.q ? { modoBusqueda: "guia" as const } : {}) }),
    }));
    const user = userEvent.setup();
    envolver(<EstadoCuentaMensajero inicial={estado({ tipo: "mensajero", nombre: "Juan Pérez", filas: TRES, total: 3 })} puedeRegistrar={false} />);
    await buscar(user, GUIA);
    await screen.findByText(AVISO);
    await user.click(abrir());
    await waitFor(() =>
      expect(H.ordenesDeFila).toHaveBeenCalledWith(expect.objectContaining({ cuenta: { tipo: "mensajero", id: expect.any(String) }, resaltar: GUIA })),
    );
  });

  it("/mi-wallet (R25/R28): `resaltar` viaja a su propio borde solo en modo guía", async () => {
    H.detalleMi.mockResolvedValue(detalleOk([BUSCADA], [DESTACADA]));
    const user = userEvent.setup();
    envolver(<MiEstadoCuenta inicial={estado({ filas: TRES, total: 3 })} cierres={{ opciones: [], hayMas: false, disponible: true }} />);
    await buscar(user, GUIA, H.verMi);
    await screen.findByText(AVISO);
    await user.click(abrir());
    await waitFor(() => expect(H.detalleMi).toHaveBeenCalledWith({ movimientoId: UUID_MOV(1), page: 1, resaltar: GUIA }));
    const bloque = await screen.findByRole("region", { name: /^Guía buscada en / });
    // B1 (revisión 469): la variante oscura también en /mi-wallet, bloque y fila resaltada.
    expect(bloque.className.split(/\s+/)).toContain("dark:bg-info/15");
    const tabla = screen.getByRole("table", { name: /^Órdenes que componen/ });
    const filaBuscada = within(tabla).getByText("Ana Quesada").closest("tr")!;
    expect(filaBuscada.className.split(/\s+/)).toEqual(expect.arrayContaining(["bg-info-soft", "dark:bg-info/15"]));
  });

  it("design §4.3: dos términos ⇒ dos claves SWR; sin término, la clave de siempre con «»", () => {
    expect(claveDetalle("m", 1, "p", GUIA)).not.toEqual(claveDetalle("m", 1, "p", "NA-107"));
    expect(claveDetalle("m", 1, "p")).toEqual(["p", "m", 1, ""]);
    expect(claveDetalleMiMovimiento("m", 2, GUIA)).not.toEqual(claveDetalleMiMovimiento("m", 2));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("469 R24/R36 — los placeholders", () => {
  it("R24: oficina y /mi-wallet nombran la guía y la remisión", () => {
    envolver(<EstadoCuentaTienda inicial={estado({ filas: TRES, total: 3 })} puedeRegistrar={false} />);
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por guía, remisión, descripción o quién registró");
    cleanup();
    envolver(<MiEstadoCuenta inicial={estado({ filas: TRES, total: 3 })} cierres={{ opciones: [], hayMas: false, disponible: true }} />);
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por guía, remisión o descripción");
  });

  it("R36: la bodega satélite NO nombra la guía", () => {
    envolver(
      <EstadoCuenta
        descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }}
        inicial={estado({ tipo: "bodega", nombre: "Bodega Norte", filas: [], total: 0 })}
        rotulos={{ concepto: (f) => f.categoria, origen: () => null }}
      />,
    );
    expect(buscador()).toHaveAttribute("placeholder", "Buscar por descripción o quién registró");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("469 T12/T13 — la caja (`/wallet`)", () => {
  const RESUMEN = {
    entradas: "0.00", salidas: "0.00", enCaja: "0.00", signoEnCaja: "cero" as const, ingresosPropios: "0.00",
    egresosPropios: "0.00", ganancia: "0.00", signoGanancia: "cero" as const, deTerceros: "0.00", periodoFiltrado: false,
    porcentajeTiendas: "0.00", modoComposicion: "dos_bolsillos" as const, capital: "0.00", signoCapital: "cero" as const,
    deOrdenex: "0.00", signoDeTerceros: "cero" as const, deTercerosAbsoluto: "0.00", estado: "flujo" as const, flujoDesde: "2026-08-25",
  };
  const COMPOSICION = {
    ingresos: {
      ingreso_flete: "0.00", ingreso_flete_devolucion: "0.00", ingreso_comision_cod: "0.00", ingreso_iva_flete: "0.00",
      ingreso_iva_flete_devolucion: "0.00", ingreso_iva_comision_cod: "0.00", ingreso_ajuste: "0.00", ingreso_cobro_tienda: "0.00",
    },
    totalIngresos: "0.00",
    egresos: {
      egreso_pago_mensajero: "0.00", egreso_ajuste: "0.00", egreso_reverso_cobro_tienda: "0.00",
      egreso_reverso_flete_devolucion: "0.00", egreso_reverso_iva_flete_devolucion: "0.00",
    },
    otrosEgresos: "0.00", hayOtrosEgresos: false, totalEgresos: "0.00",
  };
  const DESGLOSE = { gastoFijo: "0.00", gastoVariable: "0.00", sueldo: "0.00", indemnizacion: "0.00", total: "0.00" };

  function mov(n: number): WalletMovimientoDTO {
    return {
      id: `0000000${n}-0000-4000-8000-00000000000${n}`,
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto: `${n}000.00`,
      origenTipo: "cierre_dia",
      origenId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      descripcion: null,
      registradoPor: null,
      fechaMovimiento: `2026-09-2${n}T15:00:00.000Z`,
      dueno: "propio",
      documento: null,
    };
  }
  const PAGINA = [mov(3), mov(2), mov(1)];

  function pintarCaja() {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <WalletModule
            movimientos={PAGINA}
            total={3}
            page={1}
            pageSize={20}
            resumen={RESUMEN}
            desglose={DESGLOSE}
            composicion={COMPOSICION}
            plantillas={{ items: [], total: 0, pageSize: 25 }}
            cobrosPendientes={{ items: [], total: 0 }}
            cobrosRechazoTienda={{ items: [], total: 0 }}
            puedeDecidirCobros
            puedeDecidirCobrosRechazo
            ahoraIso="2026-09-26T18:00:00.000Z"
          />
        </ToastProvider>
      </SWRConfig>,
    );
    return userEvent.setup();
  }

  beforeEach(() => {
    H.resumen.mockResolvedValue({ status: "ok", resumen: RESUMEN, composicion: COMPOSICION });
    H.desglose.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
    H.conceptos.mockResolvedValue({ status: "ok", conceptos: [] });
    H.quienes.mockResolvedValue({ status: "ok", opciones: [], hayMas: false });
    H.autoria.mockResolvedValue({ status: "ok", filas: [] });
    H.listar.mockImplementation(async (i: { q?: string }) => {
      if (i.q === GUIA) return { status: "ok", data: { movimientos: [mov(1)], total: 1, page: 1, pageSize: 20, modoBusqueda: "guia" } };
      if (i.q === "SIN") return { status: "ok", data: { movimientos: [], total: 0, page: 1, pageSize: 20, modoBusqueda: "guia" } };
      if (i.q !== undefined) return { status: "ok", data: { movimientos: [mov(2)], total: 1, page: 1, pageSize: 20, modoBusqueda: "texto" } };
      return { status: "ok", data: { movimientos: PAGINA, total: 3, page: 1, pageSize: 20 } };
    });
  });

  it("R21/R23/R18: aviso solo en modo guía; las cifras no se piden al buscar", async () => {
    const user = pintarCaja();
    await buscar(user, GUIA, H.listar);
    expect(await screen.findByText(AVISO)).toHaveAttribute("role", "status");
    expect(H.resumen).not.toHaveBeenCalled();
    await buscar(user, "Sueldo", H.listar);
    await waitFor(() => expect(screen.queryByText(/Guía o remisión/)).toBeNull());
  });

  it("R22: guía sin movimientos ⇒ el vacío propio en el libro", async () => {
    const user = pintarCaja();
    await buscar(user, "SIN", H.listar);
    expect(await screen.findByText(VACIO)).toBeInTheDocument();
    expect(screen.queryByText("No hay movimientos que coincidan con los filtros.")).toBeNull();
  });

  it("R25/R28: abrir una fila manda `resaltar` en modo guía y no en modo texto", async () => {
    const user = pintarCaja();
    await buscar(user, GUIA, H.listar);
    await screen.findByText(AVISO);
    await user.click(screen.getAllByRole("button", { name: /^Ver las órdenes que componen/ })[0]);
    await waitFor(() => expect(H.detalleCaja).toHaveBeenCalledWith({ movimientoId: mov(1).id, page: 1, resaltar: GUIA }));

    await buscar(user, "Sueldo", H.listar);
    await waitFor(() => expect(screen.queryByText(AVISO)).toBeNull());
    await user.click(screen.getAllByRole("button", { name: /^Ver las órdenes que componen/ })[0]);
    await waitFor(() => expect(H.detalleCaja).toHaveBeenLastCalledWith({ movimientoId: mov(2).id, page: 1 }));
  });
});
