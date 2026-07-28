import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ObtenerCatalogoFiltrosOrdenesResult } from "@/lib/types/filtros-ordenes";

/**
 * Feature 144/B2 (R47/R52/R53) — catalogo de opciones de los filtros de `/ordenes`.
 *
 * Es una lectura de SOLO CATALOGO: no toca ordenes, no pagina y no depende del filtro
 * aplicado. Se resuelve una vez, en el servidor, al cargar la pagina.
 */
export interface IFiltrosOrdenesService {
  /**
   * Resuelve las CINCO colecciones EN PARALELO (`Promise.all`, R47) y las devuelve en
   * una sola entrega. `actor === null` (sin sesion) -> `unauthenticated` (R52); rol que
   * no opera el listado de ordenes -> `forbidden` sin datos (R53).
   */
  obtenerCatalogo(actor: Actor | null): Promise<ObtenerCatalogoFiltrosOrdenesResult>;
}
