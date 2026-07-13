import { type PrismaClient } from "@prisma/client";
import type {
  ICorteDiarioRepository,
  MensajeroSinCierreRow,
} from "@/lib/interfaces/repositories/ICorteDiarioRepository";

// Estado bloqueante que EXCLUYE del corte (R10): un mensajero con un cierre `solicitado`
// pendiente ya cumplio la obligatoriedad, no se le crea un `vencido`.
const ESTADO_SOLICITADO = "solicitado";

type CortePrismaClient = Pick<PrismaClient, "gestionOrden" | "cierreDia">;

/**
 * Feature 41 — repositorio del corte diario. SOLO queries Prisma (sin logica de
 * negocio: quien recibe un `vencido` lo decide el service). Money-safe: no calcula
 * totales aqui (eso lo hace el service con los helpers de snapshot).
 */
export class CorteDiarioRepository implements ICorteDiarioRepository {
  constructor(private readonly prisma: CortePrismaClient) {}

  /**
   * R7/R10: mensajeros DISTINCT con `gestion_orden.cierre_id IS NULL` + su zona, menos
   * los que tienen un cierre `solicitado` pendiente. Dos queries (sin logica de negocio,
   * solo el filtro): (1) mensajeros con actividad pendiente + zona; (2) cuales tienen un
   * `solicitado` -> se restan del set.
   */
  async findMensajerosConActividadSinCierre(): Promise<MensajeroSinCierreRow[]> {
    const pendientes = await this.prisma.gestionOrden.findMany({
      where: { cierreId: null }, // R7: actividad del dia aun sin cerrar
      distinct: ["mensajeroId"],
      select: { mensajeroId: true, mensajero: { select: { zonaId: true } } },
    });
    if (pendientes.length === 0) return [];

    const ids = pendientes.map((p) => p.mensajeroId);
    const conSolicitado = await this.prisma.cierreDia.findMany({
      where: { mensajeroId: { in: ids }, estado: ESTADO_SOLICITADO }, // R10
      select: { mensajeroId: true },
    });
    const bloqueados = new Set(conSolicitado.map((c) => c.mensajeroId));

    return pendientes
      .filter((p) => !bloqueados.has(p.mensajeroId)) // R10: excluye los que ya solicitaron
      .map((p) => ({ mensajeroId: p.mensajeroId, zonaId: p.mensajero.zonaId }));
  }
}
