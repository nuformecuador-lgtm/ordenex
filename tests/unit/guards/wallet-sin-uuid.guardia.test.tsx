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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import type { OrigenLegibleDTO } from "@/lib/types/wallet-origen";

const H = vi.hoisted(() => ({
  conceptos: vi.fn(),
  cierres: vi.fn(),
  desgloseTienda: vi.fn(),
  desgloseMensajero: vi.fn(),
  previsualizar: vi.fn(),
  deFila: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => H.conceptos(...a),
  cierresDeLaCuentaAction: (...a: unknown[]) => H.cierres(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => H.desgloseTienda(...a),
  listarMovimientosDeTiendaCompletoAction: vi.fn(),
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarPagosDeMensajeroAction: (...a: unknown[]) => H.desgloseMensajero(...a),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
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
import { WalletFiltros } from "@/app/(app)/wallet/_components/WalletFiltros";
import { DetalleFilaComposicion } from "@/app/(app)/wallet/_components/DetalleFilaComposicion";
import { FILTROS_VACIOS } from "@/app/(app)/wallet/_components/WalletFiltros";
import { DesgloseTiendaLedger } from "@/app/(app)/mi-wallet/_components/DesgloseTiendaLedger";
import { MiWalletFiltros } from "@/app/(app)/mi-wallet/_components/MiWalletFiltros";
import { DesgloseMovimientosTienda } from "@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda";
import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
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
const TIENDA_FILAS: (WalletTiendaMovimientoDTO & { origen: OrigenLegibleDTO })[] = [
  {
    id: u(11),
    tiendaId: TIENDA,
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: "9000.00",
    origenTipo: "cierre_dia",
    origenId: CIERRE,
    descripcion: null,
    fechaMovimiento: "2026-09-12T20:00:00.000Z",
    origen: ORIGEN,
  },
];
const MENSAJERO_FILAS: (PagoMensajeroMovimientoDTO & { origen: OrigenLegibleDTO })[] = [
  {
    id: u(12),
    mensajeroId: MENSAJERO,
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: "4000.00",
    origenTipo: "cierre_dia",
    origenId: CIERRE,
    descripcion: null,
    fechaMovimiento: "2026-09-12T20:00:00.000Z",
    cierreId: CIERRE,
    origen: ORIGEN,
  },
];

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
  H.desgloseTienda.mockResolvedValue({
    status: "ok",
    data: {
      tiendaId: TIENDA,
      movimientos: TIENDA_FILAS,
      total: 1,
      page: 1,
      pageSize: 20,
      desglose: { aFavor: "9000.00", cargos: "0.00", pagado: "0.00", saldo: "9000.00", signo: "positivo" },
    },
  });
  H.desgloseMensajero.mockResolvedValue({
    status: "ok",
    data: {
      movimientos: MENSAJERO_FILAS,
      total: 1,
      page: 1,
      pageSize: 20,
      cuenta: { devengado: "4000.00", pagado: "0.00", cuentaPorPagar: "4000.00", signo: "positivo" },
    },
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
    nombre: "/wallet · filtros (categoría abierta)",
    montar: async () => {
      conSWR(<WalletFiltros onAplicar={vi.fn()} onLimpiar={vi.fn()} />);
      await waitFor(() => expect(H.conceptos).toHaveBeenCalled());
    },
  },
  {
    nombre: "/mi-wallet · libro de la tienda y filtros (cierre con uuid)",
    montar: async () => {
      conSWR(
        <>
          <MiWalletFiltros
            onAplicar={vi.fn()}
            onLimpiar={vi.fn()}
            cierres={{ opciones: [{ cierreId: CIERRE, fecha: "2026-09-12T20:00:00.000Z", movimientos: 1 }], hayMas: false, disponible: true }}
          />
          <DesgloseTiendaLedger movimientos={TIENDA_FILAS} />
        </>,
      );
      await screen.findByText(/Cierre del día · 2026-09-12/);
    },
  },
  {
    nombre: "/wallet/tiendas · desglose con el selector de cierre ABIERTO",
    montar: async () => {
      conSWR(
        <DesgloseMovimientosTienda resumen={{ tiendaId: TIENDA, tiendaNombre: "Tania Tienda", saldo: "9000.00", signo: "positivo" }} />,
      );
      await screen.findByText(/Cierre del día · 2026-09-12/);
      fireEvent.click(screen.getByRole("button", { name: /^Cierre:/ }));
      await screen.findByRole("option", { name: /Cierre del 2026-09-12/ });
    },
  },
  {
    nombre: "/wallet/mensajeros · desglose (Ver el cierre) con el selector ABIERTO",
    montar: async () => {
      conSWR(
        <DesglosePagosMensajero
          resumen={{ mensajeroId: MENSAJERO, mensajeroNombre: "Juan Pérez Mora", devengado: "4000.00", pagado: "0.00", cuentaPorPagar: "4000.00", signo: "positivo" }}
        />,
      );
      await screen.findAllByRole("link", { name: /^Ver el cierre/ });
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

  it("no-vacuidad: se renderizan ≥ 7 superficies y los ids SÍ llegan al DOM (en `href`)", async () => {
    expect(SUPERFICIES.length).toBeGreaterThanOrEqual(7);
    await SUPERFICIES.find((s) => s.nombre.startsWith("/wallet/mensajeros · desglose"))!.montar();
    expect(enlacesConUuid()).toBeGreaterThanOrEqual(2); // origen + «Ver el cierre»
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
