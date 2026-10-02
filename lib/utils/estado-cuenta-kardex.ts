import type { EstadoCuentaDTO, FilaEstadoCuentaDTO, TipoDeCuenta } from "@/lib/types/estado-cuenta";
import type { KardexDTO, MontoEnColumna } from "@/lib/types/libro-kardex";
import { sentidoDelSaldo } from "@/lib/utils/estado-cuenta";
import { afirmarCuadreDelKardex, totalesDe } from "@/lib/utils/libro-kardex";

/**
 * Ficha 468 (design §3.1/§3.3, R9/R11/R13/R15) — el KARDEX de un estado de cuenta (tienda, mensajero,
 * bodega satelite u `/mi-wallet`), armado sobre lo que el estado de cuenta YA trae: el saldo de cada fila
 * es su `saldoCorrido` (R11), y el inicial y el final son los de la tarjeta (R13). Aqui no se lee nada ni
 * se calcula ningun saldo: se COLOCA cada importe en su columna, se suman las columnas y se AFIRMA que
 * todo cuadra.
 *
 * PURO y money-safe.
 */

/**
 * Que lado del extracto SUBE el saldo de la cuenta. Sale del MISMO sentido con el que el servicio
 * calcula el saldo final (`saldoAlFinal`): a favor del titular (tienda, mensajero) sube el abono; en la
 * bodega, el saldo es lo que tiene POR ENTREGAR y lo sube el cargo (lo declarado). No se decide dos veces.
 */
export function ladoQueSube(tipo: TipoDeCuenta): "abono" | "cargo" {
  return sentidoDelSaldo(tipo) === "por_entregar" ? "cargo" : "abono";
}

/** R9 — la columna de una fila del extracto: lo que sube el saldo va a «Entra»; lo que lo baja, a «Sale». */
export function columnaDeCuenta(fila: Pick<FilaEstadoCuentaDTO, "cargo" | "abono">, sube: "abono" | "cargo"): MontoEnColumna {
  if (fila.abono !== null) return { columna: sube === "abono" ? "entra" : "sale", monto: fila.abono };
  if (fila.cargo !== null) return { columna: sube === "cargo" ? "entra" : "sale", monto: fila.cargo };
  throw new Error("estado de cuenta: una fila sin cargo ni abono");
}

/**
 * El kardex de un estado de cuenta YA LEIDO. `ordenes` va alineado por indice con `estado.filas` (los
 * conteos de R18/R61; `null` = no repartible). Con `conOtrosFiltros = false` afirma R15 y lanza si no
 * cuadra. Las filas DEBEN venir en orden cronologico ascendente (lo fuerza quien lee).
 */
export function kardexDeCuenta(
  estado: EstadoCuentaDTO,
  conOtrosFiltros: boolean,
  ordenes: readonly (number | null)[],
): KardexDTO {
  if (ordenes.length !== estado.filas.length) {
    throw new Error("estado de cuenta: los conteos de ordenes no estan alineados con las filas");
  }
  const sube = ladoQueSube(estado.cuenta.tipo);
  const montos = estado.filas.map((f) => columnaDeCuenta(f, sube));
  const kardex: KardexDTO = {
    saldoInicial: estado.saldoInicial,
    saldoFinal: estado.saldoFinal,
    totales: totalesDe(montos, false),
    conOtrosFiltros,
    filas: estado.filas.map((f, i) => ({ monto: montos[i], saldo: f.saldoCorrido, ordenes: ordenes[i] })),
  };
  if (!conOtrosFiltros) afirmarCuadreDelKardex(kardex, `estado de cuenta (${estado.cuenta.tipo})`);
  return kardex;
}
