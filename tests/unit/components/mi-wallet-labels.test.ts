import { describe, it, expect } from "vitest";

import {
  CATEGORIA_MI_WALLET_LABEL,
  CATEGORIA_MI_WALLET_OPTIONS,
  DESGLOSE_MI_WALLET_AVISO,
  DESGLOSE_MI_WALLET_LABEL,
  ORIGEN_TIENDA_LABEL,
  origenLabel,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import {
  CATEGORIA_TIENDA_LABEL,
  DESGLOSE_TIENDA_LABEL,
} from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import { WALLET_ORIGEN_TIPO_SEED, type WalletOrigenTipo } from "@/lib/types/wallet";
import {
  WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
  type WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";

// =================================================================================================
// FICHA 461 (T C.3, design §7.4/§7.5, HD3, P4) — EL LIBRO DE LA TIENDA SE LEE DESDE DOS LADOS
// =================================================================================================
//
// R44: `/mi-wallet` rotula cada concepto con su LECTURA DESDE LA TIENDA («Ordenex te cobró») y esa
// lectura es DISTINTA del nombre desde Ordenex que ve la oficina en `/wallet/tiendas` («Ordenex le
// cobra a la tienda») en todo concepto en el que una de las dos partes actúa sobre la otra. R45: las
// pistas de la cabecera nombran el cobro y su anulación con la misma palabra que su fila.
//
// Los textos esperados van ESCRITOS A MANO: comparar un diccionario contra sí mismo está siempre
// verde. Son el contrato aprobado por el humano (HD3). La mutación 12 de design §14.2 —poner en
// `/mi-wallet` el nombre desde Ordenex del cobro— pone rojos dos casos de este archivo.

/** design §7.5 — la lectura desde la tienda, los 14 conceptos. */
const LECTURA_DESDE_LA_TIENDA: Record<WalletTiendaMovimientoCategoria, string> = {
  cod_recaudado: "Cobrado a tus clientes en contra-entrega",
  flete: "Ordenex te cobró el flete",
  flete_devolucion: "Ordenex te cobró el flete por rechazo",
  comision_cod: "Ordenex te cobró la comisión de contra-entrega",
  iva_flete: "Ordenex te cobró el IVA del flete",
  iva_flete_devolucion: "Ordenex te cobró el IVA del flete por rechazo",
  iva_comision_cod: "Ordenex te cobró el IVA de la comisión",
  cobro_manual: "Ordenex te cobró",
  cobro_tienda_anulado: "Ordenex anuló un cobro y te lo devolvió",
  pago_tienda: "Ordenex te pagó",
  pago_por_cuenta: "Ordenex pagó un gasto por ti",
  pago_por_cuenta_anulado: "Ordenex anuló un pago hecho por ti",
  ajuste_credito: "Corrección a tu favor",
  ajuste_debito: "Corrección en tu contra",
};

/**
 * Los conceptos en los que una parte ACTÚA sobre la otra (Ordenex cobra, paga, anula, corrige; la
 * tienda recibe). Es todo el libro salvo lo cobrado a los clientes, que también se dice distinto
 * porque «tus clientes» no son «los clientes de la tienda».
 */
const UNA_PARTE_ACTUA_SOBRE_LA_OTRA: readonly WalletTiendaMovimientoCategoria[] = [
  "flete",
  "flete_devolucion",
  "comision_cod",
  "iva_flete",
  "iva_flete_devolucion",
  "iva_comision_cod",
  "cobro_manual",
  "cobro_tienda_anulado",
  "pago_tienda",
  "pago_por_cuenta",
  "pago_por_cuenta_anulado",
  "ajuste_credito",
  "ajuste_debito",
];

describe("461 — CATEGORIA_MI_WALLET_LABEL: la lectura desde la tienda (R44, design §7.5)", () => {
  it("dice exactamente los 14 textos aprobados, y el seed es exactamente esas 14 claves", () => {
    expect(CATEGORIA_MI_WALLET_LABEL).toEqual(LECTURA_DESDE_LA_TIENDA);
    expect([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort()).toEqual(
      Object.keys(LECTURA_DESDE_LA_TIENDA).sort(),
    );
    expect(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED).toHaveLength(14);
  });

  it("R44: es DISTINTA del nombre desde Ordenex en todo concepto donde una parte actúa sobre la otra", () => {
    for (const categoria of UNA_PARTE_ACTUA_SOBRE_LA_OTRA) {
      expect(CATEGORIA_MI_WALLET_LABEL[categoria], categoria).not.toBe(
        CATEGORIA_TIENDA_LABEL[categoria],
      );
    }
    // Y de hecho en los 14: «tus clientes» tampoco son «los clientes de la tienda».
    for (const categoria of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
      expect(CATEGORIA_MI_WALLET_LABEL[categoria], categoria).not.toBe(
        CATEGORIA_TIENDA_LABEL[categoria],
      );
    }
    // Anti-vacuidad: la lista de conceptos con actor cubre 13 de los 14.
    expect(UNA_PARTE_ACTUA_SOBRE_LA_OTRA).toHaveLength(13);
  });

  it("el cobro y lo que Ordenex paga se leen en segunda persona, con Ordenex como sujeto", () => {
    expect(CATEGORIA_MI_WALLET_LABEL.cobro_manual).toBe("Ordenex te cobró");
    expect(CATEGORIA_MI_WALLET_LABEL.cobro_tienda_anulado).toBe(
      "Ordenex anuló un cobro y te lo devolvió",
    );
    expect(CATEGORIA_MI_WALLET_LABEL.pago_tienda).toBe("Ordenex te pagó");
    expect(CATEGORIA_MI_WALLET_LABEL.pago_por_cuenta).toBe("Ordenex pagó un gasto por ti");
    // Ninguno de los dos es el nombre desde Ordenex (design §7.4): esa es la mutación 12.
    expect(CATEGORIA_MI_WALLET_LABEL.cobro_manual).not.toBe("Ordenex le cobra a la tienda");
    expect(CATEGORIA_MI_WALLET_LABEL.pago_por_cuenta).not.toBe("Ordenex paga un gasto de la tienda");
  });

  it("ningún nombre se repite, ninguno es el valor técnico y ninguno lleva la sigla «COD» (P9)", () => {
    const textos = Object.values(CATEGORIA_MI_WALLET_LABEL);
    expect(new Set(textos).size).toBe(textos.length);
    for (const [clave, texto] of Object.entries(CATEGORIA_MI_WALLET_LABEL)) {
      expect(texto, clave).not.toBe(clave);
      expect(texto, clave).not.toMatch(/_/);
      expect(texto, clave).not.toMatch(/\bCOD\b/);
    }
  });

  it("las opciones del filtro salen del SEED con la lectura desde la tienda, tras «Todos los conceptos»", () => {
    expect(CATEGORIA_MI_WALLET_OPTIONS[0]).toEqual({ value: "", label: "Todos los conceptos" });
    expect(CATEGORIA_MI_WALLET_OPTIONS.slice(1).map((o) => o.value)).toEqual([
      ...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
    ]);
    const opciones = new Map(CATEGORIA_MI_WALLET_OPTIONS.slice(1).map((o) => [o.value, o.label]));
    for (const [clave, texto] of Object.entries(LECTURA_DESDE_LA_TIENDA)) {
      expect(opciones.get(clave), clave).toBe(texto);
    }
  });
});

describe("461 — la cabecera de /mi-wallet habla desde la tienda (R45, design §7.5)", () => {
  it("las tres pistas, literales, y sin la sigla «COD»", () => {
    expect(DESGLOSE_MI_WALLET_LABEL.aFavorHint).toBe(
      "Lo cobrado a tus clientes, las correcciones a tu favor y lo que Ordenex te devolvió al anular",
    );
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toBe("Fletes, comisión, IVA y lo que Ordenex te cobró");
    expect(DESGLOSE_MI_WALLET_LABEL.pagadoHint).toBe("Lo que Ordenex te pagó o pagó por ti");
    for (const texto of Object.values(DESGLOSE_MI_WALLET_LABEL)) expect(texto).not.toMatch(/\bCOD\b/);
  });

  it("R45: la pista de «Cargos» usa la MISMA palabra con la que el cobro se rotula en su fila", () => {
    // La tienda ve la cifra agregada arriba y, más abajo, una fila «Ordenex te cobró». Que la
    // aclaración diga «lo que Ordenex te cobró» es lo que permite relacionar las dos sin adivinar.
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toContain(CATEGORIA_MI_WALLET_LABEL.cobro_manual);
    // …y sigue nombrando los tres automáticos (R37 de la 381: AÑADIR, no sustituir).
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toMatch(/flete/i);
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toMatch(/comisión/i);
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toMatch(/IVA/);
    // R45 también para la anulación: «te devolvió al anular» ↔ «Ordenex anuló un cobro y te lo devolvió».
    expect(DESGLOSE_MI_WALLET_LABEL.aFavorHint).toMatch(/te devolvió al anular/);
    expect(CATEGORIA_MI_WALLET_LABEL.cobro_tienda_anulado).toMatch(/te lo devolvió/);
  });

  it("no promete ninguna comprobación de saldo ni habla de deuda impagable (R27 de la 381)", () => {
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).not.toMatch(/insuficiente|suficiente|deuda/i);
  });

  it("los rótulos y las claves de la cabecera no cambian: siete, en el orden de la fórmula", () => {
    expect(DESGLOSE_MI_WALLET_LABEL.aFavor).toBe("A tu favor");
    expect(DESGLOSE_MI_WALLET_LABEL.cargos).toBe("Cargos de Ordenex");
    expect(DESGLOSE_MI_WALLET_LABEL.pagado).toBe("Ya pagado");
    expect(DESGLOSE_MI_WALLET_LABEL.saldo).toBe("Saldo a favor");
    expect(Object.keys(DESGLOSE_MI_WALLET_LABEL)).toEqual([
      "aFavor",
      "aFavorHint",
      "cargos",
      "cargosHint",
      "pagado",
      "pagadoHint",
      "saldo",
    ]);
  });

  it("el aviso compuesto sigue construyéndose con los rótulos REALES y sigue siendo coherente", () => {
    expect(DESGLOSE_MI_WALLET_AVISO).toContain(`«${DESGLOSE_MI_WALLET_LABEL.pagado}»`);
    expect(DESGLOSE_MI_WALLET_AVISO).toContain(`«${DESGLOSE_MI_WALLET_LABEL.aFavor}»`);
    expect(DESGLOSE_MI_WALLET_AVISO).toContain(`«${DESGLOSE_MI_WALLET_LABEL.saldo}»`);
    expect(DESGLOSE_MI_WALLET_AVISO).toMatch(/anularon/);
    expect(DESGLOSE_MI_WALLET_AVISO).not.toContain(DESGLOSE_MI_WALLET_LABEL.cargosHint);
  });
});

// ─── Los orígenes que escriben en el libro de la tienda (459 T B.6/T B.17, R44; 461 design §7.3) ───

/**
 * Los orígenes que ESCRIBEN en el libro de la tienda (`wallet_tienda_movimiento`), medidos en el
 * código: el cierre (`WalletTiendaFeedService`), el pago a tienda y su anulación
 * (`LiquidacionService`), el cobro de Ordenex a la tienda (`CobroTiendaService`, origen `manual`),
 * el cobro por rechazo (`RechazoTiendaCobroService`, `gestion_orden`), el pago de un gasto de la
 * tienda y su anulación (`PagoPorCuentaTiendaService`) y, desde la 461, el crédito de la anulación de
 * un cobro (`CobroTiendaService.anular`, origen `cobro_tienda`). Las dos listas juntas cubren el
 * SEED: un origen nuevo obliga a decidir en cuál cae.
 */
const ESCRIBEN_EN_LA_TIENDA: readonly WalletOrigenTipo[] = [
  "cierre_dia",
  "pago_tienda",
  "manual",
  "gestion_orden",
  "pago_por_cuenta_tienda",
  "cobro_tienda",
];
const NO_ESCRIBEN_EN_LA_TIENDA: readonly WalletOrigenTipo[] = [
  "pago_mensajero",
  "gasto",
  "orden_incidente",
  "ranking_snapshot_fila",
  "aporte_capital",
  "cobro_manual_reclasificado",
  // Las líneas de caja completadas por la migración de datos solo escriben en la caja.
  "cobro_tienda_completado",
];

describe("ORIGEN_TIENDA_LABEL cubre cada origen que escribe en el libro de la tienda (459 R44 / 461 §7.3)", () => {
  it("las dos listas cubren el SEED de orígenes, sin solaparse", () => {
    expect([...ESCRIBEN_EN_LA_TIENDA, ...NO_ESCRIBEN_EN_LA_TIENDA].sort()).toEqual(
      [...WALLET_ORIGEN_TIPO_SEED].sort(),
    );
  });

  it("cada origen que escribe en la tienda tiene rótulo legible (el compilador no lo obliga)", () => {
    for (const origen of ESCRIBEN_EN_LA_TIENDA) {
      const rotulo = ORIGEN_TIENDA_LABEL[origen];
      expect(rotulo, `sin rótulo: ${origen}`).toBeTruthy();
      expect(origenLabel(origen)).not.toBe(origen);
      expect(rotulo).not.toMatch(/_/);
    }
  });

  it("461 §7.3: los seis textos, desde Ordenex, y los compartidos con la caja dicen lo mismo", () => {
    expect(ORIGEN_TIENDA_LABEL).toEqual({
      cierre_dia: "Cierre del día",
      pago_tienda: "Pago de Ordenex a una tienda",
      manual: "Registrado a mano",
      gestion_orden: "Gestión de orden",
      pago_por_cuenta_tienda: "Pago de un gasto de una tienda",
      cobro_tienda: "Cobro de Ordenex a una tienda",
    });
  });

  it("las pistas de /wallet/tiendas hablan desde Ordenex y nombran el cobro y su anulación (R45)", () => {
    expect(DESGLOSE_TIENDA_LABEL.aFavorHint).toBe(
      "Contra-entrega cobrado, correcciones a favor y devoluciones por anulaciones",
    );
    expect(DESGLOSE_TIENDA_LABEL.cargosHint).toBe(
      "Fletes, comisión, IVA y los cobros de Ordenex a la tienda",
    );
    expect(DESGLOSE_TIENDA_LABEL.pagadoHint).toBe("Lo que Ordenex le pagó a la tienda o pagó por ella");
  });
});
