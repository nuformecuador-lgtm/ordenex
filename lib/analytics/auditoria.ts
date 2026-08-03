// Feature 122 (T4.6) — REGISTRO DEL DENEGADO (D10, R40). Construye; no emite.
//
// D10 decidio auditar los intentos denegados POR EL CANAL QUE YA EXISTE: la interfaz
// `ErrorLogger` (`lib/errors/logger.ts:6-8`) con su implementacion por defecto
// `ConsoleErrorLogger`, la misma que reciben `withErrorHandler` y `normalizeError` en los
// seis crons y en el webhook de WhatsApp. El rastro es `console.error` en el servidor
// (Vercel): sirve para investigar, no para reportar. Una auditoria persistente seria otra
// ficha.
//
// ⚠ TRAMPA VERIFICADA — NO DELEGAR EN `withErrorHandler`.
// `normalizeError` devuelve la shape de un `AppError` en su PRIMERA linea
// (`lib/errors/normalize.ts:22`) y solo llama a `logger.logError` en la rama del error
// DESCONOCIDO (`:45`). Lanzar un `ForbiddenError` y confiar en el wrapper produce un 403
// MUDO: el intento no deja rastro. Por eso el borde debe hacer una llamada EXPLICITA
// `logger.logError(describirDenegado(...))` y DESPUES responder 403. El test de R40 espia
// el logger, no el status.
//
// Este modulo es PURO (R31/R34): construye el registro y lo devuelve. No escribe en
// consola, no importa `lib/errors/` y no conoce al logger. Quien emite es el borde de
// 126/127/134.
//
// Sobre R34 (nada de PII): el registro lleva el rol y el `usuarioId` DEL PROPIO ACTOR y
// los ids QUE EL PROPIO ACTOR ENVIO. No hay dato ajeno —ni nombre, ni telefono, ni correo,
// ni contenido de sesion—: se registra quien llamo y que pidio, no a quien pertenecia lo
// pedido.

import type { ActorAnalitica, MotivoDenegacion } from "@/lib/analytics/alcance";

/** Valor con el que se registra un actor ausente o malformado. Nunca `undefined`. */
export const ACTOR_DESCONOCIDO = "desconocido";

/** Las tres dimensiones que el cliente puede nombrar (`lib/analytics/filters.ts`). */
const DIMENSIONES_FILTRO = ["zona_id", "tienda_id", "mensajero_id"] as const;

export interface RegistroDenegado {
  readonly evento: "analitica_denegado";
  readonly motivo: MotivoDenegacion;
  readonly rol: string;
  /** El id del PROPIO actor: dato suyo, no ajeno. */
  readonly usuarioId: string;
  readonly metricaId: string;
  /** Zona/tienda que el actor pidio, si las pidio. */
  readonly alcancePedido?: { readonly zonaId?: string; readonly tiendaId?: string };
  /** Los ids que el actor envio, tal cual, sin resolver a nombres. */
  readonly filtroRechazado?: Record<string, readonly string[]>;
}

export interface EntradaDenegado {
  readonly motivo: MotivoDenegacion;
  readonly actor: ActorAnalitica | null | undefined;
  readonly metricaId: string;
  /**
   * El filtro que envio el actor. Se acepta `unknown` porque el denegado puede ocurrir
   * con una entrada que ni siquiera parseo: se saneia aqui y solo sobreviven las tres
   * listas de ids conocidas.
   */
  readonly filtro?: unknown;
}

/**
 * Construye el registro del intento denegado con los campos EXACTOS que exige R40: rol,
 * `usuarioId`, tienda/zona solicitada, filtro rechazado y motivo.
 *
 * Puro y total: no emite, no lanza y no arrastra ninguna clave que el actor no haya
 * enviado. Las claves opcionales se OMITEN cuando no hay nada que registrar, para que el
 * rastro no se llene de `undefined`.
 */
export function describirDenegado(entrada: EntradaDenegado): RegistroDenegado {
  const { motivo, actor, metricaId } = entrada;
  const filtroRechazado = saneaFiltro(entrada.filtro);
  const alcancePedido = alcanceDelFiltro(filtroRechazado);
  const rol = actor?.rol;
  const usuarioId = actor?.usuarioId;

  return {
    evento: "analitica_denegado",
    motivo,
    rol: cadenaUtil(rol) ? rol : ACTOR_DESCONOCIDO,
    usuarioId: cadenaUtil(usuarioId) ? usuarioId : ACTOR_DESCONOCIDO,
    metricaId: typeof metricaId === "string" ? metricaId : ACTOR_DESCONOCIDO,
    ...(alcancePedido ? { alcancePedido } : {}),
    ...(filtroRechazado ? { filtroRechazado } : {}),
  };
}

function cadenaUtil(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

/**
 * Del filtro crudo solo sobreviven las TRES listas de ids del contrato. Todo lo demas se
 * descarta: un filtro malformado podria traer cualquier clave (incluida una con datos
 * personales) y el canal de auditoria no es sitio para reenviarla.
 */
function saneaFiltro(filtro: unknown): Record<string, readonly string[]> | undefined {
  if (filtro === null || typeof filtro !== "object") return undefined;
  const entradas = filtro as Record<string, unknown>;
  const saneado: Record<string, readonly string[]> = {};

  for (const clave of DIMENSIONES_FILTRO) {
    const valor = entradas[clave];
    if (Array.isArray(valor) && valor.every(cadenaUtil)) saneado[clave] = [...valor];
  }

  return Object.keys(saneado).length > 0 ? saneado : undefined;
}

/** "Tienda o zona solicitada" (R40): el primer id de cada dimension que el actor pidio. */
function alcanceDelFiltro(
  filtro: Record<string, readonly string[]> | undefined,
): { readonly zonaId?: string; readonly tiendaId?: string } | undefined {
  if (!filtro) return undefined;
  const zonaId = filtro.zona_id?.[0];
  const tiendaId = filtro.tienda_id?.[0];
  if (zonaId === undefined && tiendaId === undefined) return undefined;
  return { ...(zonaId ? { zonaId } : {}), ...(tiendaId ? { tiendaId } : {}) };
}
