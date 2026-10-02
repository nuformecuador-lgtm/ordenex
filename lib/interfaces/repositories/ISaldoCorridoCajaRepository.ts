import type { WalletMovimientoCategoria } from "@/lib/types/wallet";

/**
 * Ficha 468 (design §3.4, R12/R15) — el SALDO CORRIDO de la caja principal, para el kardex de su
 * descarga. La caja no tenia saldo por fila; este es el de la tarjeta (`derivarCaja(...).enCaja`), fila a
 * fila, sobre la caja ENTERA (sin filtros).
 *
 * Interfaz aparte de `IWalletMovimientoRepository` a proposito: aquella la implementan a mano decenas de
 * dobles de test que no tienen nada que ver con la descarga. La implementa el MISMO repositorio
 * (`WalletMovimientoRepository`).
 */
export interface ISaldoCorridoCajaRepository {
  /**
   * El saldo de la caja ENTERA justo despues de cada uno de `ids`: una ventana
   * `SUM(+monto ingreso / −monto egreso de los conceptos de efectivo) OVER (ORDER BY fecha_movimiento,
   * created_at, id)` sobre TODO el libro hasta `hasta` (exclusivo; ausente = el libro entero), y despues
   * se queda con los `ids`. Las categorias de efectivo NO se escriben en SQL: las pasa el servicio,
   * derivadas de `LIQUIDEZ_POR_CATEGORIA`. Salida: id → saldo STRING escala 2. Un id fuera del corte no
   * vuelve.
   */
  saldosTrasMovimientos(
    ids: readonly string[],
    efectivo: readonly WalletMovimientoCategoria[],
    hasta?: Date,
  ): Promise<Map<string, string>>;
}
