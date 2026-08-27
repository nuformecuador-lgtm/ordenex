import type { PrismaClient } from "@prisma/client";
import type {
  CierreDelDiaRow,
  ICierreDelDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDelDiaRepository";

// Cliente Prisma acotado a lo que este repositorio necesita: los cierres. La ventana se cruza
// contra las gestiones POR RELACION (`gestiones: { some: … }`), asi que no hace falta el delegado
// de `gestion_orden` — y no tenerlo es lo que impide que esta clase acabe leyendo o escribiendo
// gestiones por su cuenta.
type CierreDelDiaPrismaClient = Pick<PrismaClient, "cierreDia">;

/**
 * Feature 293 (T3.2, design §4) — resuelve el CIERRE que agrupa el trabajo de un mensajero en la
 * fecha del podio. SOLO queries Prisma: aqui no se decide si el cierre sirve (eso es R11/R12 y
 * vive en el servicio), no se crea ningun cierre y no se cambia ningun estado (fuera de alcance 6).
 */
export class CierreDelDiaRepository implements ICierreDelDiaRepository {
  constructor(private readonly prisma: CierreDelDiaPrismaClient) {}

  /**
   * §4.2 — cierres de ESE mensajero con al menos una gestion VIGENTE cuyo `created_at` cae en la
   * ventana CR del dia. Cada pieza del `where` carga peso y se dice por que:
   *
   *  - `mensajeroId`: el premio es de una persona; sin esto, el cierre de otra podria ganar.
   *  - `gestiones: { some: … }`: el vinculo SEMANTICO. La alternativa —`solicitado_at` dentro del
   *    dia— es la que se equivoca con el cierre pedido a las 00:30, que cubre el dia anterior.
   *  - `anuladaAt: null`: una gestion deshecha no es trabajo de ese dia (67/R16). Sin esto, un
   *    cierre podria «contener» un dia solo por una gestion anulada.
   *  - `createdAt: { gte, lt }`: la ventana es SEMIABIERTA. `lt` y no `lte`: con `lte` el primer
   *    instante del dia siguiente entraria y un dia entero de gestiones se moveria de cierre.
   *
   * §4.4 — `orderBy` `solicitadoAt` asc y `id` asc como desempate, con `findFirst`: de los varios
   * posibles gana siempre el mismo, y las dos columnas del orden son inmutables.
   */
  async resolverCierreDelDia(
    mensajeroId: string,
    ventana: { desde: Date; hasta: Date },
  ): Promise<CierreDelDiaRow | null> {
    const fila = await this.prisma.cierreDia.findFirst({
      where: {
        mensajeroId,
        gestiones: {
          some: {
            anuladaAt: null,
            createdAt: { gte: ventana.desde, lt: ventana.hasta },
          },
        },
      },
      orderBy: [{ solicitadoAt: "asc" }, { id: "asc" }],
      select: { id: true, estado: true, solicitadoAt: true },
    });
    if (fila === null) return null; // R11: ese dia no tiene cierre
    return { cierreId: fila.id, estado: fila.estado, solicitadoAt: fila.solicitadoAt };
  }
}
