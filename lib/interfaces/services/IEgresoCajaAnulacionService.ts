import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { AnularEgresoCajaInput, AnularEgresoCajaResult } from "@/lib/types/wallet-anulacion";

/**
 * FICHA 458-B (D13, R63–R67, R72) — contrato del servicio que ANULA CON MOTIVO un egreso de la caja
 * sin documento propio: sueldo, gasto de Ordenex, gasto fijo cobrado (origen `gasto`) o
 * indemnizacion por incidente (origen `orden_incidente`).
 *
 * Hasta hoy los tres primeros solo se «reversaban» sin motivo (`WalletEgresoService.reversarEgreso`)
 * y la indemnizacion no tenia ninguna via. Esta es la via uniforme: motivo obligatorio, constancia
 * en `ajuste_caja_anulacion` (D13: la tabla que la 461 dejo con FK a `wallet_movimiento`),
 * contra-asiento `ingreso_ajuste` por el monto DEL ORIGINAL —el mismo molde que el reverso de
 * siempre— e historial `egreso_caja_anulado`. Nada se edita ni se borra.
 *
 * SERVICIO PROPIO y no un metodo mas de `WalletEgresoService`: aquel se construye en 32 sitios
 * con dos dependencias, y la anulacion necesita su repositorio, un ejecutor de transaccion y el
 * reloj. Precedente literal: `AjusteCajaService` (461) para la correccion de caja.
 *
 * Resultados de DOMINIO: `unauthenticated` y `validation_error` los decide el borde.
 */
export type AnularEgresoCajaServiceResult = Exclude<
  AnularEgresoCajaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface IEgresoCajaAnulacionService {
  /**
   * R82 — rol (acceso total) ANTES de leer. El egreso por su id y SOLO si es un original anulable
   * (egreso con origen `gasto`, o `egreso_indemnizacion` con origen `orden_incidente`); cualquier
   * otra fila responde `no_encontrado`. En UNA transaccion y con UN instante (`ahora()`):
   * constancia (su `createMany` con `skipDuplicates` es el candado: `0` ⇒ `ya_anulado`) →
   * contra-asiento (idempotente ademas por `(origen_tipo, origen_id, categoria)`; `0` ⇒ ya estaba
   * reversado SIN constancia, de antes de esta ficha: se revierte la constancia y `ya_anulado`).
   */
  anular(input: AnularEgresoCajaInput, actor: Actor): Promise<AnularEgresoCajaServiceResult>;
}
