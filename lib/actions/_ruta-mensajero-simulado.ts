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

import type {
  MiAsignacionDTO,
  RutaResumen,
} from "@/lib/interfaces/services/IMisAsignacionesService";

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
// Ultimo resultado "persistido" por el simulador. Hace de tabla de ruta: lo
// escribe `sincronizarRutaSimulado` y lo LEE el decorador de abajo en el render
// siguiente (el que dispara `router.refresh()`).
let ultimaSecuencia: string[] = [];
let ultimaRuta: RutaResumen | null = null;

/** Solo para los tests del simulador: vuelve al estado inicial. */
export function resetSimulacionRuta(): void {
  ultimaSyncMs = null;
  syncs = 0;
  ultimaSecuencia = [];
  ultimaRuta = null;
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

  const ruta: RutaResumen = {
    estado: desactualizada ? "desactualizada" : "vigente",
    calculadaAt: new Date(ahora),
    origenFuente,
    paradasSinOptimizar: desactualizada ? 1 : 0,
  };

  // "Persiste" el resultado para que el render siguiente lo lea (ver decorador).
  ultimaSecuencia = secuencia;
  ultimaRuta = ruta;

  return { status: "ok", secuencia, ruta };
}

// =============================================================================
// Decorador de lectura — hace de BACKEND, no de cliente.
// =============================================================================
// R28/§6.1 prohibe que el MODULO ordene: exige que el orden llegue ya resuelto
// desde el servidor. Este decorador ocupa exactamente ese seam (se aplica en
// `page.tsx`, un Server Component, sobre el resultado de `listarMisAsignaciones`),
// que es el sitio donde la 92 pondra el reordenado de verdad.
//
// `MisAsignacionesModule` sigue SIN ordenar nada: recibe el array ya ordenado y
// lo renderiza tal cual. Si esto se hiciera dentro del modulo si estaria mal.

/** Forma minima que el decorador necesita; evita acoplarse al tipo del borde. */
interface MisAsignacionesDecorable {
  porGestionar: MiAsignacionDTO[];
  ruta?: RutaResumen;
}

/**
 * Aplica la ruta simulada a un resultado `ok` de `listarMisAsignaciones`:
 * (a) reordena `porGestionar` segun la ultima secuencia calculada y (b) adjunta
 * el `ruta` que la 92 devolvera de verdad.
 *
 * Devuelve el resultado INTACTO si el simulador esta apagado (candado) o si
 * todavia no hubo ninguna sincronizacion.
 */
export function decorarMisAsignacionesSimulado<T extends MisAsignacionesDecorable>(
  result: T,
): T & { ruta?: RutaResumen } {
  if (!simulacionRutaHabilitada()) return result; // candado: mismo flag que la action
  if (ultimaRuta === null) return result; // aun no se pulso "Sincronizar ruta"

  const posicion = new Map(ultimaSecuencia.map((id, i) => [id, i]));

  // Orden estable: primero las que tienen posicion (por secuencia asc), y al
  // final las que entraron despues de la ultima optimizacion, conservando el
  // orden en el que ya venian (R28).
  const conPosicion: MiAsignacionDTO[] = [];
  const sinPosicion: MiAsignacionDTO[] = [];
  for (const orden of result.porGestionar) {
    (posicion.has(orden.id) ? conPosicion : sinPosicion).push(orden);
  }
  conPosicion.sort((a, b) => posicion.get(a.id)! - posicion.get(b.id)!);

  const porGestionar = [
    ...conPosicion.map((o) => ({
      ...o,
      secuenciaRuta: posicion.get(o.id)! + 1,
    })),
    ...sinPosicion.map((o) => ({ ...o, secuenciaRuta: null })),
  ];

  return {
    ...result,
    porGestionar,
    ruta: {
      ...ultimaRuta,
      // El # real de paradas sin posicion lo sabe el decorador, no el `sincronizar`.
      paradasSinOptimizar: sinPosicion.length,
      estado:
        sinPosicion.length > 0 ? "desactualizada" : ultimaRuta.estado,
    },
  };
}
