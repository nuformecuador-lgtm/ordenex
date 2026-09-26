import { describe, it, expect } from "vitest";

import {
  ANULAR_DOCUMENTO_CAJA_RESPUESTA,
  CAJA_RESUMEN_AVISO_TERCEROS,
  CATEGORIA_LABEL,
  CATEGORIA_TODAS_OPTION,
  DOCUMENTO_CAJA_NOMBRE,
  MOTIVO_NO_ANULABLE_LABEL,
  ORIGEN_LABEL,
  TIPO_EGRESO_MANUAL_LABEL,
} from "@/app/(app)/wallet/_components/wallet-labels";
import { opcionesDeConceptos } from "@/components/shared/wallet/conceptos-filtro";
import { EGRESO_NOMBRADO_LABEL } from "@/app/(app)/wallet/_components/composicion-detalle-labels";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  WALLET_ORIGEN_TIPO_SEED,
  type WalletMovimientoCategoria,
  type WalletOrigenTipo,
} from "@/lib/types/wallet";

// =================================================================================================
// FICHA 461 (T C.1, design §7.2/§7.3, HD3) — LOS NOMBRES DEL LIBRO DE LA CAJA, DESDE ORDENEX
// =================================================================================================
//
// R42: la tabla, el filtro por concepto y la descarga del libro rotulan cada concepto con el nombre
// desde Ordenex y cada origen con el suyo, y NUNCA con el valor tecnico. R50: la explicacion de «De
// las tiendas» nombra lo que Ordenex les cobro y no dice que los cobros no pasan por la caja.
//
// Los textos esperados van ESCRITOS A MANO, uno por uno, y no se leen de la fuente que los define:
// comparar un diccionario contra si mismo esta siempre verde (leccion «asercion contra su propia
// fuente»). Son el contrato aprobado por el humano (HD3): «siempre desde Ordenex y diciendo quien le
// paga a quien».

/** design §7.2 — los 23 conceptos del libro de la caja, tal como se leen. */
const CONCEPTOS_ESPERADOS: Record<WalletMovimientoCategoria, string> = {
  ingreso_flete: "Flete cobrado a la tienda",
  ingreso_flete_devolucion: "Flete por rechazo cobrado a la tienda",
  ingreso_comision_cod: "Comisión de contra-entrega cobrada a la tienda",
  ingreso_iva_flete: "IVA del flete cobrado a la tienda",
  ingreso_iva_flete_devolucion: "IVA del flete por rechazo cobrado a la tienda",
  ingreso_iva_comision_cod: "IVA de la comisión cobrado a la tienda",
  ingreso_cobro_tienda: "Ordenex le cobra a una tienda",
  egreso_reverso_cobro_tienda: "Cobro a una tienda anulado",
  ingreso_cod_recaudado: "Contra-entrega cobrado a los clientes de la tienda",
  egreso_pago_tienda: "Ordenex le paga a una tienda",
  ingreso_reverso_pago_tienda: "Pago a una tienda anulado",
  egreso_pago_por_cuenta_tienda: "Ordenex paga un gasto de una tienda",
  ingreso_reverso_pago_por_cuenta_tienda: "Pago de un gasto de una tienda anulado",
  egreso_pago_mensajero: "Ordenex le paga a un mensajero",
  egreso_sueldo: "Sueldo",
  egreso_gasto_variable: "Gasto de Ordenex",
  egreso_gasto_fijo: "Gasto fijo de Ordenex",
  egreso_gasto: "Otro gasto de Ordenex",
  egreso_indemnizacion: "Indemnización que Ordenex paga por un incidente",
  ingreso_ajuste: "Corrección de caja (suma)",
  egreso_ajuste: "Corrección de caja (resta)",
  ingreso_aporte_capital: "Aporte de dinero a la caja",
  egreso_reverso_aporte_capital: "Aporte de dinero a la caja anulado",
  // Ficha 457 (design §2, DH7): el pago de una tienda a Ordenex toma el nombre que la 461 reservo.
  ingreso_abono_tienda: "Una tienda le paga a Ordenex",
  egreso_reverso_abono_tienda: "Pago de una tienda a Ordenex anulado",
};

/** design §7.3 — los 13 origenes del libro de la caja (+ el de la 457: 14). */
const ORIGENES_ESPERADOS: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  gestion_orden: "Gestión de orden",
  manual: "Registrado a mano",
  gasto: "Gasto o sueldo registrado a mano",
  pago_tienda: "Pago de Ordenex a una tienda",
  pago_mensajero: "Pago de Ordenex a un mensajero",
  orden_incidente: "Incidente de orden",
  ranking_snapshot_fila: "Premio del ranking",
  pago_por_cuenta_tienda: "Pago de un gasto de una tienda",
  aporte_capital: "Aporte de dinero a la caja",
  cobro_manual_reclasificado: "Cobro reclasificado como pago de un gasto de la tienda",
  cobro_tienda: "Cobro de Ordenex a una tienda",
  cobro_tienda_completado: "Cobro de Ordenex a una tienda (línea de caja completada al corregir)",
  // Ficha 457 (design §2): el documento del pago de una tienda a Ordenex.
  abono_tienda: "Pago de una tienda a Ordenex",
};

describe("461 — CATEGORIA_LABEL: cada concepto de la caja, desde Ordenex (R42, design §7.2)", () => {
  it("dice exactamente los 25 textos aprobados (23 de la 461 + 2 de la 457), y el seed es exactamente esas 25 claves", () => {
    expect(CATEGORIA_LABEL).toEqual(CONCEPTOS_ESPERADOS);
    // Anti-vacuidad: la igualdad de arriba compara contra una lista escrita a mano; esta linea
    // afirma que esa lista cubre el catalogo ENTERO y no un subconjunto que casara por casualidad.
    expect([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort()).toEqual(
      Object.keys(CONCEPTOS_ESPERADOS).sort(),
    );
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toHaveLength(25);
  });

  it("⭑ 457 (R45/R53): el pago de una tienda a Ordenex y su anulacion, con los nombres reservados por la 461", () => {
    expect(CATEGORIA_LABEL.ingreso_abono_tienda).toBe("Una tienda le paga a Ordenex");
    expect(CATEGORIA_LABEL.egreso_reverso_abono_tienda).toBe("Pago de una tienda a Ordenex anulado");
    // Distintos del cobro (Ordenex le cobra) y del pago de Ordenex a la tienda: la direccion del dinero
    // es la contraria y el nombre lo dice.
    expect(CATEGORIA_LABEL.ingreso_abono_tienda).not.toBe(CATEGORIA_LABEL.ingreso_cobro_tienda);
    expect(CATEGORIA_LABEL.ingreso_abono_tienda).not.toBe(CATEGORIA_LABEL.egreso_pago_tienda);
    expect(ORIGEN_LABEL.abono_tienda).toBe("Pago de una tienda a Ordenex");
  });

  it("ningun nombre se repite: dos conceptos con el mismo texto serian indistinguibles en la tabla", () => {
    const textos = Object.values(CATEGORIA_LABEL);
    expect(new Set(textos).size).toBe(textos.length);
  });

  it("ningun texto es el valor tecnico ni lleva guion bajo ni la sigla «COD» (P9)", () => {
    for (const [clave, texto] of Object.entries(CATEGORIA_LABEL)) {
      expect(texto, clave).not.toBe(clave);
      expect(texto, clave).not.toMatch(/_/);
      expect(texto, clave).not.toMatch(/\bCOD\b/);
    }
  });

  it("el cobro y su anulacion son dos nombres distintos y ninguno es el del pago de un gasto", () => {
    expect(CATEGORIA_LABEL.ingreso_cobro_tienda).toBe("Ordenex le cobra a una tienda");
    expect(CATEGORIA_LABEL.egreso_reverso_cobro_tienda).toBe("Cobro a una tienda anulado");
    expect(CATEGORIA_LABEL.ingreso_cobro_tienda).not.toBe(
      CATEGORIA_LABEL.egreso_pago_por_cuenta_tienda,
    );
    expect(CATEGORIA_LABEL.egreso_reverso_cobro_tienda).not.toBe(
      CATEGORIA_LABEL.ingreso_reverso_pago_por_cuenta_tienda,
    );
  });

  it("el filtro por concepto ofrece los 25 con SU nombre (R42; 457/R45), tras la opcion «todas»", () => {
    // 458-A (TA.3): el filtro ofrece los conceptos CON movimientos; con los 25 presentes, los 25.
    const lista = opcionesDeConceptos(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({ categoria, movimientos: 1 })),
      CATEGORIA_LABEL,
      "",
      CATEGORIA_TODAS_OPTION,
    );
    expect(lista[0]).toEqual({ value: "", label: "Todas las categorías" });
    const opciones = new Map(lista.slice(1).map((o) => [o.value, o.label]));
    expect(opciones.size).toBe(25);
    for (const [clave, texto] of Object.entries(CONCEPTOS_ESPERADOS)) {
      expect(opciones.get(clave), clave).toBe(`${texto} (1)`);
    }
  });
});

describe("461 — ORIGEN_LABEL: cada origen de la caja, desde Ordenex (R42, design §7.3)", () => {
  it("dice exactamente los 14 textos aprobados (13 de la 461 + 1 de la 457), y el seed es exactamente esas 14 claves", () => {
    expect(ORIGEN_LABEL).toEqual(ORIGENES_ESPERADOS);
    expect([...WALLET_ORIGEN_TIPO_SEED].sort()).toEqual(Object.keys(ORIGENES_ESPERADOS).sort());
    expect(WALLET_ORIGEN_TIPO_SEED).toHaveLength(14);
  });

  it("las dos lineas del cobro se distinguen: la completada dice que se completo al corregir (R37)", () => {
    expect(ORIGEN_LABEL.cobro_tienda_completado).toContain(ORIGEN_LABEL.cobro_tienda);
    expect(ORIGEN_LABEL.cobro_tienda_completado).toMatch(/completada al corregir/);
    expect(ORIGEN_LABEL.cobro_tienda_completado).not.toBe(ORIGEN_LABEL.cobro_tienda);
  });

  it("ningun origen se lee como el nombre tecnico ni con guion bajo", () => {
    for (const [clave, texto] of Object.entries(ORIGEN_LABEL)) {
      expect(texto, clave).not.toBe(clave);
      expect(texto, clave).not.toMatch(/_/);
    }
  });
});

describe("461 — el resto de textos de la caja que esta ficha toca (R42/R50, design §7/§9)", () => {
  it("R50: «De las tiendas» nombra lo que Ordenex les cobro y NO dice que los cobros no pasan por la caja", () => {
    expect(CAJA_RESUMEN_AVISO_TERCEROS).toBe(
      "Es la suma de los saldos de todas las tiendas, ya descontados el flete, la comisión, el impuesto y lo que Ordenex les cobró. El detalle de cada tienda está en Wallet → Tiendas.",
    );
    expect(CAJA_RESUMEN_AVISO_TERCEROS).not.toMatch(/sin pasar por la caja/);
    expect(CAJA_RESUMEN_AVISO_TERCEROS).not.toMatch(/cobros? de un costo/i);
  });

  it("el tipo de egreso manual se llama «Gasto de Ordenex», igual que el concepto del dialogo", () => {
    expect(TIPO_EGRESO_MANUAL_LABEL).toEqual({ gasto_variable: "Gasto de Ordenex", sueldo: "Sueldo" });
    expect(TIPO_EGRESO_MANUAL_LABEL.gasto_variable).toBe(CATEGORIA_LABEL.egreso_gasto_variable);
  });

  it("los cinco documentos anulables se nombran desde Ordenex dentro de «Anular …»", () => {
    expect(DOCUMENTO_CAJA_NOMBRE).toEqual({
      pago_por_cuenta_tienda: "el pago de un gasto de una tienda",
      aporte_capital: "el aporte de dinero a la caja",
      cobro_tienda: "el cobro de Ordenex a una tienda",
      ajuste_caja: "la corrección de caja",
      abono_tienda: "el pago de una tienda a Ordenex", // ficha 457 (design §8.5)
    });
  });

  it("R17: el aviso de «no anulable» dice por que, con los dos motivos que devuelve el servidor", () => {
    expect(MOTIVO_NO_ANULABLE_LABEL).toEqual({
      reclasificado: "se reclasificó como pago de un gasto de la tienda",
      sin_linea_de_caja: "no tiene su línea en la caja",
    });
    expect(ANULAR_DOCUMENTO_CAJA_RESPUESTA.noAnulable("reclasificado")).toBe(
      "Este cobro no se puede anular desde aquí: se reclasificó como pago de un gasto de la tienda.",
    );
    expect(ANULAR_DOCUMENTO_CAJA_RESPUESTA.noAnulable("sin_linea_de_caja")).toBe(
      "Este cobro no se puede anular desde aquí: no tiene su línea en la caja.",
    );
  });

  it("las filas nombradas de la composicion van en plural y desde Ordenex (R27)", () => {
    expect(EGRESO_NOMBRADO_LABEL).toEqual({
      egreso_pago_mensajero: "Pagos de Ordenex a mensajeros",
      egreso_ajuste: "Correcciones de caja (resta)",
      egreso_reverso_cobro_tienda: "Cobros a una tienda anulados",
    });
  });
});
