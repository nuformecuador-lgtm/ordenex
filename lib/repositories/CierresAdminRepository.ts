import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
  ResolverCierreInput,
  ResolverCierreResult,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import { WITH_DETALLE, toPendienteRow } from "@/lib/repositories/CierreDiaRepository";

// Solo el estado que la 38 puede transicionar (R12): la guardia del updateMany.
const ESTADO_SOLICITADO = "solicitado";

type CierresAdminPrismaClient = Pick<PrismaClient, "cierreDia" | "gestionOrden">;

// Proyeccion de la cabecera de un cierre (join a mensajero/zona para nombres).
const CIERRE_RESUMEN_SELECT = {
  id: true,
  mensajeroId: true,
  estado: true,
  destinoTipo: true,
  destinoZonaId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R17: snapshot total del pago al mensajero
  solicitadoAt: true,
  resueltoAt: true,
  motivoRechazo: true,
  mensajero: { select: { nombre: true } },
  destinoZona: { select: { nombre: true } },
} as const;

type CierreResumenRow = Prisma.CierreDiaGetPayload<{ select: typeof CIERRE_RESUMEN_SELECT }>;

function toResumenRow(r: CierreResumenRow): CierreAdminResumenRow {
  return {
    cierreId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: r.mensajero.nombre,
    estado: r.estado,
    destinoTipo: r.destinoTipo,
    destinoZonaId: r.destinoZonaId,
    destinoZonaNombre: r.destinoZona.nombre,
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R17: snapshot money-safe STRING
    solicitadoAt: r.solicitadoAt.toISOString(),
    resueltoAt: r.resueltoAt ? r.resueltoAt.toISOString() : null,
    motivoRechazo: r.motivoRechazo,
  };
}

// WHERE del alcance: siempre por destino_tipo; por destino_zona_id SOLO si el alcance
// lo acota (adminSatelite). El maestro (destinoZonaId null) ve todos los central.
function alcanceWhere(alcance: Alcance): { destinoTipo: Alcance["destinoTipo"]; destinoZonaId?: string } {
  return {
    destinoTipo: alcance.destinoTipo,
    ...(alcance.destinoZonaId !== null ? { destinoZonaId: alcance.destinoZonaId } : {}),
  };
}

/**
 * Feature 38 — repositorio de "Cierres del dia" del admin. SOLO queries Prisma. El
 * ALCANCE (rol+zona destino) va SIEMPRE en el WHERE (R2/R13), nunca en memoria. Reusa
 * WITH_DETALLE / toPendienteRow de la feature 37 para el detalle de gestiones.
 */
export class CierresAdminRepository implements ICierresAdminRepository {
  constructor(private readonly prisma: CierresAdminPrismaClient) {}

  /** R2/R4/R5/R8/R9: cierres del alcance, mas reciente primero, totales -> string. */
  async findCierresByAlcance(alcance: Alcance): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: alcanceWhere(alcance), // R2/R13: filtro por alcance en el WHERE, usa el indice [destinoTipo, destinoZonaId]
      orderBy: { solicitadoAt: "desc" },
      select: CIERRE_RESUMEN_SELECT,
    });
    return rows.map(toResumenRow);
  }

  /** R6/R7/R9/R13: cierre (solo si casa el alcance) + sus gestiones (WITH_DETALLE). */
  async findCierreByIdEnAlcance(
    cierreId: string,
    alcance: Alcance,
  ): Promise<{ cierre: CierreAdminResumenRow; gestiones: CierreGestionPendienteRow[] } | null> {
    const cierre = await this.prisma.cierreDia.findFirst({
      where: { id: cierreId, ...alcanceWhere(alcance) }, // R13: guardia de alcance en el WHERE
      select: CIERRE_RESUMEN_SELECT,
    });
    if (cierre === null) return null; // R13: no existe o de otra bodega/zona (no se distingue)

    const gestiones = await this.prisma.gestionOrden.findMany({
      where: { cierreId }, // R6: gestiones vinculadas a ESTE cierre
      orderBy: { createdAt: "desc" },
      ...WITH_DETALLE,
    });
    return { cierre: toResumenRow(cierre), gestiones: gestiones.map(toPendienteRow) };
  }

  /** R10-R15: transicion atomica guardada; un solo statement, no toca otras tablas. */
  async resolverCierre(input: ResolverCierreInput): Promise<ResolverCierreResult> {
    const { cierreId, alcance, nuevoEstado, resueltoPor, motivoRechazo } = input;
    const alcanceGuard = alcanceWhere(alcance);

    // R12/R13: aplica SOLO si sigue `solicitado` Y casa el alcance (guardia en WHERE).
    const res = await this.prisma.cierreDia.updateMany({
      where: { id: cierreId, estado: ESTADO_SOLICITADO, ...alcanceGuard },
      data: {
        estado: nuevoEstado,
        resueltoPor,
        resueltoAt: new Date(),
        motivoRechazo,
      },
    });
    if (res.count === 1) return "updated";

    // count 0: distinguir "ya resuelto" (existe en alcance) de "fuera de alcance".
    const enAlcance = await this.prisma.cierreDia.count({
      where: { id: cierreId, ...alcanceGuard },
    });
    return enAlcance > 0 ? "conflict" : "fuera_de_alcance"; // R12 vs R13
  }
}
