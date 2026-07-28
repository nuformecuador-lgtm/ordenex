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
}

/**
 * Fetcher del listado: llama la Server Action y LANZA si el resultado no es "ok",
 * para que SWR exponga `error` (patron `PostulacionesPendientesPanel`, feature 22).
 * Es lo que permite que `unauthenticated` degrade a "sin distintivo" (R48).
 */
export async function notificacionesFetcher(): Promise<NotificacionesData> {
  const res = await listarNotificaciones();
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, noLeidas: res.noLeidas };
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
