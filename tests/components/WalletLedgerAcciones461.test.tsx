// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 461 (T C.5, design §5.4/§9, R20/R21/R37/R42/R52) — LA LÍNEA DEL COBRO EN EL LIBRO DE LA CAJA
// =================================================================================================
//
// R20: «Anular…» (con motivo obligatorio) en la línea ORIGINAL de cada cobro vigente —propia o
// completada por la migración de datos (R37)—; «Anulado» en las ya anuladas; NADA en el reverso, en
// la salida de un cobro reclasificado ni en las líneas del cierre. R21: tras anular, el módulo relee.
// R17: `no_anulable` se dice con su motivo. R42: los rótulos son los nombres desde Ordenex, en la
// tabla y en la descarga, con dueño «Ordenex». R52: ningún identificador interno en pantalla ni en el
// archivo.
//
// Quién decide qué fila tiene documento es el SERVIDOR (`WalletMovimientoDTO.documento`, resuelto en
// `WalletService`; `cobro-tienda-461.test.ts` mide qué filas lo reciben). Aquí se mide que la pantalla
// OBEDECE al campo y que la acción manda lo que el borde espera: `{ cobroId, motivo }`, sin monto.
//
// Y la P3 de la auditoría de la wallet: un gasto o sueldo registrado a mano cuyo reverso ya existe
// dice «Reversado» en vez de ofrecer «Reversar».

const anularCobroMock = vi.fn();
const anularPagoMock = vi.fn();
const anularAporteMock = vi.fn();
const anularAjusteMock = vi.fn();
const reversarMock = vi.fn();

vi.mock("@/lib/actions/wallet-tienda", () => ({
  anularCobroTiendaAction: (...a: unknown[]) => anularCobroMock(...a),
}));
vi.mock("@/lib/actions/pago-por-cuenta-tienda", () => ({
  anularPagoPorCuentaTiendaAction: (...a: unknown[]) => anularPagoMock(...a),
  obtenerComprobantePagoPorCuentaAction: vi.fn(),
}));
vi.mock("@/lib/actions/aporte-capital", () => ({
  anularAporteCapitalAction: (...a: unknown[]) => anularAporteMock(...a),
  obtenerComprobanteAporteCapitalAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet", () => ({
  anularAjusteCajaAction: (...a: unknown[]) => anularAjusteMock(...a),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: (...a: unknown[]) => reversarMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const successMock = vi.fn();
const errorMock = vi.fn();
const infoMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: infoMock,
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import {
  COLUMNAS_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { opcionesDeConceptos } from "@/components/shared/wallet/conceptos-filtro";
import { CATEGORIA_LABEL as CATEGORIA_LABEL_458, CATEGORIA_TODAS_OPTION } from "@/app/(app)/wallet/_components/wallet-labels";

/** Los DÉBITOS de la tienda (el `origenId` de cada línea de caja del cobro): uuids que NUNCA se pintan. */
const COBRO_ID = "3f1c2a7e-9b41-4d6e-8c2f-0a5b7d9e1f23";
const COBRO_COMPLETADO_ID = "8a4d6f2b-1c3e-4f5a-9b7d-2e6c8a0f4b91";
const COBRO_ANULADO_ID = "c5e7a9b1-3d5f-4a7c-8e9b-1f3d5a7c9e2b";
const COBRO_RECLASIFICADO_ID = "e2b4d6f8-5a7c-4e9b-8d1f-3a5c7e9b1d4f";

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: "m-0000",
    tipo: "ingreso",
    categoria: "ingreso_cobro_tienda",
    monto: "42000.00",
    origenTipo: "cobro_tienda",
    origenId: COBRO_ID,
    descripcion: "Tienda Norte · Material de despacho",
    registradoPor: null,
    fechaMovimiento: "2026-09-25T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

/** La línea de caja de un cobro VIGENTE escrito por el servicio (origen `cobro_tienda`). */
const COBRO_VIGENTE = fila({
  id: "m-cobro",
  documento: { tipo: "cobro_tienda", anulado: false, tieneComprobante: false },
});
/** La línea COMPLETADA por la migración de datos (origen `cobro_tienda_completado`), vigente (R37). */
const COBRO_COMPLETADO = fila({
  id: "m-completado",
  origenTipo: "cobro_tienda_completado",
  origenId: COBRO_COMPLETADO_ID,
  monto: "2500.50",
  descripcion: "Tienda Sur · Bolsas",
  fechaMovimiento: "2026-09-10T15:00:00.000Z",
  documento: { tipo: "cobro_tienda", anulado: false, tieneComprobante: false },
});
/** La línea de un cobro ya ANULADO. */
const COBRO_ANULADO = fila({
  id: "m-anulado",
  origenId: COBRO_ANULADO_ID,
  monto: "1000.00",
  descripcion: "Tienda Este · Etiquetas",
  fechaMovimiento: "2026-09-20T15:00:00.000Z",
  documento: { tipo: "cobro_tienda", anulado: true, tieneComprobante: false },
});
/** Su reverso: egreso propio de liquidez «cargo», SIN documento (R20). */
const REVERSO = fila({
  id: "m-reverso",
  tipo: "egreso",
  categoria: "egreso_reverso_cobro_tienda",
  origenId: COBRO_ANULADO_ID,
  monto: "1000.00",
  descripcion: "Anulación · Tienda Este · Etiquetas",
  fechaMovimiento: "2026-09-24T15:00:00.000Z",
});
/** La salida de un cobro RECLASIFICADO por la 459: otra categoría, otro origen, SIN documento (R20). */
const RECLASIFICADO = fila({
  id: "m-reclasificado",
  tipo: "egreso",
  categoria: "egreso_pago_por_cuenta_tienda",
  origenTipo: "cobro_manual_reclasificado",
  origenId: COBRO_RECLASIFICADO_ID,
  dueno: "terceros",
  descripcion: "Nuform · pago FACEBOOK",
  fechaMovimiento: "2026-09-01T15:00:00.000Z",
});
/** Una línea automática del cierre: sin documento, sin acciones. */
const FLETE_DEL_CIERRE = fila({
  id: "m-flete",
  categoria: "ingreso_flete",
  origenTipo: "cierre_dia",
  origenId: "11111111-1111-4111-8111-111111111111",
  monto: "2800.00",
  descripcion: null,
  fechaMovimiento: "2026-09-22T15:00:00.000Z",
});

const TODAS = [COBRO_VIGENTE, COBRO_COMPLETADO, COBRO_ANULADO, REVERSO, RECLASIFICADO, FLETE_DEL_CIERRE];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── R69/R70/R71 — la CORRECCIÓN DE CAJA ofrece «Anular…» (recorrido_461 F1) ──────────────────────
//
// La corrección es su PROPIO documento: origen `manual`, `origenId` null a propósito, y el servidor
// la marca con `documento.tipo = "ajuste_caja"`. El id que la action espera (`anularAjusteCajaSchema`
// → `{ movimientoId, motivo }`) es el de la FILA, no `origenId`. F1: el componente leía `origenId`
// para todos los tipos y, al ser null, no pintaba nada; ni maestro ni admin podían anularla.



// ── R42/R52 — rótulos y dueño, en la tabla y en la descarga ────────────────────────────────────

/** Lo que tiene que leerse en cada fila: concepto, tipo, origen legible y dueño (design §7). */
const ESPERADO: ReadonlyArray<{
  caso: string;
  movimiento: WalletMovimientoDTO;
  concepto: string;
  tipo: string;
  origen: string;
  dueno: string;
}> = [
  {
    caso: "la línea del cobro (propia)",
    movimiento: COBRO_VIGENTE,
    concepto: "Ordenex le cobra a una tienda",
    tipo: "Entra", // 458-E (R55): la dirección se dice Entra / Sale (antes «Ingreso»)
    origen: "Cobro de Ordenex a una tienda · Tienda Norte · Material de despacho",
    dueno: "Ordenex",
  },
  {
    caso: "la línea completada por la migración de datos",
    movimiento: COBRO_COMPLETADO,
    concepto: "Ordenex le cobra a una tienda",
    tipo: "Entra", // 458-E (R55): la dirección se dice Entra / Sale (antes «Ingreso»)
    origen: "Cobro de Ordenex a una tienda (línea de caja completada al corregir) · Tienda Sur · Bolsas",
    dueno: "Ordenex",
  },
  {
    caso: "el reverso de un cobro anulado",
    movimiento: REVERSO,
    concepto: "Cobro a una tienda anulado",
    tipo: "Sale", // 458-E (R55): antes «Egreso»
    origen: "Cobro de Ordenex a una tienda · Anulación · Tienda Este · Etiquetas",
    dueno: "Ordenex",
  },
  {
    caso: "la salida de un cobro reclasificado por la 459",
    movimiento: RECLASIFICADO,
    concepto: "Ordenex paga un gasto de una tienda",
    tipo: "Sale", // 458-E (R55): antes «Egreso»
    origen: "Cobro reclasificado como pago de un gasto de la tienda · Nuform · pago FACEBOOK",
    dueno: "Tienda",
  },
];

describe("461 — concepto, tipo, origen y dueño de las líneas del cobro (R42, design §7.2/§7.3)", () => {
  it.each(ESPERADO)("tabla — $caso: «$concepto» · $tipo · «$origen» · «$dueno»", (e) => {
    render(<WalletLedger movimientos={[e.movimiento]} />);
    const f = screen.getAllByRole("row")[1];
    expect(within(f).getByText(e.concepto)).toBeInTheDocument();
    expect(within(f).getByText(e.tipo)).toBeInTheDocument();
    expect(within(f).getByText(e.origen)).toBeInTheDocument();
    expect(within(f).getByText(e.dueno)).toBeInTheDocument();
    // Ningún valor crudo del enum se asoma en la fila.
    expect(f.textContent ?? "").not.toMatch(/[a-z]+_[a-z_]+/);
  });

  it.each(ESPERADO)("descarga — $caso: las mismas palabras que la tabla, sin columnas de más", (e) => {
    const d = filaDescargaMovimientoCaja(e.movimiento);
    expect(d.categoria).toBe(e.concepto);
    expect(d.tipo).toBe(e.tipo);
    expect(d.origen).toBe(e.origen);
    expect(d.dueno).toBe(e.dueno);
    expect(d.monto).toBe(e.movimiento.monto);
    expect(Object.keys(d).sort()).toEqual(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave).sort());
  });

  it("el filtro por concepto del libro ofrece los dos conceptos nuevos con su nombre desde Ordenex", () => {
    // 458-A (TA.3): las opciones son los conceptos CON movimientos (aquí, uno de cada uno).
    const lista = opcionesDeConceptos(
      ["ingreso_cobro_tienda","egreso_reverso_cobro_tienda"].map((categoria) => ({ categoria, movimientos: 1 })),
      CATEGORIA_LABEL_458,
      "",
      CATEGORIA_TODAS_OPTION,
    );
    const opciones = new Map(lista.map((o) => [o.value, o.label.replace(/ \(1\)$/, "")]));
    expect(opciones.get("ingreso_cobro_tienda")).toBe("Ordenex le cobra a una tienda");
    expect(opciones.get("egreso_reverso_cobro_tienda")).toBe("Cobro a una tienda anulado");
  });

  it("la fecha de cada línea es el día de Costa Rica del instante", () => {
    render(<WalletLedger movimientos={[fila({ fechaMovimiento: "2026-09-26T05:30:00.000Z" })]} />);
    // 05:30Z del 26 son las 23:30 del 25 en Costa Rica.
    expect(within(screen.getAllByRole("row")[1]).getByText("2026-09-25")).toBeInTheDocument();
  });
});

describe("461 — ningún identificador interno en pantalla ni en la descarga (R52)", () => {
  it("la tabla no pinta el id del débito, del movimiento ni del cierre, tampoco en los nombres accesibles", () => {
    render(<WalletLedger movimientos={TODAS} />);
    const texto = document.body.textContent ?? "";
    const ids = [
      COBRO_ID,
      COBRO_COMPLETADO_ID,
      COBRO_ANULADO_ID,
      COBRO_RECLASIFICADO_ID,
      ...TODAS.map((m) => m.id),
      ...TODAS.map((m) => m.origenId ?? ""),
    ].filter((id) => id !== "");
    for (const id of ids) expect(texto).not.toContain(id);
    for (const nodo of document.querySelectorAll("[aria-label]")) {
      const nombre = nodo.getAttribute("aria-label") ?? "";
      for (const id of ids) expect(nombre).not.toContain(id);
    }
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("la descarga no gana columnas por el documento y no lleva ningún uuid", () => {
    for (const m of TODAS) {
      const f = filaDescargaMovimientoCaja(m);
      const valores = Object.values(f).join(" | ");
      expect(valores).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      expect(valores).not.toMatch(/tieneComprobante|anulado":|documento/i);
    }
  });
});

// ── P3 de la auditoría de la wallet — «Reversar» sobre un egreso ya reversado ──────────────────
