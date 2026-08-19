// Feature 92 (seguimiento) — contrato del proveedor de TRAZADO de ruta (Google Routes API,
// `computeRoutes`). Es un paso DISTINTO y POSTERIOR a la optimizacion:
//
//   Route Optimization  ->  en que ORDEN visitar las paradas   (`IRouteOptimizationClient`)
//   Routes              ->  por que CALLES se va de una a otra (este contrato)
//
// Son dos APIs, dos SKUs y dos facturas. Separarlas en dos interfaces mantiene el trazado
// como algo OPCIONAL: si Routes falla o no esta configurado, la ruta sigue ordenada y
// utilizable; solo se queda sin dibujo.
export interface ParadaTrazado {
  ordenId: string;
  lat: number;
  lng: number;
}

export interface TrazarRutaInput {
  /** Punto de partida, el mismo que uso la optimizacion. */
  origen: { lat: number; lng: number };
  /** Paradas YA ORDENADAS por la optimizacion. El orden se respeta tal cual. */
  paradasEnOrden: ParadaTrazado[];
}

/**
 * Un TRAMO del recorrido: lo que hay entre dos puntos consecutivos de la ruta. Sirve para
 * resaltar el trayecto a la siguiente parada sin volver a pedirle nada al proveedor.
 */
export interface TramoTrazado {
  /** Polilinea codificada de ESTE tramo, no de la ruta entera. */
  encodedPolyline: string;
  /** Metros del tramo. `null` si el proveedor no los devolvio. */
  distanciaM: number | null;
  /** Segundos del tramo. `null` si el proveedor no los devolvio. */
  duracionS: number | null;
}

/**
 * Desenlace del trazado. Mismo vocabulario que `OptimizarOutcome` para que el service no
 * tenga que aprender dos tablas distintas, mas un `omitida` que aquel no necesita: el
 * trazado tiene un limite de paradas por peticion mas bajo que la optimizacion.
 */
export type TrazarRutaOutcome =
  | {
      status: "ok";
      /** Polilinea codificada de Google, lista para pintar en un mapa. */
      encodedPolyline: string;
      /** Distancia total en metros. `null` si el proveedor no la devolvio. */
      distanciaM: number | null;
      /** Duracion total en segundos. `null` si el proveedor no la devolvio. */
      duracionS: number | null;
      /**
       * El recorrido partido en TRAMOS, uno por cada par de puntos consecutivos: el tramo `i`
       * va del punto `i` al `i+1`, empezando en el origen. Es decir, `tramos[0]` es
       * origen -> primera parada, y su longitud siempre es `paradasEnOrden.length`.
       *
       * NO CUESTA UNA LLAMADA APARTE: Google los devuelve en la MISMA respuesta que la
       * polilinea global, solo hay que pedirlos en el `FieldMask`. Por eso se piden siempre:
       * lo unico que ahorraria no hacerlo son unos KB de respuesta.
       *
       * Vacio si el proveedor no los devolvio, o si alguno vino sin geometria — los tramos se
       * usan para resaltar UNO concreto, y una lista incompleta desplazaria las posiciones y
       * resaltaria el tramo equivocado.
       */
      tramos: TramoTrazado[];
    }
  /** No se pidio el trazado (pocas paradas, o mas de las que admite una peticion). */
  | { status: "omitida"; razon: string }
  /** Red, timeout, HTTP 5xx o cuota: reintentable. */
  | { status: "transitorio"; detalle: string }
  /** 401/403: credencial, scope o facturacion rotos. */
  | { status: "config_invalida"; detalle: string };

export interface IRoutesClient {
  trazar(input: TrazarRutaInput): Promise<TrazarRutaOutcome>;
}
