import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// POS card · configuración de PRESENTACIÓN del chip de estado y de las marcas de la card,
// compartida por las tres vistas (grande, mosaico y detalle) para que pinten EXACTAMENTE el
// mismo lenguaje de texto y color.
//
// FICHA 455 (2026-09-24, design §2.1; R7, R8, R12). Hasta la 455 el chip era un RÓTULO que la
// card derivaba de sus flags («En gestión», «En detalle», «En reparto») o que el consumidor le
// pasaba fijo («Por recoger», «En ayuda», «Por recolectar», «Recolectada»), y el color se buscaba
// POR ESE TEXTO. Ahora:
//   - el chip dice SIEMPRE el nombre visible del estado de la orden (`nombreDeEstado`, R7), aunque
//     la card esté activa o abierta en detalle (R8);
//   - la condición de la INTERFAZ (activa / abierta en detalle) va en una MARCA aparte, con un
//     texto que no es nombre de ningún estado («Gestionando ahora», «Abierta en detalle», R8/R6);
//   - el consumidor puede añadir una NOTA propia (la ayuda de la 454, la causa de la novedad) que
//     también va fuera del chip;
//   - los colores se indexan por CÓDIGO de estado o por la CLAVE de la marca, nunca por el texto
//     visible (R12).

/**
 * Colores del chip por CÓDIGO de estado (R12). Chips SÓLIDOS (feature 208): `navy`/`warning` son
 * tokens fijos del `@theme` (fijo-sobre-fijo: blanco sobre `bg-navy` 13.2:1, `text-navy` sobre
 * `bg-warning` 8.1:1 en los dos temas). Parcial a propósito: lo que no figura cae al color por
 * defecto, que es el que la card siempre dio al estado que más pinta (`en_reparto`).
 */
const CLASE_CHIP_POR_CODIGO: Partial<Record<string, string>> = {
  en_reparto: "bg-warning text-navy",
  // Antes «Por recoger»: la orden todavía no sale; tratamiento neutro de siempre.
  mensajero_recogiendo_en_bodega: "bg-secondary text-secondary-foreground",
};

/** Color por defecto del chip (el de `en_reparto`). */
const CLASE_CHIP_POR_DEFECTO = "bg-warning text-navy";

/** Clases del chip de estado para un CÓDIGO de estado (R12). */
export function claseChipEstado(estatusValue: string): string {
  return CLASE_CHIP_POR_CODIGO[estatusValue] ?? CLASE_CHIP_POR_DEFECTO;
}

// FICHA 456 (T3.6, R9): aquí vivía `textoChipEstado` (el nombre del estado ya resuelto). Las tres
// vistas pintan ahora el chip con `EstadoConInfo` desde `orden.estatusValue`, que calcula el nombre
// y le pone su botón de información; este módulo solo decide el COLOR (`claseChipEstado`).

/** Clases de la nota de ayuda de la 454 (la misma familia que `CLASE_NOTA`). */
export const CLASE_NOTA_AYUDA = "bg-warning-soft text-warning-strong";

/** Las condiciones de la INTERFAZ que la card anuncia fuera del chip (R8). */
export type MarcaTarjeta = "activa" | "detalle";

/**
 * R8/R6 — el texto de cada marca. Ninguno es un nombre de estado vigente ni retirado (lo vigila la
 * guardia G2 y el test de la card).
 */
export const TEXTO_MARCA_TARJETA: Record<MarcaTarjeta, string> = {
  activa: "Gestionando ahora",
  detalle: "Abierta en detalle",
};

/** Colores de cada marca, por su CLAVE (R12): los que tenían «En gestión» y «En detalle». */
const CLASE_MARCA_TARJETA: Record<MarcaTarjeta, string> = {
  activa: "bg-brand text-white",
  detalle: "bg-navy text-white",
};

/** Color de la nota que pone el consumidor (ayuda, causa): la familia de espera con acción. */
const CLASE_NOTA = "bg-warning-soft text-warning-strong";

/**
 * La marca de la card, derivada de los flags del módulo: activa (puntero 1-a-1 fijado) > abierta en
 * el panel de detalle > ninguna.
 */
export function marcaPorDefecto(esActiva: boolean, esDetalle: boolean): MarcaTarjeta | null {
  if (esActiva) return "activa";
  if (esDetalle) return "detalle";
  return null;
}

/** Una marca pintable: texto + clases. */
export interface MarcaPintable {
  readonly texto: string;
  readonly clase: string;
}

/**
 * Las marcas que la card pinta junto al chip, en orden: la de la interfaz (si la hay) y la nota del
 * consumidor (si la hay).
 */
export function marcasDeTarjeta(
  esActiva: boolean,
  esDetalle: boolean,
  nota: string | undefined,
): MarcaPintable[] {
  const marcas: MarcaPintable[] = [];
  const marca = marcaPorDefecto(esActiva, esDetalle);
  if (marca !== null) marcas.push({ texto: TEXTO_MARCA_TARJETA[marca], clase: CLASE_MARCA_TARJETA[marca] });
  if (nota) marcas.push({ texto: nota, clase: CLASE_NOTA });
  return marcas;
}

/** Texto corto de la parada en la ruta ("3" o "·" si aún no tiene posición). */
export function textoParada(orden: MiAsignacionDTO): string {
  return orden.secuenciaRuta === null ? "·" : String(orden.secuenciaRuta);
}
