// @vitest-environment jsdom
// Feature 293 (T5.4, R34) — **«Premio del ranking» se lee así en las DOS superficies que
// quedan**: el desglose del maestro (`/wallet/mensajeros`) y el archivo que sale de él.
//
// Eran CUATRO. La ficha 336 (2026-08-30) borró `/mis-pagos`, y con ella se fueron las otras dos
// —el desglose del propio mensajero y su descarga— junto al mapa de rótulos `mis-pagos-labels`.
// El número está escrito aquí a propósito: si mañana vuelve a bajar sin que nadie nombre la
// pantalla que desapareció, es que el archivo dejó de cubrir lo que dice cubrir.
//
// Es literalmente lo que el humano pidió ver: «que en el detalle se vea QUÉ PARTE de la cuenta
// es premio» (decisión (d) de la ficha). Por eso la categoría es propia y no se reusó
// `ajuste_devengo`, que se rotula «Ajuste (devengo)» y donde ya viven los contraasientos de la
// anulación de liquidaciones: mezclados, la pregunta no se puede responder sin leer
// descripciones a ojo.
//
// **Las aserciones van contra el LITERAL**, nunca contra `CATEGORIA_PAGO_LABEL[...]`. Comparar
// un texto con la función que lo genera está verde por construcción —ya pasó en este repo— y
// dejaría pasar exactamente el fallo que este archivo persigue: que el premio se rotule igual
// que un ajuste.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import type {
  CuentaPorPagarResumenDTO,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

/** El rótulo, escrito a mano. Si alguien lo cambia, este archivo se pone rojo y lo dice. */
const ROTULO_PREMIO = "Premio del ranking";
/** El del ajuste, con el que NO se puede confundir (decisión (d)). */
const ROTULO_AJUSTE_DEVENGO = "Ajuste (devengo)";

const { desgloseMock, previsualizarMock } = vi.hoisted(() => ({
  desgloseMock: vi.fn(),
  previsualizarMock: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarPagosDeMensajeroAction: (...args: unknown[]) => desgloseMock(...args),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));

vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...args: unknown[]) => previsualizarMock(...args),
  registrarRepartoMensajeroAction: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";
import { filaDescargaDesgloseMensajero } from "@/app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas";
import { CATEGORIA_PAGO_LABEL as CATEGORIA_MAESTRO } from "@/app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels";

// --- Datos ---------------------------------------------------------------

const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const RESUMEN: CuentaPorPagarResumenDTO = {
  mensajeroId: MENSAJERO,
  mensajeroNombre: "Kevin Rojas",
  devengado: "5000.00",
  pagado: "0.00",
  cuentaPorPagar: "5000.00",
  signo: "positivo",
};

/**
 * El movimiento del premio tal como lo escribe el servicio (design §7.1): devengo, categoría
 * propia, origen `cierre_dia` con el CIERRE en `origen_id` —de ahí sale el `cierreId` que el
 * servidor deriva— y la descripción con el día del podio y la posición.
 */
const PREMIO: PagoMensajeroMovimientoDTO = {
  id: "mov-premio",
  mensajeroId: MENSAJERO,
  tipo: "devengo",
  categoria: "premio_ranking",
  monto: "5000.00",
  origenTipo: "cierre_dia",
  origenId: CIERRE,
  descripcion: "Premio del ranking 2026-08-26 · posición 1 · Bono por buen rendimiento",
  fechaMovimiento: "2026-08-27T14:00:00.000Z",
  cierreId: CIERRE,
};

/** Un ajuste manual, para que el rótulo del premio tenga con qué NO confundirse. */
const AJUSTE: PagoMensajeroMovimientoDTO = {
  id: "mov-ajuste",
  mensajeroId: MENSAJERO,
  tipo: "devengo",
  categoria: "ajuste_devengo",
  monto: "500.00",
  origenTipo: "manual",
  origenId: null,
  descripcion: "Ajuste manual",
  fechaMovimiento: "2026-08-27T15:00:00.000Z",
  cierreId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  desgloseMock.mockResolvedValue({
    status: "ok",
    data: {
      movimientos: [PREMIO, AJUSTE],
      total: 2,
      page: 1,
      pageSize: 20,
      cuenta: {
        devengado: "5500.00",
        pagado: "0.00",
        cuentaPorPagar: "5500.00",
        signo: "positivo",
      },
    },
  });
  previsualizarMock.mockResolvedValue({
    status: "ok",
    previsualizacion: {
      mensajeroNombre: "Kevin Rojas",
      imputable: "5000.00",
      imputableTotal: "5000.00",
      cuentaPorPagar: "5500.00",
      deudaNoImputable: { hay: false, monto: "0.00" },
      recorte: { aplicado: false, tope: 3, enVentana: 1, fuera: 0, montoFuera: "0.00" },
      imputaciones: [],
      sobrante: "0.00",
      excede: false,
      excluidos: [],
    },
  });
});

afterEach(() => {
  cleanup();
});

// =========================================================================

describe("R34 — el desglose del MAESTRO rotula el premio y lo pone bajo su cierre", () => {
  it("la fila del premio dice «Premio del ranking», con su importe y su enlace al cierre", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DesglosePagosMensajero resumen={RESUMEN} />
      </SWRConfig>,
    );

    const tabla = await screen.findByRole("table", {
      name: "Desglose por cierre de Kevin Rojas",
    });
    const celda = await within(tabla).findByText(ROTULO_PREMIO);
    const fila = celda.closest("tr") as HTMLElement;

    // Money-safe: el STRING del servidor, formateado y nada más (feature 230: sin céntimos).
    expect(within(fila).getByText("₡5.000")).toBeInTheDocument();
    // R34 — «bajo el cierre al que se imputaron»: la fila lleva el enlace a SU cierre, que es
    // lo que hace que el filtro por cierre del desglose la encuentre.
    expect(within(fila).getByRole("link", { name: /^Ver el cierre/ })).toHaveAttribute(
      "href",
      `/cierres-admin?cierre=${CIERRE}`,
    );
    // Y la descripción congelada (R22) se lee junto al origen.
    expect(
      within(fila).getByText(/Premio del ranking 2026-08-26 · posición 1/),
    ).toBeInTheDocument();
  });

  it("no se confunde con un ajuste: los dos rótulos conviven y son distintos", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DesglosePagosMensajero resumen={RESUMEN} />
      </SWRConfig>,
    );

    const tabla = await screen.findByRole("table", {
      name: "Desglose por cierre de Kevin Rojas",
    });
    await within(tabla).findByText(ROTULO_PREMIO);
    expect(within(tabla).getByText(ROTULO_AJUSTE_DEVENGO)).toBeInTheDocument();
    // La pregunta del humano —«qué parte de esta cuenta es premio»— se puede responder mirando.
    expect(ROTULO_PREMIO).not.toBe(ROTULO_AJUSTE_DEVENGO);
  });
});

describe("R34 — la descarga lleva el mismo rótulo que la pantalla", () => {
  it("la del desglose del maestro emite «Premio del ranking» en la columna concepto", () => {
    const fila = filaDescargaDesgloseMensajero(PREMIO);
    expect(fila.concepto).toBe(ROTULO_PREMIO);
    // Money-safe (R7 de la 170): el monto sale como el STRING del servidor, sin símbolo.
    expect(fila.monto).toBe("5000.00");
  });

  it("y no lo confunde con un ajuste", () => {
    expect(filaDescargaDesgloseMensajero(AJUSTE).concepto).toBe(ROTULO_AJUSTE_DEVENGO);
  });
});

describe("T1.6 — el mapa de rótulos dice «Premio del ranking», y no lo que dice el ajuste", () => {
  // Eran DOS mapas y se comparaban entre sí; `mis-pagos-labels` se fue con la pantalla (336).
  // El que queda se afirma contra el LITERAL, que es como estaba escrito el requisito: comparar
  // un mapa con el otro nunca dijo cuál era el texto, solo que coincidían.
  it("wallet-mensajeros-labels rotula `premio_ranking` como «Premio del ranking»", () => {
    expect(CATEGORIA_MAESTRO.premio_ranking).toBe(ROTULO_PREMIO);
    // El requisito no es «tiene rótulo», es «tiene un rótulo DISTINGUIBLE del de los ajustes».
    expect(CATEGORIA_MAESTRO.premio_ranking).not.toBe(CATEGORIA_MAESTRO.ajuste_devengo);
    expect(CATEGORIA_MAESTRO.premio_ranking).not.toBe(CATEGORIA_MAESTRO.ajuste_pago);
  });
});
