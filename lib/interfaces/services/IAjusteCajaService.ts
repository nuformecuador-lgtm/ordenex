import type { AjusteCajaAnulacionTxClient } from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { AnularAjusteCajaInput, AnularAjusteCajaResult } from "@/lib/types/wallet";

/**
 * FICHA 461 (R69–R71, auditoria de la wallet D3) — contrato del servicio que ANULA una CORRECCION
 * de caja (`ingreso_ajuste` / `egreso_ajuste` con origen `manual`).
 *
 * Hasta hoy una correccion equivocada solo se «corregia» con otra correccion a mano, sin motivo,
 * sin constancia y sin enlace entre las dos (auditoria D3: «tres caminos de dinero sin ninguna via
 * de correccion en la app»). Esta es la via: motivo obligatorio, constancia UNIQUE, contra-asiento
 * de tipo y categoria opuestos por el monto DE LA CORRECCION —leido en el servidor— fechado el dia
 * de la anulacion, e historial. Nada se edita ni se borra.
 *
 * SERVICIO PROPIO y no un metodo mas de `WalletService`: aquel se construye con cuatro dependencias
 * y lo instancian varias acciones; la anulacion necesita su repositorio y un ejecutor de
 * transaccion. `CobroTiendaService` y `AporteCapitalService` son el precedente.
 *
 * Resultados de DOMINIO: `unauthenticated` y `validation_error` los decide el borde.
 */
export type AjusteCajaTxRunner = <T>(fn: (tx: AjusteCajaAnulacionTxClient) => Promise<T>) => Promise<T>;

export type AnularAjusteCajaServiceResult = Exclude<
  AnularAjusteCajaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface IAjusteCajaService {
  /**
   * R69/R70 — rol (acceso total) ANTES de leer; la correccion por su id y SOLO si es una original
   * (`ingreso_ajuste`/`egreso_ajuste`, origen `manual`, sin `origen_id`): cualquier otra fila —su
   * contra-asiento, el reverso de un egreso, un asiento automatico— responde `no_encontrado`. En una
   * transaccion: constancia (el UNIQUE es el candado: dos a la vez → una sola) + contra-asiento por
   * el monto de la correccion + historial. Segundo intento → `ya_anulado`.
   */
  anular(input: AnularAjusteCajaInput, actor: Actor): Promise<AnularAjusteCajaServiceResult>;
}
