import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EtiquetaGuiaDTO, EtiquetaOmitidaDTO } from "@/lib/types/etiqueta-guia";

// Feature 32 — contrato del servicio de "Etiqueta de guia". Logica de negocio
// pura (sin HTTP, sin Prisma); el borde (Server Action,
// `lib/actions/etiquetas-guia.ts`) lo traduce al resultado tipado expuesto.

// R1: conjunto de identificadores de orden a etiquetar (lista no vacia validada
// en el borde con zod, R15).
export interface GenerarEtiquetasInput {
  ordenIds: string[];
}

// Resultado de dominio del servicio (sin acoplarse a HTTP). `unauthenticated`
// (R14) y `validation_error` (R15) los maneja el borde; aqui solo `ok`
// (etiquetas + omitidas) o `forbidden` (R13). Una orden invalida NO aborta el
// lote (R3): se reporta en `omitidas`, no como error del resultado.
export type GenerarEtiquetasServiceResult =
  | { status: "ok"; etiquetas: EtiquetaGuiaDTO[]; omitidas: EtiquetaOmitidaDTO[] }
  | { status: "forbidden" }; // R13

export interface IEtiquetaGuiaService {
  /**
   * R1-R8/R13: dado un conjunto de ids de orden, arma el payload de etiqueta de
   * cada orden con `num_guia` asignado (nombres de tienda/geografia resueltos,
   * `montoCobrar` Decimal->number, `qrValue = ordenId`, `barcodeValue =
   * String(numGuia)`) y reporta como `omitidas` las que no tienen guia
   * (`sin_guia`, R2) o no existen/estan borradas (`no_encontrada`, R3), sin
   * abortar el lote. Solo `maestro` (R13); cualquier otro rol -> `forbidden`.
   */
  generarEtiquetas(
    input: GenerarEtiquetasInput,
    actor: Actor,
  ): Promise<GenerarEtiquetasServiceResult>;
}
