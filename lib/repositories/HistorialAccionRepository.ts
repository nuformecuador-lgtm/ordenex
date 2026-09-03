import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  ActorDelHistorial,
  FilaHistorialAccion,
  FiltroHistorialAccionResuelto,
  IHistorialAccionRepository,
  OrdenHistorialAccion,
  PaginaHistorialAccion,
} from "@/lib/interfaces/repositories/IHistorialAccionRepository";
// FICHA 352 — el constructor del orden TOTAL. EXIGE el desempate como argumento, asi que no se
// puede armar el `orderBy` de un listado paginado sin el.
import { ordenTotal } from "@/lib/types/ordenamiento-listado";

// FICHA 362 (design §4.1/§4.4/§4.5) — LECTURA del registro de acciones.
//
// SOLO queries Prisma (`docs/architecture.md`): ni autorizacion por rol —vive en
// `HistorialAccionService`— ni derivacion de la categoria —vive en `CATEGORIA_POR_ACCION`, y el
// servicio ya la tradujo a una lista de tipos antes de llegar aqui—.
//
// ⚠️ ESTE REPOSITORIO NO ESCRIBE, Y NO PUEDE: su cliente es un `Pick` de `historialAccion` y
// `usuario`, y la interfaz que implementa NO declara `update`, `delete`, `updateMany` ni
// `deleteMany`. R2 no depende de que nadie se acuerde: no hay metodo que llamar.
type HistorialLecturaPrismaClient = Pick<PrismaClient, "historialAccion" | "usuario">;

/** Lo que se proyecta de cada fila. `entidad_id` NO entra (design §4.3): no cruza al DTO. */
const FILA_SELECT = {
  id: true,
  createdAt: true,
  accion: true,
  entidadTipo: true,
  entidadEtiqueta: true,
  actorUsuarioId: true,
  actorNombre: true,
  actorRol: true,
  monto: true,
  valorAnterior: true,
  valorNuevo: true,
  loteId: true,
} as const satisfies Prisma.HistorialAccionSelect;

/**
 * ⚠️ EL DESEMPATE, Y TODO EL MOTIVO POR EL QUE EXISTE ESTA CONSTANTE.
 *
 * El orden es `created_at <dir>, id ASC`. `id` es la PK: unica y NOT NULL. El desempate es FIJO
 * `asc` y NO acompaña a `sortDir`, porque el orden de un uuid v4 no significa nada — lo que la
 * paginacion necesita es que sea EL MISMO en las dos consultas, no que tenga sentido.
 *
 * Y aqui el empate NO es una rareza, es LA NORMA: todas las filas de un lote nacen del mismo
 * `CURRENT_TIMESTAMP` de la transaccion, asi que un borrado de 79 ordenes produce 79 filas con el
 * mismo instante al milisegundo y, con paginas de 25, eso cruza TRES cortes de pagina. Sin el
 * desempate, la pagina 2 duplica una fila y pierde otra que no aparece en ninguna. Es el defecto
 * MEDIDO de la ficha 352 —200 filas distintas de 241 al recorrer 10 paginas—, amplificado.
 */
const DESEMPATE_UNICO: Prisma.HistorialAccionOrderByWithRelationInput = { id: "asc" };

export class HistorialAccionRepository implements IHistorialAccionRepository {
  constructor(private readonly prisma: HistorialLecturaPrismaClient) {}

  /**
   * EL UNICO CONSTRUCTOR DE `where` DEL MODULO (R30). Lo comparten `list` (la pantalla) y
   * `listAll` (la descarga), asi que no pueden divergir POR CONSTRUCCION y no por una
   * comprobacion que alguien deba recordar. Es lo que hace `OrdenRepository.list`.
   */
  private construirWhere(filtro: FiltroHistorialAccionResuelto): Prisma.HistorialAccionWhereInput {
    const where: Prisma.HistorialAccionWhereInput = {};

    if (filtro.actorId !== null) where.actorUsuarioId = { in: [...filtro.actorId] };
    // La interseccion de `accion` y `categoria` ya viene HECHA por el servicio (design §4.2): aqui
    // llega una sola lista de tipos. Vacia significa «ninguna combinacion posible», y `in: []` no
    // casa con ninguna fila — que es exactamente lo correcto.
    if (filtro.accion !== null) where.accion = { in: [...filtro.accion] };
    if (filtro.entidadTipo !== null) where.entidadTipo = { in: [...filtro.entidadTipo] };
    if (filtro.desde !== null || filtro.hasta !== null) {
      where.createdAt = {
        ...(filtro.desde !== null ? { gte: filtro.desde } : {}),
        // `lt` del dia SIGUIENTE y no `lte` del mismo: con `lte` se perderian las filas escritas
        // entre las 00:00 y las 23:59:59.999 del ultimo dia del rango, que es justo el dia que el
        // usuario acaba de pedir. Es la trampa de las seis horas que cerro la feature 166; el
        // servicio ya entrega los dos instantes con esa convencion.
        ...(filtro.hasta !== null ? { lt: filtro.hasta } : {}),
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // LA BUSQUEDA LIBRE, Y EXACTAMENTE LO QUE ALCANZA (R31).
    //
    // DOS cosas y ni una mas, que son las que su placeholder anuncia —«Persona, guía, remisión o
    // nombre de lo afectado»—:
    //   1. el NOMBRE DEL ACTOR, resuelto contra `usuario` por la relacion (decenas de filas);
    //   2. la ETIQUETA CONGELADA de la entidad, que ya contiene guia, remision y los nombres de
    //      zona / tarifa / plantilla / persona afectada.
    //
    // NO alcanza `entidad_id` (un uuid no se busca a mano), ni `lote_id`, ni `valor_anterior`/
    // `valor_nuevo`. Ensanchar la busqueda a un campo que el placeholder no anuncia es la mutacion
    // que R31 prohibe, y hay un caso negativo que la caza.
    //
    // Se busca contra `actor_nombre` CONGELADO **y** contra la relacion viva: el congelado es lo
    // que la pantalla pinta —y lo que el usuario esta leyendo cuando escribe— y la relacion cubre
    // a quien cambio de nombre despues. Buscar solo por uno de los dos daria cero resultados en
    // uno de los dos casos, sin decir por que.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (filtro.q !== null) {
      // `contains` de Prisma viaja PARAMETRIZADO: el `%` y el `_` que el usuario escriba son texto
      // literal para el motor y no comodines. No hace falta `escaparComodinesLike` —que existe
      // para los `$queryRaw` con `LIKE` a mano— y meterlo aqui escaparia dos veces.
      const termino = filtro.q;
      where.OR = [
        { entidadEtiqueta: { contains: termino, mode: "insensitive" } },
        { actorNombre: { contains: termino, mode: "insensitive" } },
        { actor: { is: { nombre: { contains: termino, mode: "insensitive" } } } },
        { actor: { is: { primerApellido: { contains: termino, mode: "insensitive" } } } },
      ];
    }

    return where;
  }

  /**
   * EL UNICO `orderBy` DEL MODULO, armado con `ordenTotal`, que EXIGE el desempate como argumento
   * (R23). Lo comparten la pantalla y la descarga: si divergieran, la fila 26 del archivo dejaria
   * de ser la primera de la pagina 2 y ninguna pantalla lo diria.
   */
  private construirOrderBy(
    orden: OrdenHistorialAccion,
  ): Prisma.HistorialAccionOrderByWithRelationInput[] {
    return ordenTotal([{ createdAt: orden.sortDir }], DESEMPATE_UNICO);
  }

  async list(params: {
    filtro: FiltroHistorialAccionResuelto;
    orden: OrdenHistorialAccion;
    page: number;
    pageSize: number;
  }): Promise<PaginaHistorialAccion> {
    const where = this.construirWhere(params.filtro);
    // `count` y `findMany` comparten EL MISMO `where`: el total y la pagina cuentan el mismo
    // universo por construccion, no por una comprobacion que alguien deba recordar.
    const [items, total] = await Promise.all([
      this.prisma.historialAccion.findMany({
        where,
        select: FILA_SELECT,
        orderBy: this.construirOrderBy(params.orden),
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.historialAccion.count({ where }),
    ]);
    return { items, total };
  }

  async listAll(params: {
    filtro: FiltroHistorialAccionResuelto;
    orden: OrdenHistorialAccion;
    limite: number;
  }): Promise<FilaHistorialAccion[]> {
    // MISMO `where` y MISMO `orderBy` que `list` (R30). El `take` es el tope de la descarga mas
    // uno: el servicio compara y responde `limite_excedido` en vez de truncar en silencio.
    return this.prisma.historialAccion.findMany({
      where: this.construirWhere(params.filtro),
      select: FILA_SELECT,
      orderBy: this.construirOrderBy(params.orden),
      take: params.limite,
    });
  }

  /**
   * El catalogo de actores del selector: los usuarios que HAN ACTUADO alguna vez, no la lista de
   * usuarios de la casa. Ofrecer a alguien que nunca hizo nada seria un filtro que siempre da
   * vacio.
   *
   * Se resuelve contra `usuario` por la relacion inversa (`some: {}`), no por un `distinct` sobre
   * la tabla del registro: el catalogo tiene que traer el nombre VIVO —es un selector, no una fila
   * de historia— y la tabla de usuarios tiene decenas de filas, no decenas de miles.
   */
  async listarActores(): Promise<ActorDelHistorial[]> {
    const filas = await this.prisma.usuario.findMany({
      where: { historialAcciones: { some: {} } },
      select: { id: true, nombre: true, primerApellido: true },
      orderBy: [{ nombre: "asc" }, { primerApellido: "asc" }],
    });
    return filas.map((u) => ({
      id: u.id,
      nombre: [u.nombre, u.primerApellido].filter((p) => p != null && p !== "").join(" "),
    }));
  }
}
