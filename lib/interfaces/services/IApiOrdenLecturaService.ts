import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrderStatusValue } from "@/lib/types/order-status";
import type { ApiOrdenDetalleDTO, ApiOrdenListadoDTO } from "@/lib/types/api-orden";

// Feature 106 (design §2/§3) — contrato del service de LECTURA del canal integrador (API por
// key). El owner SIEMPRE se resuelve como `actor.usuarioId` (R4); ningun parametro amplia el
// scope. Sin acoplarse a HTTP: el borde traduce el resultado a Response.

/** Parametros ya validados en el borde: paginacion offset/limit (tope 100) + filtros opcionales. */
export interface ApiOrdenListarParams {
  limit: number;
  offset: number;
  estado?: OrderStatusValue;
  // Feature 257 (R4/R5/R6/R13/R16): filtros OPCIONALES que solo ACOTAN dentro del owner.
  // `desde`/`hasta` llegan YA VALIDADAS por el borde como fecha CALENDARIO `YYYY-MM-DD` de
  // Costa Rica (sin hora y sin zona); el service —no el repo— las traduce a instantes UTC.
  desde?: string;
  hasta?: string;
  numGuia?: number;
  numRemision?: string;
}

export interface IApiOrdenLecturaService {
  /**
   * R6/R8/R10: pagina de ordenes del owner (`actor.usuarioId`). Resuelve `estado` a `estatusId`
   * si viene. Devuelve items publicos + paginacion (`limit/offset/total`).
   */
  listar(actor: Actor, params: ApiOrdenListarParams): Promise<ApiOrdenListadoDTO>;
  /**
   * R12/R13/R14/R15/R18: detalle de UNA orden propia por `num_guia` con sus evidencias firmadas.
   * `null` si no existe / borrada / de otro owner (el borde -> 404 uniforme, no filtra existencia).
   */
  detalle(actor: Actor, numGuia: number): Promise<ApiOrdenDetalleDTO | null>;
  /**
   * Feature 177 (R16/R17): MISMO detalle publico que `detalle`, resuelto por `orden.id` (la
   * resolucion de `{id}` entrega un id y `num_guia` puede ser NULL). Owner forzado a
   * `actor.usuarioId`. `null` si no existe / borrada / de otro owner (el borde -> 404 uniforme).
   */
  detallePorOrdenId(actor: Actor, ordenId: string): Promise<ApiOrdenDetalleDTO | null>;
}
