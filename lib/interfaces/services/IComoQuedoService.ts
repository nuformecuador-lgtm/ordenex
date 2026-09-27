import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ComoQuedoInput, ComoQuedoResult } from "@/lib/types/como-quedo";

/** Resultados de DOMINIO: `unauthenticated` y `validation_error` los decide el borde. */
export type ComoQuedoServiceResult = Exclude<ComoQuedoResult, { status: "unauthenticated" | "validation_error" }>;

/** FICHA 458-B (design §3.7, R58, R82) — «Cómo quedó» tras un movimiento. Acceso total, antes de leer. */
export interface IComoQuedoService {
  comoQuedo(input: ComoQuedoInput, actor: Actor): Promise<ComoQuedoServiceResult>;
}
