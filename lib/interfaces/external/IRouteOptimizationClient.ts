// Feature 92 (design §3) — contrato del proveedor de optimizacion de ruta. La interfaz es
// el punto de AISLAMIENTO deliberado de la decision de proveedor (design §9.A): si el SKU
// de Route Optimization resultara inasumible (Q9), volver a `computeRoutes` con
// `optimizeWaypointOrder` (que si reusa `GOOGLE_MAPS_API_KEY`) queda contenido en
// `lib/clients/` + `lib/config/` + `lib/auth/google-sa-token.ts`. El resto del diseno
// —persistencia, debounce, reordenado, gate— es identico para ambas APIs.

/** Una parada a visitar. El `ordenId` NO viaja al proveedor: es la tabla de traduccion. */
export interface ParadaEntrada {
  ordenId: string;
  lat: number;
  lng: number;
}

export interface OptimizarInput {
  /** Punto de partida del vehiculo (design §5.1). */
  origen: { lat: number; lng: number };
  /** Paradas a ordenar. El indice en este array es la clave de correspondencia. */
  paradas: ParadaEntrada[];
}

/**
 * R15 — desenlace traducido al vocabulario de dominio. El cliente NO decide politica: la
 * tabla de desenlace (persistir vs marcar desactualizada vs lanzar) vive en
 * `OptimizacionRutaService`, igual que `GeocodeOutcome` respecto de `GeocodificacionService`.
 */
export type OptimizarOutcome =
  /** Secuencia de `ordenId` en orden de visita. */
  | { status: "ok"; secuencia: string[] }
  /** Red, timeout, HTTP 5xx o cuota: reintentable, la cola aplica su backoff. */
  | { status: "transitorio"; detalle: string }
  /** 401/403: credencial, scope o facturacion rotos. Reintentar no lo arregla solo. */
  | { status: "config_invalida"; detalle: string };

export interface IRouteOptimizationClient {
  optimizar(input: OptimizarInput): Promise<OptimizarOutcome>;
}
