import type {
  GeografiaFiltrosDTO,
  OpcionCatalogo,
  OpcionConPadre,
} from "@/lib/types/filtros-ordenes";

// Lectura del catalogo geografico global.
//
// Tenia ademas `listProvincias()`, `listCantones(provinciaId)` y `listDistritos(cantonId)`
// (feature 24/R14), la navegacion por niveles que alimentaba a `GeoService` -> `geo.ts` ->
// `ZonaForm`. Toda esa cadena se borro el 2026-08-07 por decision humana. Queda SOLO el
// catalogo plano de la feature 144, que es el que tiene llamador vivo.
export interface IGeoRepository {
  // --- Feature 144/B2: proyecciones PLANAS para el catalogo de filtros de ordenes ---
  //
  // No se reusa `listarArbolGeografico()` (es `maestro`-only, anida y arrastra la zona
  // del distrito): el catalogo se precarga ENTERO en una sola entrega y el encadenamiento
  // se resuelve en el cliente, asi que se necesita el catalogo COMPLETO, no el de un
  // padre. Campos minimos (R54).

  /** Todas las provincias `{id, nombre}`, orden determinista por nombre (R48/R49). */
  listProvinciasLite(): Promise<OpcionCatalogo[]>;
  /** Todos los cantones `{id, nombre, padreId=provinciaId}`, por nombre (R48/R49). */
  listCantonesLite(): Promise<OpcionConPadre[]>;
  /** Todos los distritos `{id, nombre, padreId=cantonId}`, por nombre (R48/R49). */
  listDistritosLite(): Promise<OpcionConPadre[]>;

  /**
   * La cadena geografica ACOTADA a una zona: los distritos que la tabla puente
   * `zona_distrito` asocia a `zonaId`, mas sus cantones y provincias ascendientes.
   *
   * No es una optimizacion del catalogo completo: es OTRO catalogo. El adminSatelite solo
   * opera su zona, y ofrecerle las 491 filas del pais le deja elegir un canton que su
   * bodega no puede tener — un filtro que siempre devuelve cero y no dice por que.
   *
   * La zona sale del ACTOR, nunca de la peticion. La asociacion se lee de la N:M (feature
   * 24), que es la unica fuente de verdad desde que `distrito.zona_id` se elimino.
   */
  listGeografiaLitePorZona(zonaId: string): Promise<GeografiaFiltrosDTO>;
}
