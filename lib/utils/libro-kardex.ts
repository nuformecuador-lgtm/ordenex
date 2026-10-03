import { Prisma } from "@prisma/client";

import type { FilaKardexDTO, MontoEnColumna, TotalesPorColumna } from "@/lib/types/libro-kardex";
import { derivarBalance } from "@/lib/utils/wallet-balance";

/**
 * Ficha 468 (design §3.1, R8/R15) — lo COMUN del kardex de la caja y del estado de cuenta: los totales
 * por columna y la AFIRMACION de que el saldo corrido cuadra fila a fila.
 *
 * Modulo PURO y money-safe: `Prisma.Decimal` dentro, STRING fuera. Ninguna formula de dinero nueva:
 * los totales son SUMAS de importes ya guardados, y la unica resta (saldo − lo que sale) la hace
 * `derivarBalance`, que ya existe.
 */

/**
 * R8/R36/R44 — Σ por columna de unos importes ya colocados. `conCobrado` dice si la columna
 * «Cobrado a tiendas» existe (solo la caja): fuera de la caja, un importe en esa columna es un error
 * de construccion y se lanza en vez de perderlo.
 */
export function totalesDe(montos: readonly MontoEnColumna[], conCobrado: boolean): TotalesPorColumna {
  let entra = new Prisma.Decimal(0);
  let sale = new Prisma.Decimal(0);
  let cobrado = new Prisma.Decimal(0);
  for (const m of montos) {
    const v = new Prisma.Decimal(m.monto);
    if (m.columna === "entra") entra = entra.plus(v);
    else if (m.columna === "sale") sale = sale.plus(v);
    else if (conCobrado) cobrado = cobrado.plus(v);
    else throw new Error("libro kardex: un importe en «Cobrado a tiendas» fuera de la caja");
  }
  return { entra: entra.toFixed(2), sale: sale.toFixed(2), cobradoATiendas: conCobrado ? cobrado.toFixed(2) : null };
}

/** Los totales son iguales columna a columna (los importes ya vienen a escala 2). */
export function totalesIguales(a: TotalesPorColumna, b: TotalesPorColumna): boolean {
  return a.entra === b.entra && a.sale === b.sale && a.cobradoATiendas === b.cobradoATiendas;
}

/**
 * El kardex no cuadra. Clase propia para que quien lee la caja (sin una transaccion que abarque sus
 * lecturas) pueda distinguir este fallo de cualquier otro y repetir la lectura: ver `CajaKardexService`.
 */
export class KardexDescuadradoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "KardexDescuadradoError";
  }
}

/** El saldo despues de una fila: `Entra` lo sube, `Sale` lo baja, «Cobrado a tiendas» no lo mueve (R15). */
function saldoTras(previo: string, monto: MontoEnColumna): string {
  if (monto.columna === "entra") return new Prisma.Decimal(previo).plus(new Prisma.Decimal(monto.monto)).toFixed(2);
  if (monto.columna === "sale") return derivarBalance(previo, monto.monto).balance;
  return new Prisma.Decimal(previo).toFixed(2);
}

/**
 * R15 — MIENTRAS el unico filtro sea el periodo, cada saldo es el anterior + Entra − Sale y el saldo
 * final es el inicial + Σ Entra − Σ Sale (y el de la ultima fila). Si no cuadra se LANZA: la descarga
 * avisa y no sale un archivo con un saldo que no casa con la tarjeta (molde R22 de la 458-B).
 *
 * Con otros filtros no se afirma nada: el saldo de cada fila es el de la cuenta entera y Entra/Sale
 * suman solo lo filtrado (R16), asi que la identidad no tiene por que darse.
 */
export function afirmarCuadreDelKardex(
  k: { saldoInicial: string; saldoFinal: string; totales: TotalesPorColumna; filas: readonly Pick<FilaKardexDTO, "monto" | "saldo">[] },
  contexto: string,
): void {
  let esperado = new Prisma.Decimal(k.saldoInicial).toFixed(2);
  for (const [i, fila] of k.filas.entries()) {
    esperado = saldoTras(esperado, fila.monto);
    if (esperado !== fila.saldo) {
      throw new KardexDescuadradoError(`${contexto}: el saldo de la fila ${i + 1} no cuadra — esperado ${esperado}, servido ${fila.saldo}`);
    }
  }
  const porTotales = derivarBalance(new Prisma.Decimal(k.saldoInicial).plus(new Prisma.Decimal(k.totales.entra)), k.totales.sale).balance;
  if (porTotales !== k.saldoFinal || esperado !== k.saldoFinal) {
    throw new KardexDescuadradoError(
      `${contexto}: el saldo final no cuadra — inicial ${k.saldoInicial}, entra ${k.totales.entra}, sale ${k.totales.sale}, final ${k.saldoFinal}, ultima fila ${esperado}`,
    );
  }
}
