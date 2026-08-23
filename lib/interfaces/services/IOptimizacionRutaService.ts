// Feature 92 (design §5) — contrato del servicio de optimizacion de ruta.
import type { SecuenciaFuente } from "@/lib/interfaces/external/IRouteOptimizationClient";

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
  /**
   * El recorrido partido en TRAMOS, uno por parada y en orden de visita: el `i` va del punto
   * `i` al `i+1`, empezando en el origen. Permite resaltar el trayecto a la siguiente parada
   * sin pedirle nada mas al proveedor — vienen en la misma respuesta ya pagada.
   *
   * Vacio con `fuente: "local"`: el trazado local es una sola recta continua entre todos los
   * puntos y partirlo daria tramos que no describen ningun recorrido real.
   */
  tramos: TrazadoTramo[];
}

/** Un tramo del recorrido: lo que hay entre dos puntos consecutivos. */
export interface TrazadoTramo {
  encodedPolyline: string;
  distanciaM: number | null;
  duracionS: number | null;
}

export type EjecutarOptimizacionResult =
  | {
      status: "ok";
      paradas: number;
      /**
       * Feature 265 (R35, design §13.4) — QUIEN ordeno esta secuencia. Sube hasta el toast de
       * la sincronizacion manual: un orden aproximado presentado como optimo es la clase de
       * mentira silenciosa que esta casa persigue.
       */
      secuenciaFuente: SecuenciaFuente;
      trazado?: TrazadoRuta;
    }
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

/**
 * Desenlace del trayecto EN VIVO (ubicacion actual -> una parada concreta).
 *
 *   `no_autorizada`   — esa orden no es una parada en reparto de este mensajero. Se devuelve
 *                       el MISMO valor que si no existiera: distinguirlos convertiria la
 *                       action en un oraculo para saber si una guia ajena esta en reparto.
 *   `intervalo_minimo`— se pidio demasiado pronto. CERO llamadas.
 *   `no_disponible`   — sin cliente de trazado, o el proveedor no dio geometria.
 */
export type TrazarTramoVivoResult =
  | { status: "ok"; encodedPolyline: string; distanciaM: number | null; duracionS: number | null }
  | { status: "no_autorizada" }
  | { status: "intervalo_minimo" }
  | { status: "no_disponible" };

export interface IOptimizacionRutaService {
  ejecutar(
    mensajeroId: string,
    opts: EjecutarOptimizacionOpts,
  ): Promise<EjecutarOptimizacionResult>;

  /**
   * Trayecto por calles desde donde el mensajero ESTA hasta una parada concreta.
   *
   * Es lo unico de esta feature que NO se puede cachear: en cuanto se mueve, el resultado
   * anterior deja de empezar donde el esta. Cada llamada se FACTURA, y por eso lleva su propia
   * guarda de intervalo minimo persistida (`tramoVivoAt`) — el cerrojo del cliente no cuenta,
   * porque una Server Action se puede invocar en bucle sin pasar por el boton.
   *
   * NO toca la ruta optimizada: ni la secuencia, ni el origen, ni el trazado guardado. Es una
   * consulta de apoyo, no un recalculo.
   */
  trazarTramoVivo(
    mensajeroId: string,
    input: { ubicacion: { lat: number; lng: number }; ordenId: string },
  ): Promise<TrazarTramoVivoResult>;
}
