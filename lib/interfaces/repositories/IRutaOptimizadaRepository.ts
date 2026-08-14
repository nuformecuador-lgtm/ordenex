// Feature 92 (design §5.2, R23/R26/R27) — contrato del repositorio de la ruta optimizada.
// Solo queries (docs/architecture.md §Repository): la resolucion del origen, las guardas
// de coste y la decision de reintentar viven en `OptimizacionRutaService`.

/** Fuente del punto de partida de la ruta (design §5.1). Vocabulario PROPIO. */
export type OrigenFuente = "gps" | "ultima_conocida" | "centroide";

/** Estado de la ruta. Espejo del enum nativo `ruta_estado`. */
export type RutaEstadoValue = "vigente" | "desactualizada";

/** Cabecera de la ruta de un mensajero, con sus paradas ya posicionadas. */
export interface RutaOptimizadaDTO {
  id: string;
  mensajeroId: string;
  estado: RutaEstadoValue;
  calculadaAt: Date | null;
  origenLat: number | null;
  origenLng: number | null;
  origenAt: Date | null;
  origenFuente: OrigenFuente | null;
  huellaSet: string | null;
  ultimoError: string | null;
  /**
   * Trazado persistido de ESTA `huellaSet`. `null` si nunca se dibujo, si la secuencia se
   * reemplazo despues (se limpia en la misma transaccion) o si el ultimo dibujo salio del
   * fallback local, que NO se cachea.
   */
  trazado: TrazadoPersistido | null;
  /** Posicion por `ordenId`. Una orden en reparto AUSENTE de este mapa esta sin optimizar. */
  secuenciaPorOrden: Map<string, number>;
}

/**
 * Trazado tal y como vive en la fila. Es un ESPEJO de `TrazadoRuta` (capa de servicio), no el
 * mismo tipo: el repositorio no debe importar de `lib/interfaces/services/`, y que la DB y el
 * dominio compartan forma hoy no obliga a que la compartan siempre.
 */
export interface TrazadoPersistido {
  encodedPolyline: string;
  distanciaM: number | null;
  duracionS: number | null;
  /**
   * Solo `"routes"` llega a persistirse (ver la migracion), pero el tipo admite `"local"`
   * porque la columna es TEXT y una fila escrita por otra version del codigo podria traerlo.
   */
  fuente: "routes" | "local";
}

/** Metadatos que acompanan a una secuencia recien calculada. */
export interface ReemplazarSecuenciaMeta {
  calculadaAt: Date;
  /**
   * Punto desde el que se calculo. `null` SOLO en el caso trivial de R35 con cero paradas
   * y sin ubicacion conocida: no hay desde donde salir ni a donde ir, pero la secuencia
   * vieja igual debe limpiarse. Las columnas de la DB ya son nullable por esto.
   */
  origen: { lat: number; lng: number; fuente: OrigenFuente } | null;
  /** R36: huella del conjunto de paradas + origen; evita repagar el mismo calculo. */
  huellaSet: string;
}

/** Ubicacion capturada por el navegador del mensajero (R23). */
export interface OrigenUbicacion {
  lat: number;
  lng: number;
  capturadaAt: Date;
  fuente: OrigenFuente;
}

export interface IRutaOptimizadaRepository {
  /** Cabecera + paradas del mensajero; `null` si nunca se creo la ruta. */
  findByMensajero(mensajeroId: string): Promise<RutaOptimizadaDTO | null>;

  /**
   * R23: persiste la ubicacion como ORIGEN de la ruta del mensajero, creando la cabecera
   * si no existia. NO toca la secuencia ni `calculada_at`: capturar una posicion no
   * invalida el orden ya calculado.
   */
  upsertOrigen(mensajeroId: string, ubicacion: OrigenUbicacion): Promise<void>;

  /**
   * R26: reemplaza ATOMICAMENTE la secuencia completa (DELETE de las paradas previas +
   * insercion de las nuevas + UPDATE de la cabecera a `vigente`), en UNA transaccion.
   * Los dos indices unicos `(ruta_id, orden_id)` y `(ruta_id, secuencia)` hacen imposible
   * persistir posiciones repetidas o la misma orden dos veces.
   *
   * `secuencia` son los `ordenId` EN ORDEN DE VISITA; la posicion es su indice + 1.
   *
   * LIMPIA el trazado persistido, en la MISMA transaccion. La polilinea vieja describe el
   * orden viejo: servirla junto a una secuencia nueva seria peor que no tener linea, porque
   * parece correcta. Se vuelve a llenar con `guardarTrazado` cuando el dibujo salga.
   */
  reemplazarSecuencia(
    mensajeroId: string,
    secuencia: string[],
    meta: ReemplazarSecuenciaMeta,
  ): Promise<void>;

  /**
   * Persiste el trazado recien obtenido. `huellaSet` NO es informativo: la escritura solo se
   * aplica si la cabecera SIGUE teniendo esa huella. Entre `reemplazarSecuencia` y esta
   * llamada hay una llamada de red a Routes, y en esa ventana otro disparo (el cron, otra
   * pestana) puede haber recalculado la ruta; sin la condicion, este trazado tardio se
   * pegaria encima de una secuencia que ya no es la suya.
   *
   * No lanza si no aplica: que la ruta haya cambiado no es un error, es una carrera perdida.
   */
  guardarTrazado(
    mensajeroId: string,
    huellaSet: string,
    trazado: TrazadoPersistido,
  ): Promise<void>;

  /**
   * R27: marca la ruta como `desactualizada` y anota el motivo AGREGADO (sin PII ni
   * credenciales). NUNCA toca las paradas: el ultimo orden valido se CONSERVA intacto,
   * que es exactamente la decision del humano en el gate adelantado. Crea la cabecera si
   * no existia (un fallo en la primera optimizacion tambien debe quedar registrado).
   */
  marcarDesactualizada(mensajeroId: string, ultimoError: string): Promise<void>;
}
