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
export const DESGLOSE_MI_WALLET_LABEL = {
  aFavor: "A tu favor",
  aFavorHint: "COD recaudado y ajustes",
  cargos: "Cargos de Ordenex",
  cargosHint: "Fletes, comisión e IVA",
  pagado: "Ya pagado",
  pagadoHint: "Lo que Ordenex ya te entregó",
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

/** Etiqueta legible de cada categoria (concepto) del ledger por tienda. */
export const CATEGORIA_TIENDA_LABEL: Record<WalletTiendaMovimientoCategoria, string> = {
  cod_recaudado: "COD recaudado",
  flete: "Flete",
  flete_devolucion: "Flete por rechazo",
  comision_cod: "Comisión COD",
  iva_flete: "IVA del flete",
  iva_flete_devolucion: "IVA del flete por rechazo",
  iva_comision_cod: "IVA de la comisión",
  pago_tienda: "Pago a la tienda",
  ajuste_credito: "Ajuste (crédito)",
  ajuste_debito: "Ajuste (débito)",
};

/** Etiqueta legible del origen de un movimiento (WalletOrigenTipo, subconjunto de la 43). */
export const ORIGEN_TIENDA_LABEL: Record<string, string> = {
  cierre_dia: "Cierre del día",
  pago_tienda: "Pago a la tienda",
  manual: "Manual",
};

/** Origen legible con fallback al valor crudo si no hay etiqueta conocida. */
export function origenLabel(origenTipo: string): string {
  return ORIGEN_TIENDA_LABEL[origenTipo] ?? origenTipo;
}

/** Opciones del `Select` de concepto, pobladas desde el SEED (con opcion "todos"). */
export const CATEGORIA_TIENDA_OPTIONS = [
  { value: "", label: "Todos los conceptos" },
  ...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({
    value: categoria,
    label: CATEGORIA_TIENDA_LABEL[categoria],
  })),
];
