// Ficha 476 (T5.1, maqueta `ParamsPicking.dc.html`) — textos y mensajes PUROS del panel del informe
// de picking. Sin React ni acciones: los lee `ParamsPicking` y los tests los afirman sin montar nada.
import {
  DIAS_ATRASO_MAX,
  DIAS_ATRASO_MIN,
  MENSAJES_PICKING,
} from "@/lib/whatsapp-envios/informes/picking/parametros";

export const TEXTOS_PICKING = {
  intro:
    "Lo que está «En preparación» en el momento del envío, agrupado por producto. Cada tienda va en su propio envío, con su propio PDF.",
  plegar: "Plegar",
  desplegar: "Desplegar",
  tiendaTitulo: "Tienda",
  cargandoTiendas: "Cargando las tiendas con fulfillment…",
  sinTiendas: "No hay tiendas con fulfillment. Cuando una tienda tenga fulfillment activo, aparecerá aquí.",
  errorTiendas: "No se pudieron cargar las tiendas. Inténtalo de nuevo en un momento.",
  reintentar: "Reintentar",
  sinPermiso: "Solo un maestro puede ver las tiendas del picking.",
  calculando: "calculando…",
  tiendaYaNoEsta:
    "La tienda guardada ya no tiene fulfillment o no está activa: el envío fallará hasta que elijas otra.",
  ayudaTiendaVacia: "Una tienda sin nada en preparación no genera PDF ese día.",
  atrasoTitulo: "Marcar las órdenes atrasadas",
  atrasoAntes: "Las que llevan más de",
  atrasoDespues: "en preparación",
  ayudaAtraso: "Salen señaladas junto a su remisión y resumidas arriba del PDF, para prepararlas primero.",
  corrigeDias: "Corrige los días para ver cuántas órdenes van atrasadas.",
} as const;

export function ordenes(n: number): string {
  return `${n} ${n === 1 ? "orden" : "órdenes"}`;
}

export function atrasadas(n: number): string {
  return `${n} ${n === 1 ? "atrasada" : "atrasadas"}`;
}

export function dias(n: number | null): string {
  return n === 1 ? "día" : "días";
}

/** Rango del número de días (para el `<input>`). */
export const RANGO_DIAS = { min: DIAS_ATRASO_MIN, max: DIAS_ATRASO_MAX } as const;

/**
 * Mensaje PROPIO por campo, en español claro. El esquema del servidor ya habla claro para estos dos
 * campos (`MENSAJES_PICKING`), así que se usan los MISMOS textos: lo que dice el panel en vivo y lo
 * que devuelve «Guardar» no pueden divergir. Un campo desconocido conserva el mensaje del servidor.
 */
export function mensajeDeCampoPicking(campo: string, original: readonly string[]): string[] {
  if (campo === "diasAtraso") return [MENSAJES_PICKING.dias];
  if (campo === "tiendaId") return [MENSAJES_PICKING.tienda];
  return [...original];
}
