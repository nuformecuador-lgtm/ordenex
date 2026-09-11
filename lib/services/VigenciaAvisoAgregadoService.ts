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
//
// FICHA 417 (design §4) — UNA REGLA, LAS DOS RAMAS: **si el ambito del actor no existe, se falla;
// no se inventa uno.** Hasta la 417 las dos ramas de `cifra` derivaban el ambito del actor sin
// comprobar que ese actor TUVIERA el ambito que el aviso pide, y las dos degradaban en silencio:
// el satelite sin zona caia en `null` —que en `contarRepresadas` es TODO EL SISTEMA— y cualquier
// rol que no fuera `adminTienda` contaba las novedades de una «tienda» que no existe, o sea `0`,
// que la 409/R55 traduce en APAGAR el aviso sin que nadie lo lea.
//
// Que las dos protecciones existieran «de hecho» no es lo mismo que que existan: lo que lo impedia
// —quien recibe cada aviso (`lib/notificaciones/emitir.ts`) y el predicado de visibilidad de la 146
// (`lib/repositories/NotificacionRepository.ts`)— vive en OTROS archivos, y ningun test de este
// seam se ponia rojo si alguien tocaba aquello. Con ambos intactos, este seam ya se niega por su
// cuenta y lo dice. Es defensa en profundidad, no un sustituto.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Un id util es una cadena no vacia. `null`, `undefined`, `""` y cualquier otra cosa NO lo son.
 * Mismo criterio —y a proposito la misma forma— que `lib/analytics/alcance.ts:218`, que es el
 * precedente del repo para «adminSatelite sin zona».
 */
function idUtil(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length > 0;
}

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
      //
      // FICHA 417 (R3/R4) — y por eso mismo, para quien NO es `adminTienda` ese `usuarioId` no
      // identifica ninguna tienda: `contarNovedadesDeTienda` acota por `tiendaId`, asi que el
      // conteo solo podria dar `0` y la 409/R55 apagaria el aviso SIN QUE NADIE LO LEA, LO MARQUE
      // NI LO DESCARTE. Ese es el peor de los dos modos de fallo, no el menor: un numero de mas se
      // nota al mirarlo, un aviso que no sale no se nota nunca. Se lanza.
      if (actor.rol !== "adminTienda") {
        throw new Error(
          `vigencia: el evento "${evento}" se acota por tienda y el rol "${actor.rol}" no es una tienda`,
        );
      }
      return this.repo.contarNovedadesDeTienda(actor.usuarioId);
    }
    if (evento === "devoluciones_represadas") {
      // ⚠️ LA ZONA SALE DEL ACTOR, y solo para el `adminSatelite`. Ignorarla le enseñaria al
      // satelite el total del sistema —el numero de OTRA bodega— y es una de las mutaciones que
      // el test de este servicio mata. Para maestro y admin el ambito es global (`null`).
      if (actor.rol !== "adminSatelite") {
        return this.repo.contarRepresadas(this.ancladaAntesDe(), null);
      }
      // FICHA 417 (R1/R2) — el comentario de arriba cubria IGNORAR la zona; esto cubre que FALTE,
      // que desemboca exactamente en el mismo sitio. `Actor.zonaId` es opcional, asi que
      // `{ rol: "adminSatelite", zonaId: null }` es un valor LEGAL del tipo, y ese `null` no
      // significa «su zona»: en `contarRepresadas` significa TODO EL SISTEMA.
      // No se degrada a global, ni a «todas las zonas», ni a `0`: se lanza, igual que
      // `lib/analytics/alcance.ts` hace con `sin_zona_asignada`. El aterrizaje ya existe —
      // `NotificacionService.cifrasVivas` lo registra con su causa y la 409/R58 muestra el aviso
      // SIN numero—, mientras que un `0` de cortesia apagaria la fila en silencio.
      if (!idUtil(actor.zonaId)) {
        throw new Error(
          `vigencia: el evento "${evento}" se acota por zona y el adminSatelite no tiene zona asignada`,
        );
      }
      return this.repo.contarRepresadas(this.ancladaAntesDe(), actor.zonaId);
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
