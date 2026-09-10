import type { PrismaClient } from "@prisma/client";
import type {
  IAvisoAgregadoRepository,
  ResumenNovedadesTienda,
  ResumenRepresadas,
  ResumenRepresadasZona,
} from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import { ESTATUS_POR_GRUPO } from "@/lib/types/novedad-grupo";
import type { OrderStatusValue } from "@/lib/types/order-status";

// FICHA 409 (T4.1, design §4.4) — repositorio de los DOS avisos AGREGADOS. SOLO queries Prisma.
//
// LOS TRES LITERALES QUE ESTE ARCHIVO NECESITA, Y DE DONDE SALEN:
//
//  · el estado de una NOVEDAD en devolucion -> `ESTATUS_POR_GRUPO.devolucion`
//    (`lib/types/novedad-grupo.ts`), que es EL MISMO punto del que lo saca
//    `OrdenRepository.novedadWhere` para pintar `/novedades`. No se copia el `where`: se comparte
//    su unica fuente. Si el aviso dijera «5» y la pantalla enseñara 4, el aviso quedaria
//    desacreditado el primer dia.
//  · la familia de historial que ANCLA una devolucion -> `anclaje_devolucion`, el mismo literal
//    que usa `DevolucionSlaRepository` (239/R12). Es el instante en que se APRUEBA el cierre que
//    trae el paquete de vuelta, y es el reloj que el cron del rechazo automatico aplica.
//  · el estado REPRESADO -> `por_devolver`, y NO `devolviendo_a_tienda` (R46).
//
// ⚠️ `orden.updated_at` NO SE USA NUNCA COMO ANCLA en este archivo, y es deliberado: es una fecha
// mutable que cualquier escritura mueve. Leccion ya pagada en este repo.

/** Estado de una novedad «en devolucion». Sale del punto unico, no de un literal propio. */
const ESTATUS_NOVEDAD_DEVOLUCION = ESTATUS_POR_GRUPO.devolucion;
/** `resultado` de la gestion que ancla la ventana (mismo valor que `DevolucionSlaRepository`). */
const RESULTADO_DEVUELTA = "devuelta";
/** Familia de historial que marca la entrada en `devuelta` (239/R12). */
const ORIGEN_ANCLAJE = "anclaje_devolucion";
/**
 * ⚠️ EL ESTADO VIGILADO, Y ESTA MEDIDO (produccion 2026-09-10): `por_devolver` = 27 ordenes, media
 * 2,4 d, maximo 8,2 d, SIETE por encima de 3 d. `devolviendo_a_tienda` = 247 ordenes y NINGUNA por
 * encima de 3 d: ese estado FLUYE, R46 PROHIBE vigilarlo y hay un test de no-inclusion propio
 * contra Postgres real.
 */
const ESTATUS_REPRESADA: OrderStatusValue = "por_devolver";

type AvisoAgregadoPrismaClient = Pick<PrismaClient, "orden">;

/** Lo unico que este repositorio necesita del de ordenes: el conteo que ya pinta `/novedades`. */
type ContadorDeNovedades = Pick<IOrdenRepository, "countNovedadesByTienda">;

export class AvisoAgregadoRepository implements IAvisoAgregadoRepository {
  /**
   * `ordenRepo` entra POR CONSTRUCTOR y sin default: el conteo VIVO de novedades tiene que ser
   * LITERALMENTE el metodo que ya alimenta `/novedades` (`countNovedadesByTienda`), no una copia
   * suya. Sin default a proposito — un default construido aqui dentro invitaria a que alguien lo
   * cambiara por una consulta propia y las dos cifras divergirian sin que nada se pusiera rojo.
   */
  constructor(
    private readonly prisma: AvisoAgregadoPrismaClient,
    private readonly ordenRepo: ContadorDeNovedades,
  ) {}

  /**
   * R35/R37/R38 — el resumen por tienda. UNA consulta, con las dos proyecciones anidadas que ya
   * usa `DevolucionSlaRepository.findDevueltasSla`; la agrupacion por tienda se hace en memoria
   * (la poblacion de `/novedades` son decenas de filas, no millones).
   *
   * EL ANCLA, en el mismo orden que el cron (239/R12 y R14):
   *   1. la ULTIMA transicion `anclaje_devolucion` de la orden -> el instante en que un admin
   *      aprobo el cierre que trajo el paquete de vuelta. `take 1` con `createdAt desc` implementa
   *      «si la orden dio la vuelta entera y volvio, gana el anclaje MAS RECIENTE»;
   *   2. si no la hay (poblacion LEGADA, anterior a la 239), el `created_at` de su gestion
   *      `devuelta` vigente — para no moverle el plazo por debajo a una orden en vuelo;
   *   3. y solo si tampoco hay gestion vigente —una orden en `devuelta` sin ninguna de las dos, que
   *      por construccion no deberia existir: el unico camino a `devuelta` es la aprobacion de un
   *      cierre— el `created_at` de la propia orden. Esta rama existe para que `masAntiguaAt`
   *      NUNCA sea nulo y el `total` siga coincidiendo con el de la pantalla; declarada, puede
   *      SOBREESTIMAR los dias, jamas subestimarlos.
   */
  async resumenNovedadesPorTienda(): Promise<ResumenNovedadesTienda[]> {
    const filas = await this.prisma.orden.findMany({
      // Mismo universo que `novedadWhere(tiendaId, "devolucion")`, sin la acotacion por tienda:
      // el cron recorre TODAS las tiendas de una vez.
      where: { deletedAt: null, estatus: { value: ESTATUS_NOVEDAD_DEVOLUCION } },
      select: {
        id: true,
        tiendaId: true,
        createdAt: true,
        gestiones: {
          where: { resultado: RESULTADO_DEVUELTA, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { causaDevolucion: true, createdAt: true },
        },
        historialEstados: {
          where: { origenTipo: ORIGEN_ANCLAJE },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const porTienda = new Map<string, ResumenNovedadesTienda>();
    for (const fila of filas) {
      const gestion = fila.gestiones[0];
      const anclaje = fila.historialEstados[0];
      const ancladaAt = anclaje?.createdAt ?? gestion?.createdAt ?? fila.createdAt;
      const acumulado = porTienda.get(fila.tiendaId);
      if (!acumulado) {
        porTienda.set(fila.tiendaId, {
          tiendaId: fila.tiendaId,
          total: 1,
          masAntiguaAt: ancladaAt,
          ordenes: [{ ordenId: fila.id, causa: gestion?.causaDevolucion ?? null }],
        });
        continue;
      }
      acumulado.total += 1;
      acumulado.ordenes.push({ ordenId: fila.id, causa: gestion?.causaDevolucion ?? null });
      if (ancladaAt.getTime() < acumulado.masAntiguaAt.getTime()) {
        acumulado.masAntiguaAt = ancladaAt;
      }
    }
    return [...porTienda.values()];
  }

  /**
   * R57 — la cifra VIVA de una tienda. DELEGA en el metodo del repositorio de ordenes que ya
   * alimenta `/novedades`: asi el numero del panel y el de su pantalla no pueden divergir, por
   * construccion y no por una comprobacion que alguien deba recordar.
   */
  contarNovedadesDeTienda(tiendaId: string): Promise<number> {
    return this.ordenRepo.countNovedadesByTienda(tiendaId, "devolucion");
  }

  /** R45/R46/R48 — el resumen por zona. Mismo predicado que `contarRepresadas`, agrupado. */
  async resumenRepresadasPorZona(ancladaAntesDe: Date): Promise<ResumenRepresadasZona[]> {
    const filas = await this.filasRepresadas(ancladaAntesDe);
    const porZona = new Map<string, ResumenRepresadasZona>();
    for (const fila of filas) {
      const acumulado = porZona.get(fila.zonaId);
      if (!acumulado) {
        porZona.set(fila.zonaId, {
          zonaId: fila.zonaId,
          total: 1,
          masAntiguaAt: fila.ancladaAt,
        });
        continue;
      }
      acumulado.total += 1;
      if (fila.ancladaAt.getTime() < acumulado.masAntiguaAt.getTime()) {
        acumulado.masAntiguaAt = fila.ancladaAt;
      }
    }
    return [...porZona.values()];
  }

  /** R49 — el TOTAL, sin acotar por zona. */
  async resumenRepresadasGlobal(ancladaAntesDe: Date): Promise<ResumenRepresadas> {
    const filas = await this.filasRepresadas(ancladaAntesDe);
    if (filas.length === 0) return { total: 0, masAntiguaAt: null };
    let masAntiguaAt = filas[0].ancladaAt;
    for (const fila of filas) {
      if (fila.ancladaAt.getTime() < masAntiguaAt.getTime()) masAntiguaAt = fila.ancladaAt;
    }
    return { total: filas.length, masAntiguaAt };
  }

  /** R57 — cifra viva acotada al ambito del actor (`null` = todo el sistema). */
  async contarRepresadas(ancladaAntesDe: Date, zonaId: string | null): Promise<number> {
    const filas = await this.filasRepresadas(ancladaAntesDe);
    return zonaId === null ? filas.length : filas.filter((f) => f.zonaId === zonaId).length;
  }

  /**
   * EL PREDICADO DE REPRESAMIENTO, EN UN SOLO SITIO. Los cuatro metodos publicos de arriba lo
   * comparten, asi que el resumen del cron y la cifra viva del panel NO PUEDEN describir
   * poblaciones distintas (R57).
   *
   * Represada := `estatus.value = 'por_devolver'` **Y** no borrada **Y** su ultima transicion CON
   * DESTINO `por_devolver` ocurrio ANTES de `ancladaAntesDe` (= `now - DIAS_REPRESAMIENTO`).
   *
   * ⚠️ EL FILTRO POR ANTIGUEDAD SE APLICA EN MEMORIA Y NO EN EL `where`, A PROPOSITO: la condicion
   * es sobre la ULTIMA fila de historial de cada orden (`take 1` tras `orderBy desc`), y un
   * `where` sobre la relacion casaria con que EXISTA ALGUNA fila antigua — que no es lo mismo. Una
   * orden que salio de `por_devolver` y volvio a entrar HOY tiene una transicion vieja y una
   * nueva: con el `where` relacional entraria como represada de hace semanas. La poblacion son
   * decenas de filas (27 medidas en produccion), asi que el coste es irrelevante y la correccion
   * no.
   *
   * ⚠️ NO ENTRA `devolviendo_a_tienda` (R46). Ver la nota de `ESTATUS_REPRESADA`.
   */
  private async filasRepresadas(
    ancladaAntesDe: Date,
  ): Promise<Array<{ ordenId: string; zonaId: string; ancladaAt: Date }>> {
    const filas = await this.prisma.orden.findMany({
      where: { deletedAt: null, estatus: { value: ESTATUS_REPRESADA } },
      select: {
        id: true,
        zonaId: true,
        createdAt: true,
        historialEstados: {
          where: { estatusDestino: { value: ESTATUS_REPRESADA } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    const represadas: Array<{ ordenId: string; zonaId: string; ancladaAt: Date }> = [];
    for (const fila of filas) {
      // Sin transicion registrada a `por_devolver` (poblacion legada o siembra manual), el ancla
      // honesta que queda es el nacimiento de la orden. Nunca `updated_at`.
      const ancladaAt = fila.historialEstados[0]?.createdAt ?? fila.createdAt;
      if (ancladaAt.getTime() > ancladaAntesDe.getTime()) continue; // aun no supera el umbral
      represadas.push({ ordenId: fila.id, zonaId: fila.zonaId, ancladaAt });
    }
    return represadas;
  }
}
