// @vitest-environment jsdom
// =================================================================================================
// GUARDIA DE RENDER — FICHA 458-A (TA.5, R96 + R1, R99) — NINGÚN IDENTIFICADOR EN PANTALLA
// =================================================================================================
//
// Las guardias de fuente no ven lo que la pantalla COMPONE: el uuid del cierre llegaba al nombre
// accesible de «Ver el cierre» a través de un `sr-only` (`CIERRE_ENLACE.identificacion`, C4.1),
// armado en tiempo de render. Esta guardia RENDERIZA cada superficie de la wallet con datos cuyos
// identificadores son uuid —ids de fila, de origen, de cierre, de tienda, de mensajero, de quien
// registró, y el `href` de los enlaces— y falla si alguno aparece en:
//
//   texto visible (`textContent`), `aria-label`, `aria-describedby`/`aria-labelledby` resueltos,
//   `placeholder`, `value` de un control o `title`.
//
// Quedan fuera, a propósito, `id`, `htmlFor`/`for` y `href`: son direcciones, no textos (D1).
//
// No-vacuidad: los datos SÍ llevan uuid hasta el DOM (hay enlaces cuyo `href` los contiene) y se
// renderizan las N superficies. Contraprueba: el `EnlaceCierre` de antes de la 458-A la pone roja.
//
// FICHA 458-D (T D.8): los desgloses de `/wallet/tiendas` y `/wallet/mensajeros` se retiraron. En su
// lugar entran los ESTADOS DE CUENTA de tienda (con el panel «Ver» abierto), mensajero (con el pago
// y su previsualización) y bodega (con la conciliación), los listados que enlazan a ellos (el uuid SOLO
// en el `href`) y el selector de cierre abierto sobre la MISMA composición que usaban los desgloses.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { OrigenLegibleDTO } from "@/lib/types/wallet-origen";

const H = vi.hoisted(() => ({
  conceptos: vi.fn(),
  cierres: vi.fn(),
  estadoCuenta: vi.fn(),
  consolidaciones: vi.fn(),
  previsualizar: vi.fn(),
  deFila: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => H.conceptos(...a),
  cierresDeLaCuentaAction: (...a: unknown[]) => H.cierres(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
  // Los listados pintan su página del servidor (`fallbackData`); la relectura queda pendiente a propósito.
  listarSaldosTiendasPaginadoAction: vi.fn(() => new Promise(() => {})),
  listarSaldosTiendasCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarPaginadoAction: vi.fn(() => new Promise(() => {})),
  listarCuentasPorPagarCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => H.estadoCuenta(...a),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: vi.fn(),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/conciliacion-satelites", () => ({
  listarConsolidacionesSateliteAction: (...a: unknown[]) => H.consolidaciones(...a),
  listarConsolidacionesSateliteCompletoAction: vi.fn(),
  listarSaldosSatelitesAction: vi.fn(() => new Promise(() => {})),
  listarSaldosSatelitesCompletoAction: vi.fn(),
  marcarConsolidacionRecibidaAction: vi.fn(),
  revertirConciliacionAction: vi.fn(),
}));
vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...a: unknown[]) => H.previsualizar(...a),
  registrarRepartoMensajeroAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet", () => ({ listarMovimientosDeFilaAction: (...a: unknown[]) => H.deFila(...a) }));
vi.mock("@/lib/actions/wallet-egresos", () => ({ reversarEgresoAdministrativoAction: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import { LibroCajaBarraControlada } from "@/tests/fixtures/libro-caja-barra";
import { DetalleFilaComposicion } from "@/app/(app)/wallet/_components/DetalleFilaComposicion";
import { FILTROS_VACIOS } from "@/app/(app)/wallet/_components/WalletFiltros";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { EstadoCuentaSatelite } from "@/app/(app)/wallet/satelites/_components/EstadoCuentaSatelite";
import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";
import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";
import { SaldosSatelitesTable } from "@/app/(app)/wallet/satelites/_components/SaldosSatelitesTable";
import { SelectorBuscable } from "@/components/shared/SelectorBuscable";
import { CIERRE_SELECTOR_TEXTOS } from "@/components/shared/wallet/cierres-selector";
import { useCierresDeLaCuenta } from "@/components/shared/wallet/use-cierres-de-la-cuenta";
import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { RepartoPrevisualizacion } from "@/app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const u = (n: number) => `${String(n).padStart(8, "0")}-aaaa-4bbb-8ccc-${String(n).padStart(12, "d")}`;
const TIENDA = u(1);
const MENSAJERO = u(2);
const CIERRE = u(3);
const USUARIO = u(4);

/** El origen legible que adjunta el servidor, con el uuid SOLO en `href`. */
const ORIGEN: OrigenLegibleDTO = {
  texto: "Cierre del día · 2026-09-12 · Juan Pérez Mora",
  enlace: { etiqueta: "Ver el cierre del 2026-09-12 de Juan Pérez Mora", href: `/cierres-admin?cierre=${CIERRE}` },
};

const CAJA: (WalletMovimientoDTO & { origen: OrigenLegibleDTO })[] = [
  {
    id: u(10),
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: "1200.00",
    origenTipo: "cierre_dia",
    origenId: CIERRE,
    descripcion: null,
    registradoPor: USUARIO,
    fechaMovimiento: "2026-09-12T20:00:00.000Z",
    dueno: "propio",
    documento: null,
    origen: ORIGEN,
  },
];

/** Una fila del estado de cuenta con uuid en su destino (viaja, no se pinta). */
function filaEC(n: number, parcial: Partial<FilaEstadoCuentaDTO> = {}): FilaEstadoCuentaDTO {
  return {
    ref: { libro: "tienda", movimientoId: u(n) },
    consolidacionId: null,
    fecha: "2026-09-12",
    categoria: "cobro_manual",
    origenTipo: "manual",
    origen: { texto: "Registrado a mano", enlace: null },
    pago: null,
    descripcion: "Cobro de etiquetas",
    registro: { nombre: "Ana Admin", automatico: null },
    cargo: "500.00",
    abono: null,
    saldoCorrido: "8500.00",
    chip: "cobros",
    anulacion: null,
    esContraAsiento: false,
    tieneComprobante: true,
    anulable: true,
    naceDeUnCierre: false,
    ...parcial,
  };
}

function estadoEC(tipo: EstadoCuentaDTO["cuenta"]["tipo"], id: string, nombre: string, filas: FilaEstadoCuentaDTO[]): EstadoCuentaDTO {
  return {
    cuenta: { tipo, id, nombre },
    saldoActual: "8500.00",
    signo: "positivo",
    sentido: tipo === "bodega" ? "por_entregar" : "ordenex_debe",
    saldoInicial: "0.00",
    abonos: "9000.00",
    cargos: "500.00",
    saldoFinal: "8500.00",
    resumen: null,
    filas,
    total: filas.length,
    page: 1,
    pageSize: 20,
  };
}

/** La composición del selector de cierre que montaban los desgloses (458-A), abierta. */
function SelectorCierre() {
  const cierres = useCierresDeLaCuenta({ cuenta: "tienda", tiendaId: TIENDA });
  return (
    <SelectorBuscable
      id="cierre"
      etiqueta="Cierre"
      opciones={cierres.opciones}
      valor={null}
      onCambiar={vi.fn()}
      onBuscar={cierres.buscar}
      estado={cierres.estado}
      hayMas={cierres.hayMas}
      textos={CIERRE_SELECTOR_TEXTOS}
    />
  );
}

const BODEGA = u(5);

// ── El detector ────────────────────────────────────────────────────────────────────────────────

const ATRIBUTOS_DE_TEXTO = ["aria-label", "placeholder", "title", "aria-valuetext"] as const;

/** Todo lo que la pantalla DICE (a la vista o a un lector de pantalla), con su procedencia. */
export function textosDePantalla(raiz: HTMLElement): { donde: string; texto: string }[] {
  const salida: { donde: string; texto: string }[] = [{ donde: "textContent", texto: raiz.textContent ?? "" }];
  for (const el of Array.from(raiz.querySelectorAll("*"))) {
    for (const a of ATRIBUTOS_DE_TEXTO) {
      const v = el.getAttribute(a);
      if (v) salida.push({ donde: `${el.tagName.toLowerCase()}[${a}]`, texto: v });
    }
    for (const a of ["aria-describedby", "aria-labelledby"]) {
      for (const ref of (el.getAttribute(a) ?? "").split(/\s+/).filter(Boolean)) {
        const t = document.getElementById(ref)?.textContent;
        if (t) salida.push({ donde: `${el.tagName.toLowerCase()}[${a}→${ref}]`, texto: t });
      }
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      // Los `input` ocultos de las primitivas (Select de Base UI) llevan el VALOR del formulario,
      // que no se ve ni se anuncia: `type=hidden` o `aria-hidden` quedan fuera.
      const oculto = (el as HTMLInputElement).type === "hidden" || el.getAttribute("aria-hidden") === "true";
      if (!oculto && el.value) salida.push({ donde: `${el.tagName.toLowerCase()}.value`, texto: el.value });
    }
  }
  return salida;
}

export function uuidsEnPantalla(raiz: HTMLElement): string[] {
  return textosDePantalla(raiz)
    .filter((t) => UUID.test(t.texto))
    .map((t) => `${t.donde}: ${t.texto.match(UUID)?.[0]}`);
}

function conSWR(ui: ReactNode) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

/** Cuántos enlaces llevan un uuid en su dirección: prueba que los datos SÍ traían ids hasta el DOM. */
const enlacesConUuid = () => Array.from(document.querySelectorAll("a[href]")).filter((a) => UUID.test(a.getAttribute("href") ?? "")).length;

beforeEach(() => {
  vi.clearAllMocks();
  H.conceptos.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "cod_recaudado", movimientos: 1 }] });
  H.cierres.mockResolvedValue({
    status: "ok",
    opciones: [{ cierreId: CIERRE, dia: "2026-09-12", hora: "14:00", mensajero: "Juan Pérez Mora", movimientos: 1 }],
    hayMas: false,
  });
  H.estadoCuenta.mockResolvedValue({ status: "forbidden" });
  H.consolidaciones.mockResolvedValue({
    status: "ok",
    items: [
      {
        cierreBodegaId: u(20),
        solicitadoAt: "2026-09-12T20:00:00.000Z",
        totales: { efectivo: "8500.00", simpe: "0.00", transferencia: "0.00", general: "8500.00" },
        montoRecibido: null,
        faltaPorRecibir: "8500.00",
        conciliado: false,
        conciliadoAt: null,
        conciliadoPorNombre: null,
        nota: null,
        cantidadCierres: 1,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  H.previsualizar.mockResolvedValue({
    status: "ok",
    previsualizacion: {
      mensajeroNombre: "Juan Pérez Mora",
      imputable: "4000.00",
      imputableTotal: "4000.00",
      cuentaPorPagar: "4000.00",
      deudaNoImputable: { hay: false, monto: "0.00" },
      recorte: { aplicado: false, tope: 50, enVentana: 1, fuera: 0, montoFuera: "0.00" },
      imputaciones: [
        { cierreId: CIERRE, solicitadoAt: "2026-09-12T20:00:00.000Z", pendienteActual: "4000.00", monto: "1000.00", pendienteDespues: "3000.00", parcial: true },
      ],
      sobrante: "0.00",
      excede: false,
      excluidos: [],
    },
  });
  H.deFila.mockResolvedValue({ status: "ok", data: { movimientos: CAJA, total: 1, page: 1, pageSize: 20 } });
});
afterEach(cleanup);

/** Las superficies de la wallet, cada una con lo que hace falta para que pinte sus filas. */
const SUPERFICIES: { nombre: string; montar: () => Promise<void> }[] = [
  {
    nombre: "/wallet · libro de caja (WalletLedger)",
    montar: async () => {
      conSWR(<WalletLedger movimientos={CAJA} />);
      await screen.findByText(/Cierre del día · 2026-09-12/);
    },
  },
  {
    nombre: "/wallet · detalle de una fila de la composición",
    montar: async () => {
      conSWR(<DetalleFilaComposicion fila="ingreso_flete" etiqueta="Flete" filtros={FILTROS_VACIOS} />);
      await screen.findAllByText(/Cierre del día · 2026-09-12/);
    },
  },
  {
    nombre: "/wallet · filtros del libro (categoría abierta)",
    montar: async () => {
      conSWR(<LibroCajaBarraControlada />);
      await waitFor(() => expect(H.conceptos).toHaveBeenCalled());
    },
  },
  {
    // FICHA 458-D (T D.5): `/mi-wallet` es el estado de cuenta de la tienda, con su selector de cierre
    // (el cierre con uuid en las opciones) y el origen con entidad (uuid SOLO en el `href`).
    nombre: "/mi-wallet · estado de cuenta de la tienda y selector de cierre (cierre con uuid)",
    montar: async () => {
      conSWR(
        <MiEstadoCuenta
          inicial={estadoEC("tienda", TIENDA, "Tania Tienda", [
            filaEC(11, {
              categoria: "cod_recaudado",
              origenTipo: "cierre_dia",
              origen: ORIGEN,
              registro: { nombre: null, automatico: null },
              chip: "cierres",
              naceDeUnCierre: true,
              anulable: false,
              cargo: null,
              abono: "9000.00",
            }),
          ])}
          cierres={{ opciones: [{ cierreId: CIERRE, fecha: "2026-09-12T20:00:00.000Z", movimientos: 1 }], hayMas: false, disponible: true }}
        />,
      );
      await screen.findByText(/Cierre del día · 2026-09-12/);
    },
  },
  {
    nombre: "/wallet/tiendas|mensajeros|satelites · listados que enlazan al estado de cuenta",
    montar: async () => {
      conSWR(
        <>
          <SaldosTiendasTable initialData={{ items: [{ tiendaId: TIENDA, tiendaNombre: "Tania Tienda", saldo: "9000.00", signo: "positivo" }], total: 1, pageSize: 25 }} />
          <CuentasPorPagarTable
            initialData={{
              items: [{ mensajeroId: MENSAJERO, mensajeroNombre: "Juan Pérez Mora", devengado: "4000.00", pagado: "0.00", cuentaPorPagar: "4000.00", signo: "positivo" }],
              total: 1,
              pageSize: 25,
            }}
          />
          <SaldosSatelitesTable
            initialData={{
              items: [
                {
                  zonaId: BODEGA,
                  zonaNombre: "FGAM Puntarenas",
                  saldoSinConciliar: "8500.00",
                  totalEfectivo: "8500.00",
                  totalConsolidado: "8500.00",
                  totalRecibido: "0.00",
                  consolidacionesSinConciliar: 1,
                  diasDeLaMasAntigua: 1,
                  fechaDeLaMasAntigua: "2026-09-12T20:00:00.000Z",
                  ultimaRecibida: null,
                },
              ],
              total: 1,
              pageSize: 25,
            }}
            resumen={null}
          />
        </>,
      );
      await screen.findByRole("link", { name: "Ver estado de cuenta de FGAM Puntarenas" });
    },
  },
  {
    nombre: "/wallet/tiendas/[tiendaId] · estado de cuenta con el panel «Ver» abierto",
    montar: async () => {
      conSWR(<EstadoCuentaTienda inicial={estadoEC("tienda", TIENDA, "Tania Tienda", [filaEC(30), filaEC(31, { anulacion: { motivo: "Duplicado", por: "Ana Admin", fecha: "2026-09-13", hora: "10:30" }, anulable: false })])} puedeRegistrar />);
      fireEvent.click(screen.getAllByRole("button", { name: /^Ver Ordenex le cobra a la tienda/ })[0]);
      await screen.findByRole("dialog");
    },
  },
  {
    nombre: "/wallet/mensajeros/[mensajeroId] · estado de cuenta con el pago del mensajero",
    montar: async () => {
      conSWR(
        <EstadoCuentaMensajero
          inicial={estadoEC("mensajero", MENSAJERO, "Juan Pérez Mora", [
            filaEC(32, { ref: { libro: "mensajero", movimientoId: u(32) }, categoria: "liquidacion", origenTipo: "pago_mensajero", chip: "pagos" }),
          ])}
          puedeRegistrar
        />,
      );
      await waitFor(() => expect(H.previsualizar).toHaveBeenCalled());
    },
  },
  {
    nombre: "/wallet/satelites/[zonaId] · estado de cuenta y conciliación",
    montar: async () => {
      conSWR(
        <EstadoCuentaSatelite
          inicial={estadoEC("bodega", BODEGA, "FGAM Puntarenas", [
            filaEC(33, { ref: null, consolidacionId: u(20), categoria: "declarado", origenTipo: "cierre_bodega", chip: "declarado" }),
          ])}
          puedeConciliar
        />,
      );
      await screen.findByRole("button", { name: /Marcar recibido la consolidación/ });
    },
  },
  {
    nombre: "selector de cierre de una cuenta ABIERTO (la composición de los desgloses retirados)",
    montar: async () => {
      conSWR(<SelectorCierre />);
      fireEvent.click(screen.getByRole("button", { name: /^Cierre:/ }));
      await screen.findByRole("option", { name: /Cierre del 2026-09-12/ });
    },
  },
  {
    nombre: "/wallet/mensajeros · previsualización del reparto (RepartoPrevisualizacion.tsx:119)",
    montar: async () => {
      conSWR(<RepartoPrevisualizacion mensajeroId={MENSAJERO} monto="1000" esperaMs={0} />);
      await screen.findByRole("link", { name: /^Ver el cierre/ });
    },
  },
];

describe("458-A R96 — ninguna superficie de la wallet muestra un identificador interno", () => {
  it.each(SUPERFICIES.map((s) => [s.nombre, s] as const))("%s", async (_n, s) => {
    await s.montar();
    expect(uuidsEnPantalla(document.body)).toEqual([]);
  });

  it("no-vacuidad: se renderizan ≥ 10 superficies y los ids SÍ llegan al DOM (en `href`)", async () => {
    expect(SUPERFICIES.length).toBeGreaterThanOrEqual(10);
    // 458-D: los tres listados enlazan al estado de cuenta con el uuid SOLO en el `href`.
    await SUPERFICIES.find((s) => s.nombre.startsWith("/wallet/tiendas|mensajeros|satelites"))!.montar();
    expect(enlacesConUuid()).toBeGreaterThanOrEqual(3);
  });

  it("CONTRAPRUEBA: el `EnlaceCierre` de antes (uuid en un `sr-only`) la pone roja", () => {
    render(
      <a href={`/cierres-admin?cierre=${CIERRE}`}>
        Ver el cierre
        <span className="sr-only">{` (${CIERRE})`}</span>
      </a>,
    );
    expect(uuidsEnPantalla(document.body)).toEqual([`textContent: ${CIERRE}`]);
  });

  it("contraprueba: también caza el uuid en un `aria-label`, un `placeholder`, un `value` y un `aria-describedby`", () => {
    render(
      <div>
        <button aria-label={`Abrir ${CIERRE}`} />
        <input placeholder={CIERRE} readOnly />
        <input defaultValue={CIERRE} />
        <input aria-describedby="ayuda" />
        <p id="ayuda" hidden>{CIERRE}</p>
      </div>,
    );
    const donde = uuidsEnPantalla(document.body).map((h) => h.split(":")[0]);
    expect(donde).toEqual(
      expect.arrayContaining(["button[aria-label]", "input[placeholder]", "input.value", "input[aria-describedby→ayuda]"]),
    );
  });
});
