import type { ResultadoRastreoPublico } from "@/lib/types/rastreo-publico";

// Feature 229 (design §2.1) — contrato de la proyeccion publica de un envio.
//
// Service PROPIO y no un modo anonimo de `OrdenHistorialService` (R24): aquel exige un
// `Actor` en la primera linea y su DTO ya lleva `actorNombre`, `origenTipo`, `motivo`,
// `intentos` y `umbral`. Un modo publico dentro de el tendria que QUITAR campos, y quitar
// es una operacion que se olvida; aqui el campo peligroso nunca existe.

/**
 * Lo que el service puede responder. `demasiados_intentos` y `validation_error` NO estan:
 * pertenecen al borde (limite de tasa y zod), no a la proyeccion.
 */
export type ResultadoConsultaRastreo = Extract<
  ResultadoRastreoPublico,
  { estado: "ok" } | { estado: "no_encontrado" }
>;

export interface IRastreoPublicoService {
  /**
   * Identifica el envio por guia + segundo factor y devuelve su linea de hitos publicos.
   *
   * R7/R8 — los cuatro casos malos (guia inexistente, factor errado, orden borrada,
   * telefono de menos de N digitos) responden `no_encontrado`, con la MISMA forma y el
   * MISMO trabajo observable: la implementacion no puede cortar antes de comparar el
   * segundo factor.
   */
  consultar(numGuia: number, factor: string): Promise<ResultadoConsultaRastreo>;
}
