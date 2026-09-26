// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { HistorialAccionDTO, ListarHistorialAccionesResult } from "@/lib/types/historial-accion";

// =================================================================================================
// FICHA 457 (T6.7, design §9; R61–R64) — EL HISTORIAL MUESTRA Y FILTRA EL PAGO DE UNA TIENDA A ORDENEX
// =================================================================================================
//
// R64: la pantalla del historial permite filtrar por los dos tipos nuevos y los muestra con un texto
// legible (design §2). R61–R63: la fila lleva quién, cuándo, el importe y el nombre de la tienda, y
// NINGÚN texto libre (motivo, referencia) ni identificador interno.
//
// Los textos van ESCRITOS A MANO (contrato); el catálogo se mide en
// `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`. Aquí se mide la PANTALLA.

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
const ABONO_ID = "5b7d9f1a-3c5e-4a7b-9d1f-3a5c7e9b1d2f";

/** design §2 — los dos textos del historial de esta ficha, tal como los ve la persona. */
const TEXTOS_457: ReadonlyArray<readonly [tipo: string, texto: string]> = [
  ["abono_tienda_registrado", "Registró un pago de una tienda a Ordenex"],
  ["abono_tienda_anulado", "Anuló un pago de una tienda a Ordenex"],
];

/** La fila que deja `AbonoTiendaRepository.crear` (R61), tal como la sirve el borde. */
function filaRegistro(extra: Partial<HistorialAccionDTO> = {}): HistorialAccionDTO {
  return {
    id: "f-457",
    // 22:30Z del 25 = 16:30 del 25 en Costa Rica.
    fecha: "2026-09-25T22:30:00.000Z",
    accion: "abono_tienda_registrado",
    accionLabel: "Registró un pago de una tienda a Ordenex",
    categoria: "mueve_dinero",
    entidadTipo: "abono_tienda",
    entidadEtiqueta: "Tienda Norte",
    actorNombre: "Ana Mora",
    actorRol: "maestro",
    monto: "4000.00",
    valorAnterior: null,
    valorNuevo: null,
    loteId: "l-457",
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
  listarMock.mockResolvedValue(ok([filaRegistro()]));
  completoMock.mockResolvedValue({ status: "ok", items: [filaRegistro()] });
});

afterEach(() => cleanup());

describe("457 R64 — el filtro «Acción» ofrece los dos tipos del pago de una tienda", () => {
  it("cada tipo está entre las opciones, con su texto de design §2", () => {
    const accion = construirFiltrosHistorialAcciones([], { ahora: AHORA }).find(
      (d) => d.key === CLAVE_ACCION,
    );
    expect(accion, "la barra ya no declara el filtro por acción").toBeDefined();
    const opciones = new Map((accion?.options ?? []).map((o) => [o.value, o.label]));
    for (const [tipo, texto] of TEXTOS_457) {
      expect(opciones.get(tipo), tipo).toBe(texto);
    }
    // Anti-vacuidad: es la lista ENTERA del catálogo.
    expect(opciones.size).toBeGreaterThan(40);
    // Los dos textos son distintos entre sí y de cualquier otro tipo (R62).
    const textos = [...opciones.values()];
    for (const [, texto] of TEXTOS_457) {
      expect(textos.filter((t) => t === texto), texto).toHaveLength(1);
    }
  });
});

describe("457 R61–R64 — las filas del pago y de su anulación en la tabla", () => {
  it("pinta quién, qué, sobre qué (la tienda), el importe y el día de Costa Rica; nada técnico ni texto libre", async () => {
    renderModule(<HistorialAccionesModule actores={[]} ahora={AHORA} debounceMs={0} />);

    expect(await screen.findByText("Registró un pago de una tienda a Ordenex")).toBeInTheDocument();
    const fila = screen.getByText("Registró un pago de una tienda a Ordenex").closest("tr") as HTMLElement;
    expect(within(fila).getByText("Ana Mora")).toBeInTheDocument();
    expect(within(fila).getByText("Mueve dinero")).toBeInTheDocument();
    expect(within(fila).getByText("Pago de una tienda a Ordenex")).toBeInTheDocument();
    expect(within(fila).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(fila).getByText("₡4.000")).toBeInTheDocument();
    expect(fila.textContent ?? "").toContain("25 sept 2026");
    expect(fila.textContent ?? "").toContain("4:30");
    expect(fila.textContent ?? "").not.toMatch(/abono_tienda/);
    expect(document.body.textContent ?? "").not.toContain(ABONO_ID);
  });

  it("la anulación sale con su propio texto, junto al registro", async () => {
    listarMock.mockResolvedValue(
      ok([
        filaRegistro({
          id: "f-anul",
          accion: "abono_tienda_anulado",
          accionLabel: "Anuló un pago de una tienda a Ordenex",
          fecha: "2026-09-25T23:00:00.000Z",
        }),
        filaRegistro(),
      ]),
    );
    renderModule(<HistorialAccionesModule actores={[]} ahora={AHORA} debounceMs={0} />);
    expect(await screen.findByText("Anuló un pago de una tienda a Ordenex")).toBeInTheDocument();
    expect(screen.getByText("Registró un pago de una tienda a Ordenex")).toBeInTheDocument();
    expect(screen.getAllByText("Pago de una tienda a Ordenex")).toHaveLength(2);
  });
});
