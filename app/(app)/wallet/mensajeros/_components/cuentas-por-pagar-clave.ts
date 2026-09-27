/**
 * Ficha 461 — auditoría de la wallet P1 (`progress/auditoria_wallet.md`): la CLAVE SWR de la tabla de
 * cuentas por pagar de `/wallet/mensajeros`, en un módulo puro para que la puedan compartir la tabla
 * (que la lee) y el desglose (que la refresca tras registrar un pago).
 *
 * Por qué existe: tras el reparto de ₡100 la cabecera del desglose decía 15.700 / 5.000 y la fila de
 * la tabla, encima, seguía en 15.600 / 5.100 hasta recargar. La clave lleva la página, el tamaño y la
 * búsqueda aplicada, así que el refresco va por PREDICADO y alcanza lo que se esté viendo. Gemela de
 * `wallet/tiendas/_components/saldos-tiendas-clave.ts`, y por el mismo motivo sin ciclos de importación.
 */

/** Prefijo de la clave. Identifica esta lectura entre todas las de la app. */
export const CLAVE_CUENTAS_POR_PAGAR = "wallet-mensajeros:cuentas";

/** La clave de UNA página de la tabla de cuentas por pagar, con la búsqueda aplicada. */
export function claveCuentasPorPagar(
  page: number,
  pageSize: number,
  busqueda: string,
): readonly [string, number, number, string] {
  return [CLAVE_CUENTAS_POR_PAGAR, page, pageSize, busqueda] as const;
}

/** Filtro de `mutate`: alcanza la tabla de cuentas por pagar en cualquier página, y nada más. */
export function esClaveCuentasPorPagar(clave: unknown): boolean {
  return Array.isArray(clave) && clave[0] === CLAVE_CUENTAS_POR_PAGAR;
}
