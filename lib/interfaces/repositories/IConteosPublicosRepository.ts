import type { ConteosPublicos } from "@/lib/types/conteos-publicos";

// Feature 198 — contrato de LECTURA de los tres conteos publicos.
//
// Un solo metodo, sin parametros: el contrato del repositorio hereda la misma restriccion
// que el DTO (agregados globales, sin filtro). Que no acepte argumentos es lo que hace
// IMPOSIBLE construir una consulta por inquilino desde una superficie sin sesion.

export interface IConteosPublicosRepository {
  /**
   * Los tres conteos, en UNA sola lectura.
   *
   * Se agrupan a proposito en un metodo en vez de tres: la accion que los consume los
   * necesita juntos y cachea el trio como una unidad, asi que separarlos solo multiplicaria
   * los viajes a la base sin que nadie aproveche las partes por separado.
   */
  contar(): Promise<ConteosPublicos>;
}
