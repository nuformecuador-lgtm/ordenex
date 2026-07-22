import { describe, it, expect } from "vitest";
import {
  esRechazoSla,
  ORIGEN_TIPO_RECHAZO_SLA,
  type HistorialOrigenRow,
} from "@/lib/utils/rechazo-sla-flag";

// Feature 102 (T1) — util puro `esRechazoSla` (design §2). Deriva la clasificacion SLA/manual
// del `origen_tipo` INMUTABLE de la feature 99, sin DB. Cubre R1 (true con fila enlazada de
// origen SLA) y R2 (rechazo manual con ingreso != 0 -> false).

const SLA: HistorialOrigenRow = { origenTipo: ORIGEN_TIPO_RECHAZO_SLA };
const MANUAL: HistorialOrigenRow = { origenTipo: "gestion" };

describe("esRechazoSla (R1/R2)", () => {
  it("R1: true cuando existe una fila de historial con origen_tipo = escalado_devuelta_sla", () => {
    expect(esRechazoSla([SLA])).toBe(true);
  });

  it("R1: true aunque la fila SLA venga junto a otras de otro origen", () => {
    expect(esRechazoSla([MANUAL, SLA])).toBe(true);
  });

  it("R2: rechazo manual (origen_tipo = gestion) -> false, aunque el ingreso este snapshoteado", () => {
    // El monto (ingreso_bodega_rechazo) NO se pasa al predicado: solo el historial distingue el
    // origen. Una gestion manual con ingreso != 0 sigue siendo NO-SLA.
    expect(esRechazoSla([MANUAL])).toBe(false);
  });

  it("R1/R2: sin filas de historial enlazadas -> false (no es un rechazo SLA)", () => {
    expect(esRechazoSla([])).toBe(false);
  });

  it("R3: el origen que marca SLA es exactamente `escalado_devuelta_sla` (append-only, feature 99)", () => {
    expect(ORIGEN_TIPO_RECHAZO_SLA).toBe("escalado_devuelta_sla");
  });
});
