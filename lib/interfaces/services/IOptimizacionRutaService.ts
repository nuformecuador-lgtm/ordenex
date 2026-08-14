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
/**
 * De donde salio el dibujo de la ruta. NO es un detalle interno: cambia lo que la linea
 * SIGNIFICA, y la UI debe distinguirlas (p.ej. punteada para `local`).
 *
 *   `routes` — geometria real por calles, devuelta por Google Routes.
 *   `local`  — segmentos RECTOS entre paradas, calculados aqui sin red ni coste. Cruzan
 *              manzanas y sentidos prohibidos: valen para ver el recorrido, no para navegar.
 */
export type TrazadoFuente = "routes" | "local";

/**
 * Trazado de la ruta. OPCIONAL: una optimizacion correcta sin trazado sigue siendo `ok` —
 * el orden es lo esencial y el dibujo es accesorio.
 */
export interface TrazadoRuta {
  /** Polilinea codificada de Google, lista para pintar en un mapa. */
  encodedPolyline: string;
  /** Metros. Con `fuente: "local"` es la suma de rectas: una COTA INFERIOR de la real. */
  distanciaM: number | null;
  /** Segundos. Siempre `null` con `fuente: "local"`: sin calles no hay tiempo que estimar. */
  duracionS: number | null;
  fuente: TrazadoFuente;
}

export type EjecutarOptimizacionResult =
  | { status: "ok"; paradas: number; trazado?: TrazadoRuta }
  | {
      status: "omitida";
      razon: "obsoleta" | "intervalo_minimo" | "sin_paradas" | "sin_cambios";
      /**
       * R35 con UNA parada: no hubo nada que ORDENAR —por eso `omitida`— pero si hay algo
       * que DIBUJAR, la linea del origen a esa unica parada. Las demas razones nunca lo
       * traen: o no se recalculo nada nuevo, o no hay parada alguna.
       */
      trazado?: TrazadoRuta;
    };

export interface IOptimizacionRutaService {
  ejecutar(
    mensajeroId: string,
    opts: EjecutarOptimizacionOpts,
  ): Promise<EjecutarOptimizacionResult>;
}
