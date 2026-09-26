import type {
  WalletTiendaMovimientoCategoria,
  WalletTiendaMovimientoTipo,
} from "@/lib/types/wallet-tienda";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

// Feature 43 (T15) — etiquetas i18n-ready y helper de moneda del ledger POR TIENDA,
// separados de la logica (docs/conventions: textos de UI fuera del componente).
// Money-safe (R21/R27): `money` recibe un monto que YA viene como STRING desde el Server
// Component y solo le da formato; NUNCA parseFloat/Number sobre montos.

/**
 * Feature 201 (tanda B): `money` se PROMOVIO a `lib/config/moneda.ts` sin cambiarle la firma
 * ni el marcador de ausencia (`"—"`), porque era la misma funcion copiada byte a byte en
 * siete archivos de etiquetas. Se re-exporta desde aqui para que sus consumidores sigan
 * importandola del mismo sitio: es una mudanza, y lo unico que cambia es el ASPECTO del
 * importe (ahora con separador de miles), que es el objetivo de la feature.
 *
 * Esta es la que alimenta TAMBIEN a `/wallet/tiendas` (R20): `desglose-tienda-labels.ts` la
 * re-exporta desde aqui y `SaldosTiendasTable` la importa directo, para que las dos caras
 * del mismo ledger no dupliquen el formato.
 */
export { money } from "@/lib/config/moneda";

/**
 * Feature 172 (T G.2, R55) `[P5]` — los TRES importes de la cabecera de `/mi-wallet`, mas el
 * saldo, en el orden de la formula: `saldo = a tu favor − cargos − ya pagado`.
 *
 * Por que son etiquetas PROPIAS y no un re-export de `DESGLOSE_TIENDA_LABEL` (la cabecera del
 * maestro, `/wallet/tiendas`): aquella habla de la tienda en tercera persona («A favor de la
 * tienda», «Pagado a la tienda») porque la lee quien paga. Esta pantalla la lee la tienda
 * sobre SU propio dinero, y el resto de `/mi-wallet` ya le habla de vos. Lo que NO se duplica
 * —y es lo unico que importa que no se duplique— es la CLASIFICACION: en que cubeta cae cada
 * concepto lo decide `CUBETA_POR_CATEGORIA` en el servidor, una sola vez, para las dos
 * pantallas.
 *
 * «Ya pagado» esta separado de «Cargos de Ordenex» a proposito: los dos son debitos del libro,
 * pero uno es lo que te cobraron y el otro lo que ya te entregaron. Plegados en un solo
 * importe, la tienda veria el dinero que recibio contado como un cargo mas.
 */
//
// Ficha 461 (HD3, design §7.5, R45) — las tres pistas se leen DESDE LA TIENDA («lo que Ordenex te
// cobró», «lo que Ordenex te devolvió al anular») y nombran el cobro y su anulación con la MISMA
// palabra con la que se rotula su fila en esta pantalla (`CATEGORIA_MI_WALLET_LABEL`): «Ordenex te
// cobró» / «Ordenex anuló un cobro y te lo devolvió». Sin la sigla «COD» (P9).
export const DESGLOSE_MI_WALLET_LABEL = {
  aFavor: "A tu favor",
  // Ficha 457 (design §2, R50): nombra lo que le pagaste a Ordenex y su anulación.
  aFavorHint:
    "Lo cobrado a tus clientes, las correcciones a tu favor, lo que le pagaste a Ordenex y lo que Ordenex te devolvió al anular",
  cargos: "Cargos de Ordenex",
  // FICHA 381 (R37) — la enumeración no es solo de conceptos AUTOMÁTICOS: dentro de este importe
  // puede haber un cobro decidido por una persona, y la tienda tiene que poder relacionarlo con la
  // fila que va a leer en su libro («Ordenex te cobró»).
  cargosHint: "Fletes, comisión, IVA, lo que Ordenex te cobró y los pagos a Ordenex que se anularon",
  pagado: "Ya pagado",
  // Ficha 459 (T B.17, design §5): el pago de un gasto de la tienda cae en `pagado` (dinero
  // entregado a la tienda a traves de un tercero, decision de la 458 §2.6), y la pista lo nombra.
  pagadoHint: "Lo que Ordenex te pagó o pagó por ti",
  saldo: "Saldo a favor",
} as const;

/**
 * Feature 172 (T G.2) — la limitacion N1, declarada donde se leen las cifras que afecta.
 *
 * MISMA regla y MISMO lenguaje que el aviso de T F.6 en la cabecera del maestro: hace falta
 * donde se muestra un importe AGREGADO que sigue contando lo anulado. Aqui hacen falta dos —
 * «Ya pagado» conserva el pago anulado y «A tu favor» suma su devolucion— y el saldo, que es
 * la resta de los tres, sale exacto.
 *
 * Se compone con los rotulos REALES de la cabecera: el dia que alguien renombre un importe, el
 * aviso lo sigue en vez de hablar de una cifra que ya no se llama asi. Sin jerga: ni
 * «contraasiento», ni «neteo», ni siglas.
 */
export const DESGLOSE_MI_WALLET_AVISO =
  `«${DESGLOSE_MI_WALLET_LABEL.pagado}» sigue contando los pagos que se anularon, y ` +
  `«${DESGLOSE_MI_WALLET_LABEL.aFavor}» suma la devolución de cada uno, así que esos dos ` +
  `importes quedan más altos de lo que se movió de verdad. «${DESGLOSE_MI_WALLET_LABEL.saldo}» ` +
  `ya tiene todo eso descontado: ese es el número correcto.`;

/** Etiqueta legible del tipo de movimiento (credito a favor / debito). */
export const TIPO_TIENDA_LABEL: Record<WalletTiendaMovimientoTipo, string> = {
  credito: "Crédito",
  debito: "Débito",
};

/**
 * Ficha 461 (HD3, design §7.5, R44; P4) — LA LECTURA DESDE LA TIENDA de cada concepto de su libro.
 *
 * Es el MISMO libro que ve la oficina en `/wallet/tiendas`, pero leido desde el otro lado: la
 * tienda lee «Ordenex te cobró» donde la oficina lee «Ordenex le cobra a la tienda». Por eso son
 * DOS diccionarios y no uno (design §9, alternativa A8 descartada): un solo texto neutro no puede
 * decir las dos cosas a la vez. Los dos son `Record` totales sobre el mismo enum, y un test exige
 * que difieran en todo concepto en el que una de las dos partes actua sobre la otra (R44).
 *
 * El de la oficina vive en `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts`
 * (`CATEGORIA_TIENDA_LABEL`) y es el que el dialogo «Registrar movimiento» promete (R46).
 *
 * Segunda persona, sin siglas («contra-entrega», no «COD»; P9) y sin jerga («corrección», no
 * «ajuste»). Lo lee la tienda en la tabla, en el filtro por concepto y en su descarga (R44): las
 * tres superficies salen de aqui.
 */
export const CATEGORIA_MI_WALLET_LABEL: Record<WalletTiendaMovimientoCategoria, string> = {
  cod_recaudado: "Cobrado a tus clientes en contra-entrega",
  flete: "Ordenex te cobró el flete",
  flete_devolucion: "Ordenex te cobró el flete por rechazo",
  comision_cod: "Ordenex te cobró la comisión de contra-entrega",
  iva_flete: "Ordenex te cobró el IVA del flete",
  iva_flete_devolucion: "Ordenex te cobró el IVA del flete por rechazo",
  iva_comision_cod: "Ordenex te cobró el IVA de la comisión",
  // FICHA 381 (R33/R34): el cobro decidido por una persona, DISTINTO de una correccion.
  cobro_manual: "Ordenex te cobró",
  cobro_tienda_anulado: "Ordenex anuló un cobro y te lo devolvió",
  pago_tienda: "Ordenex te pagó",
  // P5: el beneficiario («A Facebook…») vive en la descripcion, que la columna de origen añade.
  pago_por_cuenta: "Ordenex pagó un gasto por ti",
  pago_por_cuenta_anulado: "Ordenex anuló un pago hecho por ti",
  // Ficha 457 (design §2, D10, R47): la lectura DESDE LA TIENDA, distinta de la de Ordenex
  // (`CATEGORIA_TIENDA_LABEL`). «Le pagaste a Ordenex» es el nombre reservado por la 461 §7.8.
  abono_tienda: "Le pagaste a Ordenex",
  abono_tienda_anulado: "Ordenex anuló el pago que le hiciste",
  // Ficha 458-B (design §2.3, D7): la anulación de un cobro por rechazo, desde la tienda.
  flete_devolucion_anulado: "Ordenex anuló el flete por rechazo y te lo devolvió",
  iva_flete_devolucion_anulado: "Ordenex anuló el IVA del flete por rechazo y te lo devolvió",
  ajuste_credito: "Corrección a tu favor",
  ajuste_debito: "Corrección en tu contra",
};

/**
 * Etiqueta legible del origen de un movimiento (WalletOrigenTipo, subconjunto de la 43).
 *
 * `Record<string, string>` con caida al valor crudo: el compilador NO avisa si falta un origen.
 * Por eso un test recorre `WALLET_ORIGEN_TIPO_SEED` y exige rotulo aqui para cada origen que
 * escribe en el libro de la tienda (`tests/unit/components/mi-wallet-labels.test.ts`).
 *
 * Ficha 461 (design §7.3): los MISMOS textos que `ORIGEN_LABEL` en el libro de la caja para los
 * origenes que comparten («Registrado a mano», «Pago de Ordenex a una tienda», «Pago de un gasto de
 * una tienda»); y + `cobro_tienda`, el credito de la anulacion de un cobro. Los lee tambien la
 * oficina en `/wallet/tiendas` (que reexporta este objeto).
 */
export const ORIGEN_TIENDA_LABEL: Record<string, string> = {
  cierre_dia: "Cierre del día",
  pago_tienda: "Pago de Ordenex a una tienda",
  manual: "Registrado a mano",
  gestion_orden: "Gestión de orden",
  pago_por_cuenta_tienda: "Pago de un gasto de una tienda",
  cobro_tienda: "Cobro de Ordenex a una tienda",
  // Ficha 457 (design §2/§4.2): el compilador NO avisa aqui (`Record<string, string>`); sin esta
  // clave, tabla y descargas pintarian `abono_tienda`. El MISMO texto que `ORIGEN_LABEL` en la caja.
  abono_tienda: "Pago de una tienda a Ordenex",
};

/** Origen legible con fallback al valor crudo si no hay etiqueta conocida. */
export function origenLabel(origenTipo: string): string {
  return ORIGEN_TIENDA_LABEL[origenTipo] ?? origenTipo;
}

/**
 * Opciones del `Select` de concepto de `/mi-wallet`, pobladas desde el SEED (con opcion "todos") y
 * rotuladas con la lectura desde la tienda (R44).
 */
export const CATEGORIA_MI_WALLET_OPTIONS = [
  { value: "", label: "Todos los conceptos" },
  ...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({
    value: categoria,
    label: CATEGORIA_MI_WALLET_LABEL[categoria],
  })),
];
