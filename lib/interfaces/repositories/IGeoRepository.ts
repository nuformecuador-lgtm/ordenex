import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";
import type { OpcionCatalogo, OpcionConPadre } from "@/lib/types/filtros-ordenes";

// Feature 24/R14. Lectura del catalogo geografico global para navegar la
// jerarquia provincia -> canton -> distrito al componer una zona.
export interface IGeoRepository {
  /** Provincias del catalogo global, ordenadas por nombre. */
  listProvincias(): Promise<ProvinciaLightDTO[]>;
  /** Cantones de una provincia, ordenados por nombre. */
  listCantones(provinciaId: string): Promise<CantonLightDTO[]>;
  /**
   * Distritos de un canton, cada uno indicando si ya esta asignado a una zona
   * (`zonaId`/`zonaNombre`), ordenados por nombre.
   */
  listDistritos(cantonId: string): Promise<DistritoCatalogoDTO[]>;

  // --- Feature 144/B2: proyecciones PLANAS para el catalogo de filtros de ordenes ---
  //
  // No se reusa `listarArbolGeografico()` (es `maestro`-only, anida y arrastra la zona
  // del distrito) ni `listCantones(provinciaId)`/`listDistritos(cantonId)`: el catalogo
  // se precarga ENTERO en una sola entrega y el encadenamiento se resuelve en el cliente,
  // asi que se necesita el catalogo COMPLETO, no el de un padre. Campos minimos (R54).

  /** Todas las provincias `{id, nombre}`, orden determinista por nombre (R48/R49). */
  listProvinciasLite(): Promise<OpcionCatalogo[]>;
  /** Todos los cantones `{id, nombre, padreId=provinciaId}`, por nombre (R48/R49). */
  listCantonesLite(): Promise<OpcionConPadre[]>;
  /** Todos los distritos `{id, nombre, padreId=cantonId}`, por nombre (R48/R49). */
  listDistritosLite(): Promise<OpcionConPadre[]>;
}
