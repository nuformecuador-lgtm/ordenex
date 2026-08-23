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
 * Feature 265 (design §13.3) — QUIEN ordeno la secuencia. NO es un detalle interno: cambia
 * lo que el orden SIGNIFICA para el mensajero, y por eso se persiste
 * (`ruta_optimizada.secuencia_fuente`) y se le avisa.
 *
 *   `proveedor` — lo ordeno Google Cloud Route Optimization (calles, trafico, restricciones).
 *   `local`     — lo ordeno el calculo local (vecino mas cercano sobre distancia de circulo
 *                 maximo). Es un orden COMPLETO pero APROXIMADO: no conoce calles.
 */
export type SecuenciaFuente = "proveedor" | "local";

/**
 * R15 — desenlace traducido al vocabulario de dominio. El cliente NO decide politica: la
 * tabla de desenlace (persistir vs marcar desactualizada vs lanzar) vive en
 * `OptimizacionRutaService`, igual que `GeocodeOutcome` respecto de `GeocodificacionService`.
 */
export type OptimizarOutcome =
  /**
   * Secuencia de `ordenId` en orden de visita.
   *
   * ⚠️ `fuente` es REQUERIDO, no opcional (feature 265, design §13.3). Un `fuente?:` dejaria
   * que un cliente nuevo —o el doble de un test— se callara de donde salio su orden y que el
   * sistema lo interpretara como «del proveedor» por omision: seria sembrar exactamente el
   * fallo mudo que la 265 vino a cerrar. Requerido, el compilador obliga a los TRES
   * productores a pronunciarse.
   */
  | { status: "ok"; secuencia: string[]; fuente: SecuenciaFuente }
  /** Red, timeout, HTTP 5xx o cuota: reintentable, la cola aplica su backoff. */
  | { status: "transitorio"; detalle: string }
  /** 401/403: credencial, scope o facturacion rotos. Reintentar no lo arregla solo. */
  | { status: "config_invalida"; detalle: string }
  /**
   * Feature 265 (R9, design §4) — EL PROVEEDOR CONTESTO BIEN Y NO PUDO SERVIR TODAS LAS
   * PARADAS. Medido en produccion el 2026-08-21: `routes: [{}]`, seis paradas en
   * `skippedShipments` y `metrics.skippedMandatoryShipmentCount = 6`.
   *
   * ═══ POR QUE ES UN DESENLACE Y NO UN ERROR ═══
   * Los otros dos desenlaces de fallo describen COSAS ROTAS (red, cuota, credencial). Esto no
   * lo es: es una RESPUESTA CORRECTA A UNA PREGUNTA IMPOSIBLE, y quien la reciba tiene que
   * poder tratarla sin distinguir «se rompio algo» de «no hay solucion» leyendo el nombre de
   * una clase de error. Al ser una union discriminada, ningun `switch` compila hasta que
   * alguien escribe este caso: ese rojo del compilador ES el objetivo.
   *
   * `servidas` y `enviadas` viajan en el desenlace y no solo dentro de `detalle` para que el
   * consumidor decida sin parsear prosa. Son CONTEOS, es decir agregados: no son PII, a
   * diferencia de un indice de parada —que esta a un paso de `paradas[i].ordenId`—.
   */
  | { status: "sin_solucion"; detalle: string; servidas: number; enviadas: number };

export interface IRouteOptimizationClient {
  optimizar(input: OptimizarInput): Promise<OptimizarOutcome>;
}
