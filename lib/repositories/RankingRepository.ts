import type { PrismaClient } from "@prisma/client";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { ConteoPorMensajero } from "@/lib/types/ranking";

// Feature 76 (design §3) — repositorio de agregacion del ranking DIARIO. SOLO queries Prisma
// (dos groupBy); sin logica de negocio ni `Date.now()`: el rango del dia (CR) llega ya
// calculado por el service (`desde`/`hasta`, half-open [desde, hasta)). Cliente acotado a lo
// que necesita (patron GastoFijoPlantillaRepository).
type RankingPrismaClient = Pick<PrismaClient, "gestionOrden" | "orden">;

export class RankingRepository implements IRankingRepository {
  constructor(private readonly prisma: RankingPrismaClient) {}

  /** R1: entregas exitosas VIGENTES de HOY(CR) por mensajero (numerador). */
  async contarEntregadasPorMensajero(desde: Date, hasta: Date): Promise<ConteoPorMensajero[]> {
    const rows = await this.prisma.gestionOrden.groupBy({
      by: ["mensajeroId"],
      where: {
        resultado: "entregada", // solo entregas exitosas
        anuladaAt: null, // feature 67: solo gestiones VIGENTES (no intentos deshechos)
        createdAt: { gte: desde, lt: hasta }, // HOY(CR), half-open
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({ mensajeroId: r.mensajeroId, total: r._count._all }));
  }

  /** R1: ordenes ASIGNADAS HOY(CR) por mensajero actualmente asignado (denominador). */
  async contarAsignadasPorMensajero(desde: Date, hasta: Date): Promise<ConteoPorMensajero[]> {
    const rows = await this.prisma.orden.groupBy({
      by: ["mensajeroAsignadoId"],
      where: {
        mensajeroAsignadoId: { not: null },
        asignadoAt: { gte: desde, lt: hasta }, // HOY(CR), half-open
      },
      _count: { _all: true },
    });
    // El `where` garantiza `mensajeroAsignadoId` no nulo; el filtro descarta el caso null
    // residual sin afectar el conteo y satisface al tipado.
    return rows.flatMap((r) =>
      r.mensajeroAsignadoId === null
        ? []
        : [{ mensajeroId: r.mensajeroAsignadoId, total: r._count._all }],
    );
  }
}
