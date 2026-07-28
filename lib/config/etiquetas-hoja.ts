// Feature 150 (T1) — Catalogo de tamaños de hoja para el PDF de etiquetas de
// guia que se descarga desde el modal "Imprimir etiquetas".
//
// Este modulo es DELIBERADAMENTE puro: solo tipos y constantes, sin imports, sin
// `process.env`, sin I/O y sin logica al importarse (R3). Su consumidor es
// `EtiquetasGuiaModal.tsx`, un componente "use client": importar
// `lib/config/etiquetas.ts` (que lee el entorno como efecto de importacion:
// bucket privado, TTL de URL firmada, tope del lote) habria arrastrado config
// server-side al bundle del navegador y la habria degradado en silencio a sus
// defaults (design.md §1). Por eso el catalogo vive aparte y NO se fusiona con
// aquel archivo.
//
// Alcance (D3): esto solo lo usa el generador de cliente. El generador
// server-side `lib/pdf/etiquetas-pdf-lote.ts` (feature 136) sigue en 100x100 mm
// y NO importa este modulo.

/** Identificadores del catalogo; sin tildes, tambien viajan al nombre del archivo (R19). */
export type HojaEtiquetaId = "100x100" | "4x6in" | "a4" | "carta";

export interface HojaEtiqueta {
  id: HojaEtiquetaId;
  /** Etiqueta visible en el selector (español, con tildes). */
  label: string;
  anchoMm: number;
  altoMm: number;
}

/**
 * Orden fijo del selector (R1) y dimensiones exactas en mm (R2).
 *
 * `4x6in` = 4 x 25.4 y 6 x 25.4. `carta` = 8.5 x 25.4 y 11 x 25.4: se fija el
 * valor exacto (215.9 x 279.4) y no el redondeo 216 x 279, para que el PDF
 * declare 612 x 792 pt clavados y ninguna impresora reescale un tamaño
 * "casi carta" (design.md §2).
 */
export const HOJAS_ETIQUETA: readonly HojaEtiqueta[] = [
  { id: "100x100", label: "100 × 100 mm", anchoMm: 100, altoMm: 100 },
  { id: "4x6in", label: "4 × 6 pulgadas", anchoMm: 101.6, altoMm: 152.4 },
  { id: "a4", label: "A4", anchoMm: 210, altoMm: 297 },
  { id: "carta", label: "Carta", anchoMm: 215.9, altoMm: 279.4 },
];

/** Tamaño por defecto en cada apertura del modal (R4/R7; D2: sin persistencia). */
export const HOJA_ETIQUETA_DEFAULT_ID: HojaEtiquetaId = "100x100";

/**
 * Resuelve un identificador al tamaño del catalogo. R5: un id desconocido cae al
 * default en vez de producir un PDF sin tamaño definido (no lanza: el llamador
 * es la UI y no hay nada que reportar al usuario).
 */
export function getHojaEtiqueta(id: string): HojaEtiqueta {
  const hoja = HOJAS_ETIQUETA.find((h) => h.id === id);
  if (hoja) return hoja;
  // El default siempre existe en el catalogo; el `?? HOJAS_ETIQUETA[0]` es solo
  // para que el tipo sea `HojaEtiqueta` sin aserciones.
  return (
    HOJAS_ETIQUETA.find((h) => h.id === HOJA_ETIQUETA_DEFAULT_ID) ??
    HOJAS_ETIQUETA[0]
  );
}

/**
 * Formatea un valor en mm para el texto del modal ("100", "101,6", "215,9").
 * A mano y no con `Intl` para que el texto visible no dependa del locale del
 * runtime ni del runner de tests (R8).
 */
export function formatMm(valor: number): string {
  const redondeado = Math.round(valor * 10) / 10;
  return Number.isInteger(redondeado)
    ? String(redondeado)
    : String(redondeado).replace(".", ",");
}
