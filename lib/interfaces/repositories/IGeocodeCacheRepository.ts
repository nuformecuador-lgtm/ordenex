// Feature 91 (design §1.2, R2/R26/R27/R28) — contrato de la cache de direcciones ya
// resueltas. Indexada por la HUELLA de la direccion (nunca la direccion en claro).
// Sin TTL (gate F1.4-Q7): la invalidacion es implicita, una direccion distinta produce
// una huella distinta. Por eso NO hay metodo de purga ni parametro de antiguedad.

export interface GeocodeCacheEntry {
  latitud: number;
  longitud: number;
  precision: string;
}

export interface IGeocodeCacheRepository {
  /** R26: coordenadas ya resueltas para esa huella, o `null` si nunca se consulto. */
  findByHash(direccionHash: string): Promise<GeocodeCacheEntry | null>;

  /**
   * R27: guarda un resultado SATISFACTORIO. Upsert por `direccion_hash` (unico), asi que
   * dos ejecuciones del mismo job no duplican la entrada (R29).
   */
  upsert(
    direccionHash: string,
    entry: GeocodeCacheEntry & { payloadCrudo: unknown },
  ): Promise<void>;
}
