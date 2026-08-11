import type { GestionUbicacionAusenciaValue } from "@/lib/types/gestion-orden";

// Feature 193 (T D.1, R18/R19/R20) — captura de la ubicacion del navegador para la GESTION.
//
// Este helper NUNCA LANZA. Devuelve uno de tres desenlaces y deja la decision al llamador,
// porque los tres significan cosas distintas para el negocio:
//
//   - `ok`        -> hay coordenadas.
//   - `ausente`   -> fallo TECNICO. La gestion SIGUE (R18): no hay nada que la persona pueda
//                    hacer al respecto, y trabarla la dejaria sin poder trabajar.
//   - `denegado`  -> la persona nego el permiso. La gestion NO sigue (R19). Es reversible por
//                    ella misma desde los ajustes del navegador, y por eso es el unico caso
//                    que bloquea.
//
// La asimetria entre `ausente` y `denegado` es TODA la feature: sin ella, o se pierde el dato
// cuando el permiso esta denegado, o se traba al mensajero en una bodega sin senal.

/** R20 — tope de espera. Pasado esto, `TIMEOUT` y la gestion sigue como fallo tecnico. */
export const CAPTURA_UBICACION_TIMEOUT_MS = 10_000;

/**
 * Edad maxima aceptable de una posicion cacheada por el navegador. Se admite una lectura de
 * hasta un minuto: en una ruta de reparto el mensajero no se ha movido lo bastante en ese
 * lapso como para que importe, y evita encender el GPS en cada gestion (bateria).
 */
export const CAPTURA_UBICACION_MAX_EDAD_MS = 60_000;

export type CapturaUbicacion =
  | { estado: "ok"; lat: number; lng: number }
  | { estado: "ausente"; motivo: GestionUbicacionAusenciaValue }
  | { estado: "denegado" };

/**
 * Intenta obtener la posicion actual. Comprueba ANTES las dos condiciones que la plataforma
 * ya sabe que van a fallar —sin API y sin contexto seguro—, para no gastar un intento (y su
 * espera de R20) en algo cuyo desenlace esta decidido.
 */
export function capturarUbicacion(
  timeoutMs: number = CAPTURA_UBICACION_TIMEOUT_MS,
): Promise<CapturaUbicacion> {
  // Sin HTTPS la API existe pero rechaza siempre. Se distingue de `no_soportado` a proposito:
  // uno se arregla desplegando bien y el otro no se arregla, y mezclarlos en el dato haria
  // imposible saber cual de los dos se esta viendo en produccion.
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return Promise.resolve({ estado: "ausente", motivo: "contexto_inseguro" });
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ estado: "ausente", motivo: "no_soportado" });
  }

  return new Promise<CapturaUbicacion>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (posicion) =>
        resolve({
          estado: "ok",
          lat: posicion.coords.latitude,
          lng: posicion.coords.longitude,
        }),
      (error) => {
        // Se comparan los codigos NUMERICOS y no las constantes del prototipo: en jsdom y en
        // navegadores viejos `GeolocationPositionError` no siempre esta en el ambito global,
        // y un `error.PERMISSION_DENIED` sobre un doble de test seria `undefined` -> todo
        // caeria a `no_disponible` y el bloqueo de R19 no se probaria nunca.
        switch (error?.code) {
          case 1: // PERMISSION_DENIED
            resolve({ estado: "denegado" });
            return;
          case 3: // TIMEOUT
            resolve({ estado: "ausente", motivo: "timeout" });
            return;
          default: // 2 = POSITION_UNAVAILABLE, y cualquier cosa rara
            resolve({ estado: "ausente", motivo: "no_disponible" });
        }
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: CAPTURA_UBICACION_MAX_EDAD_MS,
      },
    );
  });
}
