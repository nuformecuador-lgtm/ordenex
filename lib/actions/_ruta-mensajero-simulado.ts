// TODO(92): SIMULADOR DE DESARROLLO — NO ES EL BACKEND.
// =============================================================================
// Este archivo NO optimiza ninguna ruta: devuelve resultados fabricados en
// memoria para poder recorrer a mano el flujo de la UI (feature 93) mientras el
// backend real (feature 92: `OptimizacionRutaService`, cliente de Route
// Optimization, tablas de ruta) todavia no existe.
//
// EL PR DE LA 93 NO DEBE MERGEARSE ANTES QUE EL DE LA 92. Si se mergea antes, el
// boton de sincronizacion queda muerto en produccion (devuelve `no_implementado`,
// porque el simulador esta fenced y jamas se activa alli).
//
// FENCING (tres candados, cubiertos por `tests/unit/actions/ruta-mensajero-fencing.test.ts`):
//   1. El nombre del archivo empieza por `_` y dice `simulado`: no se confunde.
//   2. Solo se activa con `RUTA_SIMULADA=1` explicito; apagado por defecto.
//   3. NUNCA se activa si `NODE_ENV === "production"`, ni con el flag puesto.
// =============================================================================

import type { RutaResumen } from "@/lib/interfaces/services/IMisAsignacionesService";

/** Intervalo minimo entre sincronizaciones manuales (R34). Espeja el default del spec. */
export const RUTA_SYNC_MIN_INTERVALO_S = 10;

export interface UbicacionSimulada {
  lat: number;
  lng: number;
}

export type SincronizarRutaSimuladoResult =
  | { status: "ok"; ruta: RutaResumen; secuencia: string[] }
  | { status: "forbidden" }
  | { status: "conflict"; motivo: string };

/**
 * Candado del simulador. `true` SOLO si el flag explicito esta puesto y NO
 * estamos en produccion. Cualquier otra combinacion es `false`.
 */
export function simulacionRutaHabilitada(
  env: { RUTA_SIMULADA?: string; NODE_ENV?: string } = process.env,
): boolean {
  if (env.NODE_ENV === "production") return false; // candado 3: gana siempre
  return env.RUTA_SIMULADA === "1"; // candado 2: opt-in explicito
}

// --- Estado en memoria del simulador (se pierde en cada recarga del server) ---
let ultimaSyncMs: number | null = null;
let syncs = 0;

/** Solo para los tests del simulador: vuelve al estado inicial. */
export function resetSimulacionRuta(): void {
  ultimaSyncMs = null;
  syncs = 0;
}

/**
 * Fabrica el desenlace de una pulsacion del boton. Recorre a proposito los casos
 * que la UI tiene que saber manejar, no solo el feliz:
 *  - doble clic dentro de la ventana de R34 -> `conflict`
 *  - rol != mensajero -> `forbidden` (R33)
 *  - sincronizaciones pares -> ruta `vigente` (el aviso de R30 desaparece)
 *  - sincronizaciones impares -> `desactualizada` + `paradasSinOptimizar` (R30 visible)
 *  - origen `gps` si llego ubicacion; `ultima_conocida`/`centroide` si no (R24/R25)
 */
export function sincronizarRutaSimulado(args: {
  rol: string;
  ubicacion?: UbicacionSimulada;
  ordenIds: string[];
  ahoraMs?: number;
}): SincronizarRutaSimuladoResult {
  const { rol, ubicacion, ordenIds } = args;
  const ahora = args.ahoraMs ?? Date.now();

  if (rol !== "mensajero") return { status: "forbidden" }; // R33

  // R34: dos pulsaciones dentro de la ventana no producen dos llamadas facturadas.
  if (
    ultimaSyncMs !== null &&
    ahora - ultimaSyncMs < RUTA_SYNC_MIN_INTERVALO_S * 1000
  ) {
    return {
      status: "conflict",
      motivo: "sincronizacion_demasiado_frecuente",
    };
  }
  ultimaSyncMs = ahora;
  syncs += 1;

  // R24/R25: con ubicacion el origen es `gps`; sin ella el backend degradaria a
  // la ultima conocida y, si no hay ninguna, al centroide de las paradas.
  const origenFuente: RutaResumen["origenFuente"] = ubicacion
    ? "gps"
    : ultimaSyncMs !== null && syncs > 1
      ? "ultima_conocida"
      : "centroide";

  const desactualizada = syncs % 2 === 0;
  // Secuencia "optimizada" de mentira: rota la lista una posicion por sync, para
  // que se note que el orden lo decide el servidor y no el cliente.
  const secuencia =
    ordenIds.length > 1
      ? [...ordenIds.slice(1), ordenIds[0]!]
      : [...ordenIds];

  return {
    status: "ok",
    secuencia,
    ruta: {
      estado: desactualizada ? "desactualizada" : "vigente",
      calculadaAt: new Date(ahora),
      origenFuente,
      paradasSinOptimizar: desactualizada ? 1 : 0,
    },
  };
}
