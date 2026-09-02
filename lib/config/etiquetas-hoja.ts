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
  /**
   * Feature 350 (T5) — Rejilla de etiquetas por hoja. `1 x 1` = una etiqueta por
   * pagina, que es lo que hacen HOY las cuatro hojas del catalogo.
   *
   * Es un DATO y no un `if (hoja.id === "a4")` a proposito: la **Q1** de la
   * ficha —cuatro etiquetas por hoja en A4 y Carta— esta ABIERTA y pendiente de
   * firma humana. Con la rejilla como dato, firmarla es cambiar dos numeros de
   * esta tabla; el motor de dibujo, el ajuste y los tests de geometria no se
   * tocan. Lo unico que Q1 añadiria de codigo es la paginacion en el generador
   * de cliente (`indice % (columnas * filas)` decide celda, `addPage` cuando
   * toca) y —si se piden— las guias de corte.
   *
   * ⚠️ Dato para quien firme Q1, medido en `design.md` §3: la celda de una
   * rejilla 2 x 2 en A4 mide 99 mm de ancho, o sea es MAS ANGOSTA que la celda
   * base de 100. Como el ancho es lo que gobierna los caracteres por linea,
   * "4-up" NO da capacidad por linea: da ALTO (143 frente a 100) y ahorra papel.
   */
  columnas: number;
  filas: number;
}

/** El rectangulo de papel que ocupa UNA etiqueta dentro de su hoja, en mm. */
export interface CeldaEtiqueta {
  x0: number;
  y0: number;
  ancho: number;
  alto: number;
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
  { id: "100x100", label: "100 × 100 mm", anchoMm: 100, altoMm: 100, columnas: 1, filas: 1 },
  { id: "4x6in", label: "4 × 6 pulgadas", anchoMm: 101.6, altoMm: 152.4, columnas: 1, filas: 1 },
  // Q1 (sin firmar): -> columnas: 2, filas: 2. Ver `HojaEtiqueta.columnas`.
  { id: "a4", label: "A4", anchoMm: 210, altoMm: 297, columnas: 1, filas: 1 },
  { id: "carta", label: "Carta", anchoMm: 215.9, altoMm: 279.4, columnas: 1, filas: 1 },
];

/**
 * Feature 350 (T5) — El rectangulo de papel de la etiqueta `indice` dentro de su
 * hoja, repartiendo la hoja en la rejilla `columnas x filas` SIN hueco y SIN
 * solape. Recorrido por filas (izquierda a derecha, arriba abajo), que es el
 * orden en el que un operador corta y despega.
 *
 * Con la rejilla 1 x 1 de hoy devuelve la hoja entera (`x0 = y0 = 0`), asi que
 * el motor de dibujo NO se entera de que existe este concepto: es exactamente el
 * mismo criterio con el que la feature 150 justifico su `s = 1`.
 *
 * El indice se toma modulo el numero de celdas: quien pagina decide cuando
 * estrena hoja, y aqui no se inventa un error para un caso que el llamador ya
 * controla.
 */
export function celdaDeHoja(hoja: HojaEtiqueta, indice = 0): CeldaEtiqueta {
  const columnas = Math.max(1, Math.trunc(hoja.columnas));
  const filas = Math.max(1, Math.trunc(hoja.filas));
  const ancho = hoja.anchoMm / columnas;
  const alto = hoja.altoMm / filas;
  const posicion = ((Math.trunc(indice) % (columnas * filas)) + columnas * filas) % (columnas * filas);
  const columna = posicion % columnas;
  const fila = Math.trunc(posicion / columnas);
  return { x0: columna * ancho, y0: fila * alto, ancho, alto };
}

/** Cuantas etiquetas caben en una hoja del catalogo (1 con la rejilla de hoy). */
export function celdasPorHoja(hoja: HojaEtiqueta): number {
  return Math.max(1, Math.trunc(hoja.columnas)) * Math.max(1, Math.trunc(hoja.filas));
}

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
