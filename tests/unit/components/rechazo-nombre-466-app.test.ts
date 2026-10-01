// FICHA 466 — Fase 2 (T2.1-T2.4): los textos de `app/` y `components/` que nombran el resultado
// `devolucion_a_origen_por_rechazo`, afirmados contra su LITERAL NUEVO (design D3: un rotulo ES el
// contrato; nunca se compara contra su propia fuente). Cada `it` cita los numeros de
// `requirements.md` §0 que cubre. Lo de `lib/` (C1-C4, C15, C25-C28, K1, K2, E4, E6, E12, E13) lo
// cubre `tests/unit/types/rechazo-nombre-466-lib.test.ts` (Fase 1).
import { describe, expect, it } from "vitest";

import { DETALLE_DINERO_TEXTOS } from "@/app/(app)/analitica/_components/entregas/DineroProductoDetalle";
import { PRODUCTOS_COLUMNAS } from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import {
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO,
} from "@/app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas";
import {
  FLETE_DEV_CON_IVA_LABEL,
  FLETE_RECHAZO_NO_DEDUCIBLE_NOTA,
  GANA_BODEGA_SATELITE_NOTA,
  MOTIVO_RECHAZO_AUTOMATICO_COLA,
  NETO_ORDENEX_NOTA,
  ESTADO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
import {
  FLETE_RECHAZO_GAM_LABEL,
  FLETE_RECHAZO_LABEL,
  INGRESO_BODEGA_RECHAZOS_LABEL,
  IVA_FLETE_RECHAZO_LABEL,
  RECHAZO_MANUAL_BADGE_NOTA,
  RECHAZO_SLA_BADGE_NOTA,
} from "@/app/(app)/cierres-admin/_components/cierre-detalle-shared";
import { PAGO_ZONA_TEXTO, TARIFA_CAMPO_LABEL } from "@/app/(app)/configuracion/tarifas/_components/tarifas-labels";
import { CATEGORIA_MI_WALLET_LABEL } from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import {
  GESTION_AYUDA_CONFIRMAR,
  GESTION_AYUDA_EXITO,
  GESTION_AYUDA_TOPE_NOTA,
} from "@/app/(app)/novedades/_components/GestionarDesdeAyudaModal";
import {
  RECHAZO_AVISO,
  RECHAZO_MOTIVO_LABEL,
  RECHAZO_TITULO,
} from "@/app/(app)/novedades/_components/RechazarNovedadModal";
import {
  COBRO_RECHAZO_MENSAJE,
  COBROS_RECHAZO_COLUMNA,
  COBROS_RECHAZO_DESCRIPCION,
  COBROS_RECHAZO_SECCION,
  COBROS_RECHAZO_TITULO,
} from "@/app/(app)/wallet/_components/cobro-rechazo-tienda-labels";
import { EGRESO_NOMBRADO_LABEL } from "@/app/(app)/wallet/_components/composicion-detalle-labels";
import { DOCUMENTO_CAJA_NOMBRE } from "@/app/(app)/wallet/_components/wallet-labels";
import { CATEGORIA_TIENDA_LABEL } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import {
  ACCION_AUTOMATICA_LABEL,
  COBRO_RECHAZO_TEXTO,
  MOTIVO_NO_ANULABLE_TEXTO,
} from "@/components/shared/wallet/detalle-movimiento-panel-labels";

describe("466 · R1 — conceptos de dinero en la wallet (C5-C14, C16-C24)", () => {
  it("composicion: los dos reversos del cobro (C5, C6)", () => {
    expect(EGRESO_NOMBRADO_LABEL.egreso_reverso_flete_devolucion).toBe(
      "Fletes por devolución a origen cobrados a una tienda anulados",
    );
    expect(EGRESO_NOMBRADO_LABEL.egreso_reverso_iva_flete_devolucion).toBe(
      "IVA de fletes por devolución a origen cobrados a una tienda anulados",
    );
  });

  it("libro de la tienda desde la oficina (C7-C10)", () => {
    expect(CATEGORIA_TIENDA_LABEL.flete_devolucion).toBe("Flete por devolución a origen cobrado a la tienda");
    expect(CATEGORIA_TIENDA_LABEL.iva_flete_devolucion).toBe(
      "IVA del flete por devolución a origen cobrado a la tienda",
    );
    expect(CATEGORIA_TIENDA_LABEL.flete_devolucion_anulado).toBe("Cobro por devolución a origen anulado");
    expect(CATEGORIA_TIENDA_LABEL.iva_flete_devolucion_anulado).toBe("IVA del cobro por devolución a origen anulado");
  });

  it("Mi wallet, la lectura desde la tienda (C11-C14)", () => {
    expect(CATEGORIA_MI_WALLET_LABEL.flete_devolucion).toBe("Ordenex te cobró el flete por devolución a origen");
    expect(CATEGORIA_MI_WALLET_LABEL.iva_flete_devolucion).toBe(
      "Ordenex te cobró el IVA del flete por devolución a origen",
    );
    expect(CATEGORIA_MI_WALLET_LABEL.flete_devolucion_anulado).toBe(
      "Ordenex anuló el flete por devolución a origen y te lo devolvió",
    );
    expect(CATEGORIA_MI_WALLET_LABEL.iva_flete_devolucion_anulado).toBe(
      "Ordenex anuló el IVA del flete por devolución a origen y te lo devolvió",
    );
  });

  it("«Anular …» y el detalle del movimiento (C16-C20)", () => {
    expect(DOCUMENTO_CAJA_NOMBRE.rechazo_tienda_cobro).toBe("el cobro por devolución a origen a una tienda");
    expect(ACCION_AUTOMATICA_LABEL.cobro_por_rechazo).toBe("Cobro por devolución a origen aprobado");
    expect(MOTIVO_NO_ANULABLE_TEXTO.no_aprobado).toBe("el cobro por devolución a origen no está aprobado");
    expect(COBRO_RECHAZO_TEXTO.vigente).toBe(
      "Es un cobro a la tienda por el flete de una devolución a origen: la ganancia de Ordenex sube y el saldo de la tienda baja, sin dinero nuevo en la caja.",
    );
    expect(COBRO_RECHAZO_TEXTO.anulado).toBe(
      "Este cobro por devolución a origen se anuló: la ganancia de Ordenex bajó y el saldo de la tienda volvió a subir. El cobro sigue aprobado en su cola y no se vuelve a ofrecer.",
    );
  });

  it("la cola de cobros (C21-C24) y lo que se conserva de ella (R13: el acto de la tienda)", () => {
    expect(COBROS_RECHAZO_SECCION).toBe("Cobros por devolución a origen de tienda por aprobar");
    expect(COBROS_RECHAZO_TITULO).toBe("Cobros por devolución a origen de tienda por aprobar");
    expect(COBROS_RECHAZO_COLUMNA.flete).toBe("Flete por devolución a origen");
    expect(COBROS_RECHAZO_COLUMNA.generadoEl).toBe("Fecha de la devolución a origen");
    expect(COBRO_RECHAZO_MENSAJE.sinPermiso).toBe(
      "No tenés permiso para decidir cobros por devolución a origen de tienda.",
    );
    expect(COBRO_RECHAZO_MENSAJE.errorCarga).toBe("No se pudieron cargar los cobros por devolución a origen de tienda.");
    expect(COBROS_RECHAZO_DESCRIPCION).toBe(
      "La tienda rechazó estas devoluciones desde novedades. Todavía no se le cobró nada: esperan tu decisión.",
    );
    expect(COBRO_RECHAZO_MENSAJE.rechazado).toBe("Cobro descartado: no se le cobró nada a la tienda.");
  });
});

describe("466 · R4, R5 — cierres y tarifas (C29-C35, E8-E10)", () => {
  it("tarifas: los dos fletes y el pago por zona junto a «Entregado» (C29-C32)", () => {
    expect(TARIFA_CAMPO_LABEL.valorFleteDevuelto).toBe("Flete por devolución a origen");
    expect(TARIFA_CAMPO_LABEL.valorFleteDevueltoGam).toBe("Flete por devolución a origen GAM");
    expect(PAGO_ZONA_TEXTO.rechazado).toBe("Devolución a origen por rechazo");
    expect(PAGO_ZONA_TEXTO.entregado).toBe("Entregado");
    expect(PAGO_ZONA_TEXTO.seccionAyuda).toBe(
      "Lo que Ordenex paga por cada gestión en esta zona: la entrega se le paga al mensajero; " +
        "una Devolución a origen por rechazo es ingreso de la bodega responsable del mensajero.",
    );
  });

  it("cierres: flete, IVA, GAM y con IVA (C33)", () => {
    expect(FLETE_RECHAZO_LABEL).toBe("Flete por devolución a origen");
    expect(IVA_FLETE_RECHAZO_LABEL).toBe("IVA del flete por devolución a origen");
    expect(FLETE_RECHAZO_GAM_LABEL).toBe("Flete por devolución a origen GAM");
    expect(FLETE_DEV_CON_IVA_LABEL).toBe("Flete por devolución a origen + IVA");
  });

  it("cierres: el ingreso de bodega y las notas (C34, C35)", () => {
    expect(INGRESO_BODEGA_RECHAZOS_LABEL).toBe("Ingreso de bodega por devoluciones a origen");
    expect(GANA_BODEGA_SATELITE_NOTA).toBe(
      "Lo que se le reconoce a la bodega satélite por las devoluciones a origen. No es un movimiento de caja registrado.",
    );
    expect(FLETE_RECHAZO_NO_DEDUCIBLE_NOTA).toBe(
      "Se le factura a la tienda, pero no sale de lo recaudado: una devolución a origen no cobra contra entrega.",
    );
    expect(NETO_ORDENEX_NOTA).toBe(
      "Lo que Ordenex facturó menos el pago al mensajero y menos el ingreso de bodega por devoluciones a origen.",
    );
  });

  it("cierres: los marcadores de origen y el motivo automatico (E8-E10)", () => {
    expect(RECHAZO_SLA_BADGE_NOTA).toBe(
      "Devolución a origen automática por vencerse el plazo de la novedad (no lo hizo el mensajero).",
    );
    expect(RECHAZO_MANUAL_BADGE_NOTA).toBe("Devolución a origen registrada manualmente por el mensajero.");
    expect(MOTIVO_RECHAZO_AUTOMATICO_COLA).toBe(
      "el sistema la pasó a devolución a origen al vencerse el plazo de la novedad",
    );
  });

  it("R13: el estado de un CIERRE rechazado no cambia", () => {
    expect(ESTADO_LABEL.rechazado).toBe("Rechazado");
  });
});

describe("466 · R9, R13 — novedades (C36, E7 y la nota del tope)", () => {
  it("el aviso del modal de rechazo cambia el concepto (C36) y conserva la accion y el motivo (R13)", () => {
    expect(RECHAZO_AVISO).toBe(
      "Esto le cobra a tu tienda el flete por devolución a origen y no se puede deshacer. Si preferís volver a intentar la entrega, usá «Reprogramar».",
    );
    expect(RECHAZO_TITULO).toBe("Rechazar la orden");
    expect(RECHAZO_MOTIVO_LABEL).toBe("Motivo del rechazo");
  });

  it("la gestion desde ayuda: confirmacion (E7), nota del tope (decision del leader) y boton «Rechazar» (R13)", () => {
    expect(GESTION_AYUDA_EXITO.rechazar).toBe("La orden quedó en Devolución a origen por rechazo.");
    expect(GESTION_AYUDA_TOPE_NOTA).toBe(
      "A esta orden le queda el último intento de entrega, así que ya no se puede reprogramar: volver a mandarla a la calle sería un intento de más. Lo que sí podés registrar desde acá es la devolución a origen por rechazo, y el mensajero todavía puede entregarla.",
    );
    expect(GESTION_AYUDA_CONFIRMAR.rechazar).toBe("Rechazar");
  });
});

describe("466 · R8 — analitica de productos (K3, K4, C37, C38)", () => {
  it("la tabla y el detalle de dinero (K3, C37)", () => {
    expect(PRODUCTOS_COLUMNAS.rechazo).toBe("% de devolución a origen");
    expect(DETALLE_DINERO_TEXTOS.totales.retorno).toBe("Flete por devolución a origen");
    expect(DETALLE_DINERO_TEXTOS.columnas.retorno).toBe("Flete por devolución a origen");
    expect(DETALLE_DINERO_TEXTOS.totales.retornoPista).toBe(
      "Flete por devolución a origen + IVA de las órdenes en Devolución a origen por rechazo. Fuera del reparto",
    );
  });

  it("la descarga: encabezados nuevos con sus CLAVES de siempre (K4, C38; R26)", () => {
    const enc = (cols: { clave: string; encabezado: string }[], clave: string) =>
      cols.find((c) => c.clave === clave)?.encabezado;
    expect(enc(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS, "rechazo")).toBe("Devolución a origen (%)");
    expect(enc(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO, "retorno")).toBe(
      "Flete por devolución a origen (no sumar: importe de la orden completa)",
    );
  });
});
