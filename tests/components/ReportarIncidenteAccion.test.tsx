// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ReportarIncidenteAccion,
  REPORTAR_INCIDENTE_ACCION_LABEL,
} from "@/app/(app)/ordenes/_components/ReportarIncidenteAccion";
import {
  ESTADOS_REPORTABLES_INCIDENTE,
  esEstadoReportable,
} from "@/app/(app)/ordenes/_components/incidente-origenes";
import { REPORTAR_INCIDENTE_TITULO } from "@/app/(app)/ordenes/_components/ReportarIncidenteModal";
import { ORIGENES_INCIDENTE_ADMIN } from "@/lib/services/IncidenteAdminService";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 158 (T2.7 — R41/R48, camino del ADMIN) — la acción POR FILA que abre el modal.
//
// Lo que este archivo protege:
//   - que la acción NO aparece en estados fuera de los cinco (R41): ofrecer un botón que el
//     servidor va a rechazar es una invitación al error;
//   - que el conjunto de estados de la UI es EXACTAMENTE el del servidor, por igualdad y no
//     por muestreo: la lista del cliente se DERIVA del mapa de la 140 y este caso es el
//     candado que impide que las dos fuentes se separen en silencio;
//   - que la acción es POR ORDEN (una fila, una orden), no por lote.
vi.mock("@/lib/actions/incidentes", () => ({
  reportarIncidente: vi.fn(),
}));
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

const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";

function orden(estatusValue: string): OrdenListItemDTO {
  return {
    id: ORDEN_ID,
    numRemision: "REM-001",
    numGuia: 1001,
    estatusValue,
    destinatario: "Ana Pérez",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
  } as unknown as OrdenListItemDTO;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Feature 158 (T2.7) — el conjunto de estados reportables es el del SERVIDOR", () => {
  it("es EXACTAMENTE `ORIGENES_INCIDENTE_ADMIN`, ni uno más ni uno menos", () => {
    // Igualdad de CONJUNTOS (ordenados), no un `some()` permisivo: si el servidor añadiera o
    // quitara un origen y la UI no lo siguiera, este caso se pone rojo. La UI lo deriva del
    // mapa de la 140 (salidas de `incidente` de familia `incidente`), así que la única forma
    // de que coincidan es que el mapa y el service sigan de acuerdo.
    expect([...ESTADOS_REPORTABLES_INCIDENTE].sort()).toEqual(
      [...ORIGENES_INCIDENTE_ADMIN].sort(),
    );
    expect(ESTADOS_REPORTABLES_INCIDENTE).toHaveLength(5);
  });

  it("`en_reparto` NO es reportable por el admin: ese camino es el del MENSAJERO (#44)", () => {
    // La sexta salida de `incidente` (#53) va con familia `deshacer_gestion` y por eso queda
    // fuera de la derivación. Si alguien la colara, el admin vería la acción sobre órdenes
    // que están en manos de un mensajero.
    expect(esEstadoReportable("en_reparto")).toBe(false);
  });

  it.each(
    ORDER_STATUS_SEED.filter(
      (v) => !(ORIGENES_INCIDENTE_ADMIN as readonly string[]).includes(v),
    ),
  )("el estado `%s` del catálogo NO es reportable", (value) => {
    expect(esEstadoReportable(value)).toBe(false);
  });

  it("un estado ausente (`undefined`) NO es reportable (degradación segura)", () => {
    expect(esEstadoReportable(undefined)).toBe(false);
    expect(esEstadoReportable(null)).toBe(false);
  });
});

describe("Feature 158 (T2.7) — R41: la acción sólo se ofrece en los cinco estados", () => {
  it.each(ORIGENES_INCIDENTE_ADMIN)("en `%s` ofrece el disparador", (estado) => {
    render(<ReportarIncidenteAccion orden={orden(estado)} />);
    expect(
      screen.getByRole("button", {
        name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-001`,
      }),
    ).toBeInTheDocument();
  });

  it.each(["en_reparto", "entregada", "devuelta", "incidente", "en_preparacion"])(
    "en `%s` NO renderiza NADA (ni un botón deshabilitado)",
    (estado) => {
      const { container } = render(<ReportarIncidenteAccion orden={orden(estado)} />);
      expect(screen.queryByRole("button")).toBeNull();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("el disparador abre el modal de ESA orden (una, no un lote)", async () => {
    const user = userEvent.setup();
    render(<ReportarIncidenteAccion orden={orden("en_bodega_central")} />);
    expect(screen.queryByText(REPORTAR_INCIDENTE_TITULO)).toBeNull();
    await user.click(
      screen.getByRole("button", {
        name: `${REPORTAR_INCIDENTE_ACCION_LABEL} de la orden REM-001`,
      }),
    );
    expect(await screen.findByText(REPORTAR_INCIDENTE_TITULO)).toBeInTheDocument();
    // La identificación de la orden viaja al modal: sin ella el actor no sabría sobre cuál
    // está reportando (y el reporte NO es de lote).
    expect(screen.getByText(/REM-001/)).toBeInTheDocument();
  });
});
