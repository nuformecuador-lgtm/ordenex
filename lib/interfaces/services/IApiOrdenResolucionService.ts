import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * Feature 177 (design §4.1) — resultado de resolver el identificador libre `{id}` del canal
 * integrador contra UNA orden propia.
 *
 * `via` NO viaja a la respuesta HTTP (el contrato publicado no lo incluye): existe para que el
 * test discriminante de la precedencia (R14) pueda afirmar POR QUE columna resolvio, ademas de
 * QUE orden devolvio.
 *
 * NO existe variante `ambiguo` ni nada que un borde pueda traducir a `409 CONFLICT`: la
 * decision (a) del humano fijo una precedencia absoluta (`num_guia` gana) y la elimino del
 * dominio (R14/R15).
 */
export type ResolverOrdenResult =
  | { status: "ok"; orden: { id: string; numGuia: number | null }; via: "num_guia" | "num_remision" }
  | { status: "not_found" };

export interface IApiOrdenResolucionService {
  /**
   * Feature 177/R6/R8/R9/R14/R15: resuelve `identificador` contra las ordenes del owner
   * (`actor.usuarioId`, R4 — NUNCA un owner que venga de la peticion), evaluando `num_guia`
   * solo si el identificador normalizado es un entero positivo (R8/R9) y aplicando la
   * precedencia fija `num_guia` > `num_remision` (R14). Sin coincidencias -> `not_found`
   * (R11/R12, 404 uniforme en el borde).
   */
  resolver(actor: Actor, identificador: string): Promise<ResolverOrdenResult>;
}
