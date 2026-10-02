// Ficha 468 — la fila de UN movimiento en la hoja «Movimientos» (kardex), tal como la coloca la descarga
// real (`filasKardex` sobre la fila base de cada superficie). Para las pruebas de antes de la 468 que
// medían la proyección de una fila (`filaDescargaMovimientoCaja` / `filaDescargaEstadoCuenta`, retiradas):
// lo que afirmaban —las mismas palabras que la tabla, ningún id, ninguna columna de más— se sigue
// afirmando sobre la fila de hoy.
//
// El kardex es un DOBLE: su monto, su columna y su saldo son los que el servidor habría decidido; aquí se
// ponen fijos (el monto en «Entra») porque lo que se mide es lo que NO es dinero. Lo que es dinero lo
// miden `tests/unit/descarga/libro-kardex-468.test.ts` y los tests del servidor.
import { filaBaseCaja } from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { filaBaseCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { lineaDeFila, type RotulosEstadoCuenta } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { filasKardex } from "@/components/shared/wallet/libro-kardex-descarga";
import type { DescargaFila } from "@/lib/types/descarga";
import type { FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { KardexDTO } from "@/lib/types/libro-kardex";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

function kardexDeUna(monto: string, ordenes: number | null, columna: "entra" | "sale" = "entra"): KardexDTO {
  return {
    saldoInicial: "0.00",
    saldoFinal: monto,
    totales: { entra: columna === "entra" ? monto : "0.00", sale: columna === "sale" ? monto : "0.00", cobradoATiendas: null },
    conOtrosFiltros: false,
    filas: [{ monto: { columna, monto }, saldo: monto, ordenes }],
  };
}

/** La fila de un movimiento de la caja en la hoja «Movimientos» (la segunda: la primera es el saldo inicial). */
export function filaDeLibroCaja(
  movimiento: WalletMovimientoDTO,
  autoria?: AutoriaDeFilaDTO,
  ordenes: number | null = null,
): DescargaFila {
  return filasKardex({
    movimientos: [movimiento],
    kardex: kardexDeUna(movimiento.monto, ordenes),
    filaBase: (m, o) => filaBaseCaja(m, autoria, o),
    variante: "caja",
    fechaInicial: null,
  }).filas[1];
}

/**
 * La fila de un movimiento de un estado de cuenta (tienda o mensajero) en la hoja «Movimientos». El doble
 * del kardex pone el abono en «Entra» y el cargo en «Sale», que es lo que decide el servidor en una
 * tienda o un mensajero (R9; en la bodega es al revés y lo mide el servidor).
 */
export function filaDeLibroCuenta(
  fila: FilaEstadoCuentaDTO,
  rotulos: RotulosEstadoCuenta,
  ordenes: number | null = null,
): DescargaFila {
  return filasKardex({
    movimientos: [fila],
    kardex: kardexDeUna(fila.abono ?? fila.cargo ?? "0.00", ordenes, fila.abono !== null ? "entra" : "sale"),
    filaBase: (f, o) => filaBaseCuenta(lineaDeFila(f, rotulos), o),
    variante: "cuenta",
    fechaInicial: null,
  }).filas[1];
}
