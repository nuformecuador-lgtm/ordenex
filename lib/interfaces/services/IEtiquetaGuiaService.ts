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

// Resultado de dominio de la etiqueta resuelta por `num_guia` (el QR codifica
// `num_guia`, no `orden.id`). `no_encontrada` cubre "ninguna orden con ese num_guia"
// y "orden borrada" (R3, el repo filtra deletedAt). `unauthenticated`/
// `validation_error` los agrega el borde.
export type EtiquetaPorGuiaServiceResult =
  | { status: "ok"; etiqueta: EtiquetaGuiaDTO }
  | { status: "no_encontrada" }; // R3

export interface IEtiquetaGuiaService {
  /**
   * R1-R8: dado un conjunto de ids de orden, arma el payload de etiqueta de cada
   * orden con `num_guia` asignado (nombres de tienda/geografia resueltos,
   * `montoCobrar` Decimal->number, `qrValue = String(numGuia)`, `barcodeValue =
   * String(numGuia)`) y reporta como `omitidas` las que no tienen guia (`sin_guia`,
   * R2, sin QR disponible) o no existen/estan borradas (`no_encontrada`, R3), sin
   * abortar el lote. Disponible para cualquier rol autenticado (la sesion se exige
   * en el borde); no filtra por visibilidad de la orden.
   */
  generarEtiquetas(
    input: GenerarEtiquetasInput,
    actor: Actor,
  ): Promise<GenerarEtiquetasServiceResult>;
  /**
   * R1-R8 por `num_guia`: arma el payload de etiqueta de la orden cuyo `num_guia` es
   * el escaneado/pedido en la URL del paquete (`/paquete/<numGuia>`). Mismo payload y
   * misma autorizacion que `generarEtiquetas` (cualquier rol autenticado; la sesion se
   * exige en el borde). Sin orden viva con ese `num_guia` -> `no_encontrada` (R3).
   */
  obtenerEtiquetaPorGuia(
    numGuia: number,
    actor: Actor,
  ): Promise<EtiquetaPorGuiaServiceResult>;
}
