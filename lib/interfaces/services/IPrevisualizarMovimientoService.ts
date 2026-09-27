import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { PrevisualizarMovimientoInput, PrevisualizarMovimientoResult } from "@/lib/types/efecto-movimiento";

/** Resultados de DOMINIO: `unauthenticated` y `validation_error` de forma los decide el borde. */
export type PrevisualizarMovimientoServiceResult = Exclude<PrevisualizarMovimientoResult, { status: "unauthenticated" }>;

/**
 * FICHA 458-B (design §4.4, R44–R47, R82) — «Así queda»: el efecto de un registro ANTES de hacerlo.
 * Solo lectura. Acceso total ANTES de leer nada (R82).
 */
export interface IPrevisualizarMovimientoService {
  previsualizar(input: PrevisualizarMovimientoInput, actor: Actor): Promise<PrevisualizarMovimientoServiceResult>;
}
