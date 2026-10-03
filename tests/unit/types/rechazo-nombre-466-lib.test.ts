import { describe, expect, it } from "vitest";

import { getMetrica } from "@/lib/analytics/metrics";
import { ORIGEN_ENTIDAD_LABEL } from "@/lib/constants/origen-legible-rotulos";
import { CATEGORIA_LABEL } from "@/lib/constants/wallet-rotulos";
import { ACCION_LABELS, ENTIDAD_LABELS, HISTORIAL_ACCION_ENTIDADES, HISTORIAL_ACCION_TIPOS } from "@/lib/types/historial-accion";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";

/**
 * FICHA 466 (Fase 1, `lib/`) — los conceptos, KPIs e historial que derivan del resultado
 * `devolucion_a_origen_por_rechazo` usan la forma «devolución a origen» (requirements §0.2-§0.3).
 *
 * Todos los textos esperados son LITERALES escritos a mano (design D3: un rotulo ES el contrato). Si
 * alguno de estos asertos se cambia por `CATEGORIA_LABEL.x`, el test deja de poder fallar.
 */

describe("466/R1 · R2 — conceptos del libro de caja (C1-C4), la misma fuente que su Excel", () => {
  it("el flete y su IVA, cobrados y anulados, dicen «devolución a origen»", () => {
    expect(CATEGORIA_LABEL.ingreso_flete_devolucion).toBe("Flete por devolución a origen cobrado a la tienda");
    expect(CATEGORIA_LABEL.ingreso_iva_flete_devolucion).toBe(
      "IVA del flete por devolución a origen cobrado a la tienda",
    );
    expect(CATEGORIA_LABEL.egreso_reverso_flete_devolucion).toBe(
      "Flete por devolución a origen cobrado a la tienda anulado",
    );
    expect(CATEGORIA_LABEL.egreso_reverso_iva_flete_devolucion).toBe(
      "IVA del flete por devolución a origen cobrado a la tienda anulado",
    );
  });

  it("el origen legible del cobro (C15) dice «cobro por devolución a origen»", () => {
    expect(ORIGEN_ENTIDAD_LABEL.cobroPorRechazo).toBe("cobro por devolución a origen");
  });
});

describe("466/R1 — historial de acciones (C25-C28)", () => {
  it("las tres acciones del cobro y su entidad", () => {
    expect(ACCION_LABELS.cobro_rechazo_tienda_aprobado).toBe("Aprobó un cobro por devolución a origen de tienda");
    expect(ACCION_LABELS.cobro_rechazo_tienda_rechazado).toBe("Rechazó un cobro por devolución a origen de tienda");
    expect(ACCION_LABELS.cobro_rechazo_tienda_anulado).toBe("Anuló un cobro por devolución a origen a una tienda");
    expect(ENTIDAD_LABELS.rechazo_tienda_cobro).toBe("Cobro por devolución a origen");
  });

  it("R13: la decision sobre OTRAS entidades conserva «Rechazó»", () => {
    expect(ACCION_LABELS.cierre_dia_rechazado).toBe("Rechazó un cierre del día");
    expect(ACCION_LABELS.incidente_rechazado).toBe("Rechazó un incidente");
    expect(ACCION_LABELS.postulacion_rechazada).toBe("Rechazó una postulación");
  });
});

describe("466/R6 · R7 — los KPIs de la analitica (K1, K2)", () => {
  it("`rechazos` se rotula «Devoluciones a origen» y `tasa_rechazo` «Tasa de devolución a origen»", () => {
    expect(getMetrica("rechazos")?.etiqueta).toBe("Devoluciones a origen");
    expect(getMetrica("tasa_rechazo")?.etiqueta).toBe("Tasa de devolución a origen");
  });

  it("los rotulos de Novedad NO cambian (fuera de alcance)", () => {
    expect(getMetrica("devoluciones")?.etiqueta).toBe("Devoluciones");
    expect(getMetrica("tasa_devolucion")?.etiqueta).toBe("Tasa de devolución");
  });
});

describe("466/R12 — el nombre vigente del estado no cambia", () => {
  it("«Devolución a origen por rechazo»", () => {
    expect(NOMBRE_ESTADO.devolucion_a_origen_por_rechazo).toBe("Devolución a origen por rechazo");
  });
});

describe("466/R26 — ningun identificador cambia", () => {
  it("las claves de categoria, los tipos de accion, la entidad y los ids de metrica siguen ahi", () => {
    for (const k of [
      "ingreso_flete_devolucion",
      "ingreso_iva_flete_devolucion",
      "egreso_reverso_flete_devolucion",
      "egreso_reverso_iva_flete_devolucion",
    ]) {
      expect(Object.keys(CATEGORIA_LABEL)).toContain(k);
    }
    expect(Object.keys(ORIGEN_ENTIDAD_LABEL)).toContain("cobroPorRechazo");
    for (const a of ["cobro_rechazo_tienda_aprobado", "cobro_rechazo_tienda_rechazado", "cobro_rechazo_tienda_anulado"]) {
      expect(HISTORIAL_ACCION_TIPOS).toContain(a);
    }
    expect(HISTORIAL_ACCION_ENTIDADES).toContain("rechazo_tienda_cobro");
    expect(getMetrica("rechazos")?.id).toBe("rechazos");
    expect(getMetrica("tasa_rechazo")?.id).toBe("tasa_rechazo");
  });
});
