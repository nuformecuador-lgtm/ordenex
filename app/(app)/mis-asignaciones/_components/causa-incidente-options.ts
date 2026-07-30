import { CAUSA_INCIDENTE_SEED, type CausaIncidente } from "@/lib/types/causa-incidente";

// Feature 158 (R33, decision Q-B del humano del 2026-07-30): etiquetas legibles de la causa
// del INCIDENTE. Hermano exacto de `causa-devolucion-options.ts` (73) de esta misma carpeta:
// la fuente de verdad de los VALORES es `CAUSA_INCIDENTE_SEED` (enum Postgres nativo); aqui
// solo se PRESENTA cada valor. Anadir o quitar una causa del enum rompe el build por el
// `Record` exhaustivo (no silencioso).
//
// IDIOMA: los values van en espanol y SIN tilde (`danado`), porque un value de enum es un
// identificador, no texto para leer. Las etiquetas visibles SI llevan su acentuacion correcta
// ("Paquete danado" -> "Paquete dañado"): ningun componente debe mostrar el slug crudo.
export const CAUSA_INCIDENTE_LABEL: Record<CausaIncidente, string> = {
  danado: "Paquete dañado",
  perdido: "Paquete perdido",
  robado: "Paquete robado",
};

/** Opcion del selector de causa del incidente (radios, mismo patron que la 73). */
export interface CausaIncidenteOption {
  value: CausaIncidente;
  label: string;
}

/**
 * Opciones del selector de causa de la rama `incidente`, derivadas del SEED (nunca de una
 * lista literal paralela): el orden y el conjunto son los del enum, no una copia que pueda
 * quedar desfasada.
 */
export const CAUSA_INCIDENTE_OPTIONS: readonly CausaIncidenteOption[] = CAUSA_INCIDENTE_SEED.map(
  (value) => ({ value, label: CAUSA_INCIDENTE_LABEL[value] }),
);
