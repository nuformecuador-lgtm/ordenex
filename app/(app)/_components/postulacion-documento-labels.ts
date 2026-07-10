import type { MensajeroDocumentoTipo } from "@prisma/client";

// Feature 23 (R8) — mapa de tipo de documento del mensajero a etiqueta legible y
// orden de render fijo. El orden estable garantiza tests deterministas y una
// presentacion consistente de los 5 enlaces "Ver" por postulacion.

/** Etiqueta legible por tipo de documento (los 5 tipos del enum). */
export const DOCUMENTO_LABELS: Record<MensajeroDocumentoTipo, string> = {
  cedula_anverso: "Cédula (anverso)",
  cedula_reverso: "Cédula (reverso)",
  propiedad_anverso: "Matrícula (anverso)",
  propiedad_reverso: "Matrícula (reverso)",
  foto_rostro: "Foto de rostro",
};

/** Orden de render fijo de los documentos (estabilidad visual y de tests). */
export const DOCUMENTO_ORDEN: readonly MensajeroDocumentoTipo[] = [
  "cedula_anverso",
  "cedula_reverso",
  "propiedad_anverso",
  "propiedad_reverso",
  "foto_rostro",
];

/** Etiqueta legible con fallback defensivo al propio value si el tipo es desconocido. */
export function labelDocumento(tipo: MensajeroDocumentoTipo): string {
  return DOCUMENTO_LABELS[tipo] ?? tipo;
}
