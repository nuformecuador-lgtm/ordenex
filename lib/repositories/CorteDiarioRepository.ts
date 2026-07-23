import { type PrismaClient } from "@prisma/client";
import type {
  ICorteDiarioRepository,
  MensajeroSinCierreRow,
} from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type { CierreEstado } from "@/lib/types/cierre";

// Feature 41 + feature 109 (R10/R29, modelo GLOBAL): estados de cierre ABIERTOS que EXCLUYEN del
// corte. Un mensajero con un cierre en cualquiera de estos ya tiene un cierre bloqueante: no se le
// crea un 2.º (invariante R30). `aprobado` es el UNICO terminal. `rechazado` deja de ser terminal
// (109): ahora bloquea y es re-solicitable, igual que `vencido`.
const ESTADOS_CIERRE_ABIERTOS: CierreEstado[] = ["solicitado", "vencido", "rechazado"];

// Feature 109 (R4): estado de una orden que el corte transiciona a `sin_gestionar` (mensajero que
// no gestiono ni recogio de vuelta antes del corte del dia).
const ESTADO_EN_REPARTO = "en_reparto";

type CortePrismaClient = Pick<PrismaClient, "gestionOrden" | "orden" | "cierreDia">;

/**
 * Feature 41 — repositorio del corte diario. SOLO queries Prisma (sin logica de
 * negocio: quien recibe un `vencido` lo decide el service). Money-safe: no calcula
 * totales aqui (eso lo hace el service con los helpers de snapshot).
 */
export class CorteDiarioRepository implements ICorteDiarioRepository {
  constructor(private readonly prisma: CortePrismaClient) {}

  /**
   * R7/R10 + feature 109 (R4/R10/R29): mensajeros DISTINCT a evaluar en el corte = UNION de
   * (a) los que tienen `gestion_orden.cierre_id IS NULL AND anulada_at IS NULL` (actividad del dia
   * sin cerrar, comportamiento 41/67) y (b) los que tienen >=1 `orden` en `en_reparto` no borrada
   * (mensajero inactivo que dejo ordenes sin gestionar, nuevo en 109) — a estas ultimas el corte
   * las llevara a `sin_gestionar`. Se RESTAN (R10/R29) los que ya tienen un cierre ABIERTO
   * (`estado IN ('solicitado','vencido','rechazado')`), para no crear un 2.º cierre bloqueante ni
   * violar el invariante generalizado (R30). Devuelve `zonaId` (usuario.zona_id) para derivar el
   * destino (R1). Solo queries (sin logica de negocio).
   */
  async findMensajerosConActividadSinCierre(): Promise<MensajeroSinCierreRow[]> {
    // (a) actividad del dia aun sin cerrar. Feature 67/R17: una gestion ANULADA NO cuenta.
    const pendientes = await this.prisma.gestionOrden.findMany({
      where: { cierreId: null, anuladaAt: null },
      distinct: ["mensajeroId"],
      select: { mensajeroId: true, mensajero: { select: { zonaId: true } } },
    });

    // (b) feature 109/R4: mensajeros con ordenes que siguen en `en_reparto` al pasar de dia.
    const enReparto = await this.prisma.orden.findMany({
      where: {
        deletedAt: null,
        estatus: { value: ESTADO_EN_REPARTO },
        mensajeroAsignadoId: { not: null },
      },
      distinct: ["mensajeroAsignadoId"],
      select: { mensajeroAsignadoId: true, mensajeroAsignado: { select: { zonaId: true } } },
    });

    // UNION por mensajeroId, conservando su zona (fuente de verdad viva: usuario.zona_id).
    const byMensajero = new Map<string, string | null>();
    for (const p of pendientes) byMensajero.set(p.mensajeroId, p.mensajero.zonaId);
    for (const o of enReparto) {
      if (o.mensajeroAsignadoId === null) continue; // el WHERE ya lo excluye; guarda de tipos
      if (!byMensajero.has(o.mensajeroAsignadoId)) {
        byMensajero.set(o.mensajeroAsignadoId, o.mensajeroAsignado?.zonaId ?? null);
      }
    }
    if (byMensajero.size === 0) return [];

    // R10/R29: excluye a los que ya tienen un cierre ABIERTO (los 3 estados bloqueantes).
    const ids = [...byMensajero.keys()];
    const conCierreAbierto = await this.prisma.cierreDia.findMany({
      where: { mensajeroId: { in: ids }, estado: { in: ESTADOS_CIERRE_ABIERTOS } },
      select: { mensajeroId: true },
      distinct: ["mensajeroId"],
    });
    const bloqueados = new Set(conCierreAbierto.map((c) => c.mensajeroId));

    return ids
      .filter((mensajeroId) => !bloqueados.has(mensajeroId))
      .map((mensajeroId) => ({ mensajeroId, zonaId: byMensajero.get(mensajeroId) ?? null }));
  }
}
