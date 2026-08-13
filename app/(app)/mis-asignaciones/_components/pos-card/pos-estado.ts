import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// POS card · configuración de PRESENTACIÓN del badge de estado, compartida por las
// vistas compactas (mosaico y detalle). Equivale al `statusConfig` de la referencia:
// una etiqueta y sus clases de color, sin lógica de negocio. La `PosOrderCard` grande
// no lo usa (su badge va sólido en la cabecera navy); vive aquí para que mosaico y
// detalle pinten EXACTAMENTE el mismo lenguaje de color y no diverjan.

/** Etiqueta de estado que las cards del mensajero saben pintar. */
export type PosEstado = "En gestión" | "En detalle" | "En reparto" | "Por recoger";

/**
 * Clases del badge para cada estado (fondo + texto), sobre fondo de card.
 *
 * Feature 208 — estos `navy` se CONSERVAN a propósito: son chips SÓLIDOS, es decir
 * superficie fija con tinta fija encima ("Regla" de DESIGN.md). Medido: blanco sobre
 * `bg-navy` = 13.2:1 y `text-navy` sobre `bg-warning` = 8.1:1, idénticos en los dos
 * temas porque ninguno de los dos colores gira. Lo que sí se migró en esta card fue
 * el navy usado como LÍNEA o TINTA sobre la card (ver `PosCardHeader`, `PosAmountRow`).
 */
const ESTADO_CLASSNAME: Record<string, string> = {
  "En gestión": "bg-brand text-white",
  "En detalle": "bg-navy text-white",
  "En reparto": "bg-warning text-navy",
  "Por recoger": "bg-secondary text-secondary-foreground",
};

/** Clases del badge para `estado`; cae a las de "En reparto" si es un texto libre. */
export function estadoBadgeClass(estado: string): string {
  return ESTADO_CLASSNAME[estado] ?? ESTADO_CLASSNAME["En reparto"];
}

/**
 * Etiqueta de estado por defecto de una card, derivada de los flags del módulo:
 * activa (puntero 1-a-1 fijado) > en el panel de detalle > en reparto.
 */
export function estadoPorDefecto(
  esActiva: boolean,
  esDetalle: boolean,
): PosEstado {
  if (esActiva) return "En gestión";
  if (esDetalle) return "En detalle";
  return "En reparto";
}

/** Texto corto de la parada en la ruta ("3" o "·" si aún no tiene posición). */
export function textoParada(orden: MiAsignacionDTO): string {
  return orden.secuenciaRuta === null ? "·" : String(orden.secuenciaRuta);
}
