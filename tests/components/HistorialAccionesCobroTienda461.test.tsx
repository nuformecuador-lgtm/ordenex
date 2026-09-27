// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { HistorialAccionDTO, ListarHistorialAccionesResult } from "@/lib/types/historial-accion";

// =================================================================================================
// FICHA 461 (T C.7, design §7.7, R51/R55) — EL HISTORIAL MUESTRA Y FILTRA LA ANULACIÓN DE UN COBRO
// =================================================================================================
//
// R51: la pantalla del historial muestra los tipos que esta ficha toca con los textos de design §7.7
// y permite filtrar por el tipo nuevo (`cobro_tienda_anulado`). R55: la fila lleva quién, cuándo, el
// importe y el nombre de la tienda, y ningún texto libre ni identificador interno.
//
// Los textos van ESCRITOS A MANO (contrato); el catálogo del que salen se mide en
// `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`. Aquí se mide la PANTALLA: que el
// filtro «Acción» los OFRECE y que la tabla los PINTA sin traducirlos del valor técnico.

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
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

const { listarMock, completoMock, catalogoMock } = vi.hoisted(() => ({
  listarMock: vi.fn(),
  completoMock: vi.fn(),
  catalogoMock: vi.fn(),
}));
vi.mock("@/lib/actions/historial-acciones", () => ({
  listarHistorialAccionesPaginado: listarMock,
  listarHistorialAccionesCompleto: completoMock,
  obtenerCatalogoActoresHistorial: catalogoMock,
}));

import { HistorialAccionesModule } from "@/app/(app)/historico/acciones/_components/HistorialAccionesModule";
import {
  CLAVE_ACCION,
  construirFiltrosHistorialAcciones,
} from "@/app/(app)/historico/acciones/_components/historial-acciones-filtros-def";

const AHORA = new Date("2026-09-25T18:00:00Z");
const COBRO_ID = "3f1c2a7e-9b41-4d6e-8c2f-0a5b7d9e1f23";

/** design §7.7 — los textos del historial que esta ficha toca, tal como los ve la persona. */
const TEXTOS_461: ReadonlyArray<readonly [tipo: string, texto: string]> = [
  ["cobro_tienda_registrado", "Le cobró a una tienda"],
  ["cobro_tienda_anulado", "Anuló un cobro a una tienda"],
  ["wallet_movimiento_manual_anulado", "Anuló una corrección de caja"],
  ["pago_por_cuenta_tienda_registrado", "Pagó un gasto de una tienda"],
  ["pago_por_cuenta_tienda_anulado", "Anuló el pago de un gasto de una tienda"],
  ["aporte_capital_registrado", "Registró un aporte de dinero a la caja"],
  ["aporte_capital_anulado", "Anuló un aporte de dinero a la caja"],
];

/** La fila que deja `CobroTiendaAnulacionRepository.anular` (R55), tal como la sirve el borde. */
function filaAnulacion(extra: Partial<HistorialAccionDTO> = {}): HistorialAccionDTO {
  return {
    id: "f-461",
    // 22:30Z del 25 = 16:30 del 25 en Costa Rica.
    fecha: "2026-09-25T22:30:00.000Z",
    accion: "cobro_tienda_anulado",
    accionLabel: "Anuló un cobro a una tienda",
    categoria: "mueve_dinero",
    entidadTipo: "wallet_tienda_movimiento",
    entidadEtiqueta: "Tienda Norte",
    actorNombre: "Ana Mora",
    actorRol: "admin",
    monto: "42000.00",
    valorAnterior: null,
    valorNuevo: null,
    loteId: "l-461",
    ...extra,
  };
}

function ok(items: HistorialAccionDTO[]): ListarHistorialAccionesResult {
  return { status: "ok", items, page: 1, pageSize: 25, total: items.length };
}

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue(ok([filaAnulacion()]));
  completoMock.mockResolvedValue({ status: "ok", items: [filaAnulacion()] });
});

afterEach(() => cleanup());

describe("461 R51 — el filtro «Acción» ofrece la anulación del cobro y los tipos renombrados", () => {
  it("cada tipo que la ficha toca está entre las opciones, con su texto de design §7.7", () => {
    const accion = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (d) => d.key === CLAVE_ACCION,
    );
    expect(accion, "la barra ya no declara el filtro por acción").toBeDefined();
    const opciones = new Map((accion?.options ?? []).map((o) => [o.value, o.label]));
    for (const [tipo, texto] of TEXTOS_461) {
      expect(opciones.get(tipo), tipo).toBe(texto);
    }
    // Anti-vacuidad: es la lista ENTERA del catálogo, no un puñado.
    expect(opciones.size).toBeGreaterThan(40);
  });

  it("ningún texto del filtro es un nombre retirado por la 461 (design §7.9)", () => {
    const accion = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (d) => d.key === CLAVE_ACCION,
    );
    const textos = (accion?.options ?? []).map((o) => o.label);
    for (const retirado of [
      "Cobró un costo a una tienda",
      "Registró un pago por cuenta de una tienda",
      "Anuló un pago por cuenta de una tienda",
      "Registró un saldo inicial o aporte",
      "Anuló un saldo inicial o aporte",
    ]) {
      expect(textos).not.toContain(retirado);
    }
    for (const texto of textos) expect(texto).not.toMatch(/_/);
  });
});

describe("461 R55 — la fila de la anulación de un cobro en la tabla", () => {
  it("pinta quién, qué, sobre qué (la tienda), el importe y el día de Costa Rica; nada técnico", async () => {
    renderModule(<HistorialAccionesModule actores={[]} ahora={AHORA} debounceMs={0} />);

    expect(await screen.findByText("Anuló un cobro a una tienda")).toBeInTheDocument();
    const fila = screen.getByText("Anuló un cobro a una tienda").closest("tr") as HTMLElement;
    expect(within(fila).getByText("Ana Mora")).toBeInTheDocument();
    expect(within(fila).getByText("Mueve dinero")).toBeInTheDocument();
    expect(within(fila).getByText("Movimiento de tienda")).toBeInTheDocument();
    expect(within(fila).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(fila).getByText("₡42.000")).toBeInTheDocument();
    // El instante en hora de Costa Rica (22:30Z = 4:30 p. m. del 25 en CR), no en UTC.
    expect(fila.textContent ?? "").toContain("25 sept 2026");
    expect(fila.textContent ?? "").toContain("4:30");
    expect(fila.textContent ?? "").not.toContain("10:30");
    // Ni el valor técnico del tipo ni ningún identificador interno.
    expect(fila.textContent ?? "").not.toMatch(/cobro_tienda_anulado|wallet_tienda_movimiento/);
    expect(document.body.textContent ?? "").not.toContain(COBRO_ID);
  });

  it("la fila del registro del cobro se conserva con su texto («Le cobró a una tienda»)", async () => {
    listarMock.mockResolvedValue(
      ok([
        filaAnulacion({
          id: "f-reg",
          accion: "cobro_tienda_registrado",
          accionLabel: "Le cobró a una tienda",
          fecha: "2026-09-24T15:00:00.000Z",
        }),
        filaAnulacion(),
      ]),
    );
    renderModule(<HistorialAccionesModule actores={[]} ahora={AHORA} debounceMs={0} />);
    expect(await screen.findByText("Le cobró a una tienda")).toBeInTheDocument();
    expect(screen.getByText("Anuló un cobro a una tienda")).toBeInTheDocument();
  });
});
