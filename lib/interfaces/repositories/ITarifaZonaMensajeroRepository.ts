// Feature 39 — contrato del resolver de la tarifa de pago al mensajero. Solo query
// Prisma (sin logica de negocio: el mapeo resultado->monto vive en el util puro
// lib/utils/pago-mensajero.ts). Money-safe: los Decimal se devuelven ya serializados
// a STRING escala 2.

// Tarifa de pago de una zona (resuelta por vehiculo o por defecto). `cobroEntregado`
// es el UNICO campo que la 39 paga al mensajero (solo por `entregada`). `cobroRechazado`
// se resuelve/transporta para no re-consultar, pero la 39 NO lo paga al mensajero: es un
// ingreso de bodega modelado en la feature 56 (`depends_on: 39`).
export interface PagoTarifa {
  cobroEntregado: string; // Decimal -> string 2 dec (money-safe)
  cobroRechazado: string; // presente pero NO se paga al mensajero (feature 56)
}

export interface ITarifaZonaMensajeroRepository {
  /**
   * R1/R2/R3: resuelve la tarifa de pago de una zona segun el vehiculo del mensajero:
   * 1) intenta la tarifa exacta (zonaId, vehiculoId) cuando hay vehiculo;
   * 2) si no hay tarifa especifica (o el mensajero no tiene vehiculo), cae a la tarifa
   *    por defecto de la zona (vehiculo_id IS NULL);
   * 3) `null` si la zona no tiene ninguna tarifa capturada (gap de datos, R8).
   * El indice unico (zona_id, vehiculo_id) NULLS NOT DISTINCT garantiza determinismo.
   */
  resolvePagoTarifa(zonaId: string, vehiculoId: string | null): Promise<PagoTarifa | null>;
}
