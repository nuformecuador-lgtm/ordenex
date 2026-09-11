import type { IAvisoAgregadoRepository } from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IVigenciaAvisoAgregado } from "@/lib/interfaces/services/IVigenciaAvisoAgregado";
import type { NotificacionEvento } from "@/lib/types/notificacion";

// FICHA 409 (T5.2, design §5) — el resolutor de la CIFRA VIVA de un aviso agregado.
//
// No conoce Next.js ni Prisma: el repositorio y el reloj entran por constructor.
//
// COSTE MEDIDO Y ACEPTADO: hasta 2 `count` extra por sondeo de 60 s **y solo para el actor que
// tenga un aviso agregado VIVO** — quien no tiene ninguno no paga ni una consulta, porque
// `NotificacionService.listar` solo llama aqui si hay al menos una fila agregada en su listado.
// `orden` ya tiene `@@index([tiendaId])`, `@@index([estatusId])` y `@@index([zonaId])`; con el
// volumen actual (27 ordenes en `por_devolver`) el planner los sirve sin secuencial. NO se añade
// indice en esta ficha: añadir uno «por si acaso» a la tabla mas caliente del sistema es peor que
// medirlo.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export class VigenciaAvisoAgregadoService implements IVigenciaAvisoAgregado {
  constructor(
    private readonly repo: IAvisoAgregadoRepository,
    /** R53: el mismo umbral que aplica el cron. Entra por constructor, no como literal. */
    private readonly diasRepresamiento: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async cifra(evento: NotificacionEvento, actor: Actor): Promise<number> {
    if (evento === "novedades_sin_gestionar") {
      // ⚠️ EL AMBITO ES EL ACTOR. Para un `adminTienda`, «su tienda» ES su `usuarioId`: el
      // predicado de visibilidad de la 146 compara `notificacion.tienda_id = actor.usuarioId`, y
      // `orden.tienda_id` es una FK a `usuario`. No hay un segundo identificador de tienda.
      return this.repo.contarNovedadesDeTienda(actor.usuarioId);
    }
    if (evento === "devoluciones_represadas") {
      // ⚠️ LA ZONA SALE DEL ACTOR, y solo para el `adminSatelite`. Ignorarla le enseñaria al
      // satelite el total del sistema —el numero de OTRA bodega— y es una de las mutaciones que
      // el test de este servicio mata. Para maestro y admin el ambito es global (`null`).
      const zonaId = actor.rol === "adminSatelite" ? (actor.zonaId ?? null) : null;
      return this.repo.contarRepresadas(this.ancladaAntesDe(), zonaId);
    }
    // Un evento sin cifra viva no tiene nada que resolver. LANZA en vez de devolver `0`: un cero
    // de cortesia OCULTARIA un aviso vivo (R55 al reves), que es el peor desenlace posible aqui.
    // `NotificacionService.listar` no llega nunca a esta rama —filtra por `esEventoAgregado`— y
    // ademas trata cualquier fallo del resolutor mostrando la fila (R58).
    throw new Error(`vigencia: el evento "${evento}" no es un aviso agregado`);
  }

  /** Cota del umbral: entran las ancladas en `por_devolver` ANTES de este instante. */
  private ancladaAntesDe(): Date {
    return new Date(this.now().getTime() - this.diasRepresamiento * MS_POR_DIA);
  }
}
