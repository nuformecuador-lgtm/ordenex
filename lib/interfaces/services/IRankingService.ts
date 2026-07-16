import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EditarPremioInput, RankingData } from "@/lib/types/ranking";

// Feature 76 (design §5) — contrato del servicio del ranking DIARIO. No conoce HTTP ni Prisma
// directamente: recibe los repos por inyeccion y `now` inyectable para testeo. Autorizacion
// por rol (R16/R17/R18/R19). Resultados de dominio como union discriminada (el borde/Server
// Action los traduce al resultado expuesto).

export type ObtenerRankingServiceResult =
  | { status: "ok"; data: RankingData }
  | { status: "forbidden" };

export type EditarPremioServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "invalid"; message: string };

export interface IRankingService {
  /**
   * R2-R7/R9/R12/R14-R18: calcula el ranking del DIA en curso (CR). `maestro` -> full +
   * editable; `mensajero` -> full solo-lectura; otro/sin sesion -> forbidden (sin datos).
   * `now` inyectable para testeo (default: reloj real).
   */
  obtenerRanking(actor: Actor, now?: Date): Promise<ObtenerRankingServiceResult>;
  /**
   * R10/R11/R16/R19: edita el monto de una posicion del podio. SOLO `maestro`; otro rol ->
   * forbidden (sin persistir). Monto invalido (negativo, >2 decimales, no numerico) ->
   * invalid (sin persistir). Monto null/vacio -> "sin premio".
   */
  editarPremio(actor: Actor, input: EditarPremioInput): Promise<EditarPremioServiceResult>;
}
