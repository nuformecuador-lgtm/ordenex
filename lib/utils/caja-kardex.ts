import { Prisma } from "@prisma/client";

import type { MontoEnColumna } from "@/lib/types/libro-kardex";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type WalletMovimientoCategoria,
  type WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { LIQUIDEZ_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";

/**
 * Ficha 468 (design §3.1/§3.4, R10/R12) — la columna de cada fila de la CAJA en el kardex y la lista de
 * conceptos que mueven el saldo, las dos DERIVADAS de `LIQUIDEZ_POR_CATEGORIA` (la clasificacion de la
 * 459 con la que `derivarCaja` calcula la cifra de la tarjeta). No hay una segunda clasificacion: un
 * concepto nuevo de la caja no compila hasta que alguien lo clasifique alli, y entonces llega aqui solo.
 *
 * Vive aparte de `caja-tesoreria.ts` (y no junto a la tabla, como decia el design) porque las guardias de
 * aquel modulo cuentan sus restas y sus exportaciones; esto no deriva ninguna cifra de la tarjeta.
 */

/**
 * Los conceptos de EFECTIVO: los unicos que mueven el saldo de la caja (lo que entro menos lo que salio
 * de verdad). El signo lo da el TIPO de la fila, como en `acumular` de `derivarCaja`.
 */
export const CATEGORIAS_EFECTIVO: readonly WalletMovimientoCategoria[] = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
  (c) => LIQUIDEZ_POR_CATEGORIA[c] === "efectivo",
);

/**
 * R10 — la columna de un movimiento de la caja: efectivo que entra → «Entra»; efectivo que sale → «Sale»;
 * un cargo a tienda → «Cobrado a tiendas» en positivo, y su reverso → «Cobrado a tiendas» en NEGATIVO
 * (un cambio de signo con `neg()`, no una operacion nueva).
 */
export function columnaDeCaja(m: {
  categoria: WalletMovimientoCategoria;
  tipo: WalletMovimientoTipo;
  monto: string;
}): MontoEnColumna {
  const esIngreso = m.tipo === "ingreso";
  if (LIQUIDEZ_POR_CATEGORIA[m.categoria] === "efectivo") {
    return { columna: esIngreso ? "entra" : "sale", monto: m.monto };
  }
  return {
    columna: "cobrado_a_tiendas",
    monto: esIngreso ? m.monto : new Prisma.Decimal(m.monto).neg().toFixed(2),
  };
}
