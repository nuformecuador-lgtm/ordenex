import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { GrupoNovedad } from "@/lib/types/novedad-grupo";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 87/89 (T3, design §2.2) — contrato del servicio de NOVEDADES: la lista paginada de UNA
// superficie de `/novedades` para el `adminTienda` (R11).
//
// FEATURE 236 (T2.4, design §3) — el servicio gana el GRUPO y **no se parte en dos**. Hasta el
// 2026-08-19 este contrato hablaba de «las devoluciones del mensajero» y devolvia DOS poblaciones
// mezcladas: las que reposan en `devuelta` (239) y aquellas sobre las que un mensajero pidio ayuda
// (`ayuda_tienda`, 235). Hoy cada una es su propia superficie, y cual se lista lo dice el `grupo`.
//
// POR QUE NO UN `AyudaTiendaService` NUEVO. La proyeccion a `NovedadDTO` —intentos en lote, nombres
// de catalogo, decimales convertidos, orden por recencia— es la MISMA, y el propio servicio declara
// por que vive en un solo sitio: «UNICA proyeccion del listado: la pagina y el archivo salen de
// aqui, para que no puedan divergir». Un servicio nuevo seria una SEGUNDA PROYECCION DE LA MISMA
// FILA, que es exactamente lo que ese comentario prohibe. (El precedente de
// `RechazosSlaTiendaService` NO aplica: aquel tiene DTO propio, con el monto money-safe como
// string; aqui el DTO es el mismo.)

/**
 * Input paginado. `pageSize` lo fija el borde (10, R22); el service lo recibe ya acotado.
 *
 * Feature 236: `grupo` es OBLIGATORIO y no opcional con default, a proposito — un olvido de
 * cableado tiene que romper el TYPECHECK, no listar en silencio el grupo equivocado. Y NO viaja en
 * la entrada de la Server Action: el cliente elige a que funcion llama, no que estatus se consulta
 * (design §4).
 */
export interface ListarNovedadesInput {
  page: number;
  pageSize: number;
  grupo: GrupoNovedad;
}

/** El mismo alcance, sin recorte por pagina: solo el grupo. */
export interface ListarNovedadesCompletoInput {
  grupo: GrupoNovedad;
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
   * Lista la pagina del grupo pedido, acotada a la tienda del actor (`actor.usuarioId` = tiendaId,
   * R10) y con los intentos de entrega resueltos en UNA consulta agregada. Rol != adminTienda ->
   * `forbidden` ANTES de tocar el repositorio (R11).
   *
   * Lo que el grupo decide, y solo el grupo:
   *  - el PREDICADO (`devuelta` o `ayuda_tienda`), que lo aplica el repositorio;
   *  - la CAUSA: solo se consulta para `devolucion`. Para `ayuda` se emite `null` y la consulta NO
   *    se hace (R26) — la causa de una orden en ayuda seria la de una devolucion anterior ya
   *    deshecha, un dato cierto que no describe por que esa orden esta en la pantalla;
   *  - el ORDEN: `devolucion` por la fecha de su ultima gestion vigente, la mas reciente primero;
   *    `ayuda` por la fecha de la SOLICITUD, **la que lleva mas esperando primero** (D7/R17).
   */
  listar(input: ListarNovedadesInput, actor: Actor): Promise<ListarNovedadesServiceResult>;
  /**
   * El MISMO listado que `listar`, SIN recorte por pagina, para la descarga del archivo. Mismo
   * predicado, mismo alcance, mismo orden y la MISMA proyeccion a DTO que la pagina: dos
   * proyecciones distintas de la misma fila serian dos listados distintos (R37).
   *
   * El tope de filas se evalua AQUI (servidor), con el CONTEO del listado y antes de leer ninguna
   * fila: superarlo devuelve `limite_excedido` con los conteos y NINGUNA orden (R40). Rol !=
   * adminTienda -> `forbidden` (R11).
   */
  listarCompleto(
    input: ListarNovedadesCompletoInput,
    actor: Actor,
  ): Promise<ListarNovedadesCompletoServiceResult>;
}
