// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { ordenesColumnsAdminTienda } from "@/app/(app)/_components/ordenes-columns-admin-tienda";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 48 (T10.1, R12/R13) — el listado del adminTienda (dashboard) reusa las
// columnas derivadas de `ordenesColumns`, cuya columna "Estatus" pinta el
// `EstatusBadge`. Se ejercita el render de esa columna con los estados del retorno
// para confirmar que se muestran con etiqueta LEGIBLE (nunca el `value` crudo).

const estatusColumn = ordenesColumnsAdminTienda.find((c) => c.id === "estatus");

function makeOrden(estatusValue: string): OrdenListItemDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusId: "id-estatus",
    estatusValue,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function renderEstatus(estatusValue: string) {
  if (!estatusColumn || typeof estatusColumn.render !== "function") {
    throw new Error("La columna 'estatus' debe tener un render de función");
  }
  render(<>{estatusColumn.render(makeOrden(estatusValue))}</>);
}

afterEach(() => {
  cleanup();
});

describe("Listado del adminTienda — etiquetas de los estados del retorno (R12/R13)", () => {
  it("R13: 'rechazada' se muestra con su etiqueta legible (no el value crudo)", () => {
    renderEstatus("rechazada");
    expect(screen.getByText(ORDER_STATUS_LABELS.rechazada)).toBeInTheDocument();
    expect(screen.queryByText("rechazada")).toBeNull();
  });

  it("R13: 'devuelta_origen' se muestra con su etiqueta legible (no el value crudo)", () => {
    renderEstatus("devuelta_origen");
    expect(
      screen.getByText(ORDER_STATUS_LABELS.devuelta_origen),
    ).toBeInTheDocument();
    expect(screen.queryByText("devuelta_origen")).toBeNull();
  });
});
