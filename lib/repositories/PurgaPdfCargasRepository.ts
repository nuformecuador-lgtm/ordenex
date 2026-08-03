import { type Prisma, type PrismaClient } from "@prisma/client";
import type {
  CargaPurgable,
  IPurgaPdfCargasRepository,
} from "@/lib/interfaces/repositories/IPurgaPdfCargasRepository";

// Feature 178 (design §4.2) — el repo solo necesita `carga`, `orden` y `$transaction`.
// `limpiarReferencias` escribe una transaccion POR CARGA (design §4.2): una carga que falle no
// arrastra a las ya purgadas.
type PurgaPdfPrismaClient = Pick<PrismaClient, "carga" | "orden" | "$transaction">;

/**
 * R8 — predicado de "referencia viva": la carga conserva alguna de sus dos columnas testigo, o
 * alguna de sus ordenes la conserva (`some` = `EXISTS` en SQL). Una carga sin ninguna referencia
 * viva NO es candidata aunque su `created_at` este fuera de la ventana: es lo que hace la purga
 * idempotente (R20) sin columna de estado nueva.
 */
const REFERENCIA_VIVA: Prisma.CargaWhereInput["OR"] = [
  { downloadStoragePath: { not: null } },
  { downloadUrl: { not: null } },
  {
    ordenes: {
      some: {
        OR: [{ downloadStoragePath: { not: null } }, { downloadUrl: { not: null } }],
      },
    },
  },
];

/**
 * R5/R7/R8 — `where` compartido por la seleccion y por la comprobacion de pendiente, para que no
 * puedan divergir. El corte va sobre `createdAt` (columna inmutable, decision (a)) con `lte`
 * (corte INCLUSIVO, decision (f)); NUNCA sobre `fechaCarga`, que el usuario podria fijar a mano.
 */
function whereCandidatas(corte: Date): Prisma.CargaWhereInput {
  return {
    createdAt: { lte: corte },
    OR: REFERENCIA_VIVA,
  };
}

/**
 * Feature 178 (design §4.2) — repositorio del cron de purga de PDF de cargas. SOLO queries
 * Prisma: no calcula el corte (lo hace el service a partir de la retencion), no habla con
 * Storage y no decide el orden de las operaciones. No se reutiliza `OrdenRepository` (design
 * §4.2): sus metodos sobre estas columnas son setters de una sola fila del camino caliente de la
 * feature 177, y aislar la purga evita que un cambio aqui toque el repo del que cuelga media
 * aplicacion.
 */
export class PurgaPdfCargasRepository implements IPurgaPdfCargasRepository {
  constructor(private readonly prisma: PurgaPdfPrismaClient) {}

  /**
   * R5/R7/R8/R9: hasta `limite` cargas con `created_at <= corte` y referencia viva, ASC por
   * `created_at` (lo mas viejo primero: si una corrida no alcanza a barrerlo todo, manana sigue
   * por donde quedo). Segunda consulta para las rutas de las ordenes del lote: se filtra por
   * `carga_id IN (...)` y por ruta no nula, y NO por `deleted_at` (R9: los PDF de las ordenes
   * borradas ocupan el mismo bucket).
   */
  async findCargasPurgables(corte: Date, limite: number): Promise<CargaPurgable[]> {
    const cargas = await this.prisma.carga.findMany({
      where: whereCandidatas(corte),
      orderBy: { createdAt: "asc" }, // R5/§2.1: lo mas viejo primero
      take: limite, // R21: tope por corrida, resuelto por el service
      select: { id: true, downloadStoragePath: true },
    });
    if (cargas.length === 0) return [];

    const cargaIds = cargas.map((c) => c.id);
    const ordenes = await this.prisma.orden.findMany({
      // R9: SIN `deletedAt` en el where — las ordenes borradas entran en la unidad de purga.
      where: { cargaId: { in: cargaIds }, downloadStoragePath: { not: null } },
      select: { cargaId: true, downloadStoragePath: true },
    });

    const porCarga = new Map<string, string[]>(cargaIds.map((id) => [id, []]));
    for (const o of ordenes) {
      // `cargaId` es nullable en el modelo, pero el filtro `in` garantiza que aqui no es null;
      // la guarda evita el non-null assertion (R17: las ordenes sin lote quedan fuera).
      if (o.cargaId === null || o.downloadStoragePath === null) continue;
      porCarga.get(o.cargaId)?.push(o.downloadStoragePath);
    }

    return cargas.map((c) => ({
      cargaId: c.id,
      cargaPath: c.downloadStoragePath,
      ordenPaths: porCarga.get(c.id) ?? [],
    }));
  }

  /**
   * R22: mismo `where` que la seleccion, saltando las `limite` ya devueltas y pidiendo UNA. Se
   * usa `findFirst` con `skip` en vez de un `count` total porque el coste no depende del tamaño
   * del backlog: en cuanto encuentra la fila `limite + 1` para.
   */
  async quedanCargasPurgables(corte: Date, limite: number): Promise<boolean> {
    const siguiente = await this.prisma.carga.findFirst({
      where: whereCandidatas(corte),
      orderBy: { createdAt: "asc" }, // mismo orden que la seleccion: "mas alla del tope"
      skip: limite,
      take: 1,
      select: { id: true },
    });
    return siguiente !== null;
  }

  /**
   * R13/R14/R15/R9: UNA transaccion por carga. `updateMany` sobre TODAS las ordenes del lote
   * (sin `deletedAt` en el `where`, R9) y `update` sobre la carga. El `data` de ambos lleva
   * EXACTAMENTE las dos columnas testigo a NULL y nada mas (R15); no se borra ninguna fila
   * (alternativa B descartada: `orden.carga_id` es FK `Restrict`).
   */
  async limpiarReferencias(cargaId: string): Promise<{ ordenesActualizadas: number }> {
    return this.prisma.$transaction(async (tx) => {
      const ordenes = await tx.orden.updateMany({
        where: { cargaId }, // R9: sin `deletedAt`
        data: { downloadUrl: null, downloadStoragePath: null }, // R14/R15
      });
      await tx.carga.update({
        where: { id: cargaId },
        data: { downloadUrl: null, downloadStoragePath: null }, // R13/R15
      });
      return { ordenesActualizadas: ordenes.count };
    });
  }
}
