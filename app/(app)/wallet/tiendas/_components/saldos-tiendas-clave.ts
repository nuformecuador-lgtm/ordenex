/**
 * Ficha 461 — auditoría de la wallet P1 (`progress/auditoria_wallet.md`): la CLAVE SWR de la tabla de
 * saldos de `/wallet/tiendas`, en un módulo puro para que la puedan compartir la tabla (que la lee) y
 * el bloque de pago del desglose (que la refresca).
 *
 * Por qué existe: tras pagar o anular desde el desglose, la cabecera del desglose se releía (R33 de la
 * 172) pero la FILA de la tabla de saldos, justo encima, se quedaba con la cifra vieja: dos cifras
 * distintas del mismo dinero en la misma pantalla hasta recargar. La clave lleva la página y el
 * tamaño, así que el refresco va por PREDICADO —alcanza la página que se esté viendo, sea cual sea—
 * y no por una clave literal. No importa de `SaldosTiendasTable.tsx` ni de `PagoTiendaAcciones.tsx`:
 * los dos importan de aquí y no hay ciclo.
 */

/** Prefijo de la clave. Identifica esta lectura entre todas las de la app. */
export const CLAVE_SALDOS_TIENDAS = "wallet-tiendas:saldos";

/** La clave de UNA página de la tabla de saldos. */
export function claveSaldosTiendas(
  page: number,
  pageSize: number,
): readonly [string, number, number] {
  return [CLAVE_SALDOS_TIENDAS, page, pageSize] as const;
}

/** Filtro de `mutate`: alcanza la tabla de saldos en cualquier página y tamaño, y nada más. */
export function esClaveSaldosTiendas(clave: unknown): boolean {
  return Array.isArray(clave) && clave[0] === CLAVE_SALDOS_TIENDAS;
}
