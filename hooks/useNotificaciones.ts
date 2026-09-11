"use client";

import useSWR from "swr";

import { listarNotificaciones } from "@/lib/actions/notificaciones";
import { notificacionesConfig } from "@/lib/config/notificaciones";
import type { NotificacionDTO } from "@/lib/types/notificacion";

// Feature 146 (C1, design §5) — fuente de datos de la campana. Polling con SWR
// (D3/F1.4-8): NO hay Supabase Realtime ni ningun canal de suscripcion en vivo (R47).
// La lectura viaja por Server Action, no por una ruta `/api/*` (R38, alternativa A7).

/** Clave de cache de SWR. Estable para poder revalidar desde cualquier consumidor. */
export const NOTIFICACIONES_SWR_KEY = "notificaciones";

export interface NotificacionesData {
  items: NotificacionDTO[];
  /** No leidas por el actor DENTRO del mismo conjunto que devuelve `items` (R30). */
  noLeidas: number;
  /**
   * FICHA 409 (R8/R9, T6.1) — CUANTAS COSAS HAY POR HACER, que NO es cuantos mensajes hay sin
   * leer. Lo cuenta el SERVIDOR sobre el mismo conjunto que viaja en `items` (accionables y
   * vigentes, sin mirar la lectura): la campana no lo deriva ni lo recalcula.
   *
   * Es la cifra del distintivo (R11), la del filtro (R25) y la que dispara el tono (R30, Q8):
   * un solo criterio para el mismo hecho.
   */
  porHacer: number;
}

/**
 * Fetcher del listado: llama la Server Action y LANZA si el resultado no es "ok",
 * para que SWR exponga `error` (patron `PostulacionesPendientesPanel`, feature 22).
 * Es lo que permite que `unauthenticated` degrade a "sin distintivo" (R48).
 */
export async function notificacionesFetcher(): Promise<NotificacionesData> {
  const res = await listarNotificaciones();
  if (res.status !== "ok") throw new Error(res.status);
  // `?? 0` no es defensa muerta: el resultado de la accion es la frontera con el servidor y en
  // los dobles de las suites vigentes de la 146/161 ese campo no existe todavia. Sin el, el
  // distintivo pintaria "undefined por hacer" en vez de apagarse.
  return { items: res.items, noLeidas: res.noLeidas, porHacer: res.porHacer ?? 0 };
}

export interface UseNotificacionesOptions {
  /** Datos iniciales (prop `notifications` de la campana): evita el parpadeo inicial. */
  fallbackData?: NotificacionesData;
}

export interface UseNotificacionesResult extends NotificacionesData {
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<NotificacionesData | undefined>;
  mutateOptimista: (
    updater: (current?: NotificacionesData) => Promise<NotificacionesData>,
    optimista: NotificacionesData,
  ) => Promise<NotificacionesData | undefined>;
}

/**
 * Suscribe la campana al listado del actor: refresco cada
 * `notificacionesConfig.REFRESH_INTERVAL_MS` (60 s, R47), revalidacion al recuperar
 * el foco y `keepPreviousData` para no vaciar la lista entre refrescos.
 *
 * Ante error (incluido `unauthenticated`) devuelve el conjunto VACIO y contador cero:
 * la campana sigue renderizandose, sin distintivo y sin romper la cabecera (R48).
 */
export function useNotificaciones(
  options: UseNotificacionesOptions = {},
): UseNotificacionesResult {
  const { data, error, isLoading, mutate } = useSWR<NotificacionesData>(
    NOTIFICACIONES_SWR_KEY,
    notificacionesFetcher,
    {
      refreshInterval: notificacionesConfig.REFRESH_INTERVAL_MS,
      revalidateOnFocus: true,
      keepPreviousData: true,
      fallbackData: options.fallbackData,
    },
  );

  const vacio = error != null || !data;

  return {
    items: vacio ? [] : data.items,
    noLeidas: vacio ? 0 : data.noLeidas,
    // R48 de la 146, aplicado a la cifra nueva: ante error (incluido `unauthenticated`) la
    // campana degrada a CERO por hacer, o sea a "sin distintivo", sin romper la cabecera.
    porHacer: vacio ? 0 : data.porHacer,
    error,
    isLoading,
    mutate: () => mutate(),
    mutateOptimista: (updater, optimista) =>
      mutate(updater, {
        optimisticData: optimista,
        rollbackOnError: true,
        revalidate: true,
      }),
  };
}
