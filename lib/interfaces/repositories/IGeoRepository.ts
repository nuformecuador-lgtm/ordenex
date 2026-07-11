import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";

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
}
