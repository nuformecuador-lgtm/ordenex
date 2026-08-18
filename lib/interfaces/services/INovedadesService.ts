import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 87/89 (T3, design §2.2) — contrato del servicio de NOVEDADES: lista paginada de las
// devoluciones del mensajero de la tienda del adminTienda. Una orden es novedad si tiene una
// gestion de devolucion VIGENTE y AUN NO esta cerrada (estatus fuera de
// `{entregada, devolviendo_a_tienda, devuelta_a_tienda}`), independientemente de su estatus ACTUAL
// (la feature 47 la mueve fuera de `devuelta`). Cada una con su causa de devolucion vigente.
// Logica de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a resultado
// tipado. Solo el rol `adminTienda` (R11).

// Input paginado. `pageSize` lo fija el borde (10, R22); el service lo recibe ya acotado.
export interface ListarNovedadesInput {
  page: number;
  pageSize: number;
}

// R22/R5: respuesta paginada `{ items, total, page, pageSize }` (shape identico al de
// `mi-wallet` para reutilizar `Pagination`). `forbidden` si el rol no es adminTienda (R5),
// sin exponer datos de ordenes.
export type ListarNovedadesServiceResult =
  | { status: "ok"; items: NovedadDTO[]; total: number; page: number; pageSize: number }
  | { status: "forbidden" };

/**
 * Feature 170/184 (`ListarCompletoServiceResult`) — el MISMO listado sin recorte por pagina,
 * para el archivo de la descarga. Tres formas excluyentes: `ok` con el conjunto entero,
 * `limite_excedido` con SOLO conteos (jamas filas, jamas truncado) y `forbidden`.
 */
export type ListarNovedadesCompletoServiceResult = ListarCompletoServiceResult<NovedadDTO>;

export interface INovedadesService {
  /**
   * R1-R13: lista la pagina de novedades (devoluciones vigentes y abiertas) de la tienda del
   * actor (acotada a `actor.usuarioId` = tiendaId, R9), con la causa derivada de la ultima
   * gestion `devuelta` vigente (R6/R7/R10) resuelta en UNA consulta agregada (R8). Ordena por
   * la fecha de esa gestion desc, con fallback a `Orden.createdAt` (R12). Rol != adminTienda
   * -> forbidden (R11).
   */
  listar(input: ListarNovedadesInput, actor: Actor): Promise<ListarNovedadesServiceResult>;
  /**
   * El MISMO listado que `listar`, SIN recorte por pagina, para la descarga del archivo. Mismo
   * predicado, mismo orden (R12) y la MISMA proyeccion a DTO que la pagina: dos proyecciones
   * distintas de la misma fila serian dos listados distintos. El tope de filas se evalua AQUI
   * (servidor), con el conteo del listado, antes de leer ninguna fila: superarlo devuelve
   * `limite_excedido` con los conteos y ninguna orden. Rol != adminTienda -> forbidden (R11).
   */
  listarCompleto(actor: Actor): Promise<ListarNovedadesCompletoServiceResult>;
}
