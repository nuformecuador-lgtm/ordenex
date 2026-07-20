// Feature 92 (design §5) — contrato del servicio de optimizacion de ruta.

/** Motivo del disparo. Solo `manual` esta sujeto al intervalo minimo de R34. */
export type MotivoOptimizacion = "debounce" | "inmediato" | "manual";

export interface EjecutarOptimizacionOpts {
  motivo: MotivoOptimizacion;
  /**
   * R20 — `createdAt` del job que dispara esta ejecucion. Si es ANTERIOR al
   * `calculada_at` de la ruta vigente, el trabajo de este job YA lo hizo una optimizacion
   * posterior: se completa sin llamar (ni pagar) al proveedor. Ausente en el disparo
   * manual, que por definicion no viene de la cola.
   */
  jobCreatedAt?: Date;
  /** R22/R23: ubicacion del navegador. Se persiste como origen `gps` si viene. */
  ubicacion?: { lat: number; lng: number };
}

/**
 * Desenlace de una ejecucion. `omitida` cubre TODAS las guardas de coste (R20, R34, R36) y
 * el caso trivial de R35: el job se completa con exito SIN haber llamado al proveedor.
 * Un fallo del proveedor NO aparece aqui: se propaga como excepcion para que la cola
 * aplique su backoff (R27).
 */
export type EjecutarOptimizacionResult =
  | { status: "ok"; paradas: number }
  | { status: "omitida"; razon: "obsoleta" | "intervalo_minimo" | "sin_paradas" | "sin_cambios" };

export interface IOptimizacionRutaService {
  ejecutar(
    mensajeroId: string,
    opts: EjecutarOptimizacionOpts,
  ): Promise<EjecutarOptimizacionResult>;
}
