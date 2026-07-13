import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CierreBodegaDetalleCierreRow,
  ICierresBodegaAdminRepository,
  ResolverCierreBodegaInput,
  ResolverCierreBodegaResult,
} from "@/lib/interfaces/repositories/ICierresBodegaAdminRepository";
import type { CierreBodegaResumenRow } from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import {
  BODEGA_RESUMEN_SELECT,
  toBodegaResumenRow,
} from "@/lib/repositories/CierreBodegaRepository";
import { WITH_DETALLE, toPendienteRow } from "@/lib/repositories/CierreDiaRepository";

// Solo el estado que la 40 puede transicionar (R18): la guardia del updateMany.
const ESTADO_SOLICITADO = "solicitado";

type CierresBodegaAdminPrismaClient = Pick<
  PrismaClient,
  "cierreBodega" | "cierreDia" | "gestionOrden"
>;

// Proyeccion de la cabecera de un cierre_dia incluido en el detalle (mensajero +
// totales snapshot).
const DETALLE_CIERRE_SELECT = {
  id: true,
  mensajeroId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R20: snapshot del pago al mensajero del cierre_dia
  totalIngresoBodegaRechazos: true, // feature 56/R19: snapshot del ingreso de bodega por rechazos del cierre_dia
  mensajero: { select: { nombre: true } },
} as const;

type DetalleCierreRow = Prisma.CierreDiaGetPayload<{ select: typeof DETALLE_CIERRE_SELECT }>;

function toDetalleCierreRow(r: DetalleCierreRow): CierreBodegaDetalleCierreRow {
  return {
    cierreDiaId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: r.mensajero.nombre,
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R20: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R19: snapshot money-safe STRING
  };
}

/**
 * Feature 40 — repositorio de "Cierres de bodega" del maestro. SOLO queries Prisma. El
 * maestro NO se acota por zona (todo va a la central). Reusa BODEGA_RESUMEN_SELECT /
 * toBodegaResumenRow (cabecera) y WITH_DETALLE / toPendienteRow de la 37 (gestiones).
 * `resolverCierreBodega` es un unico UPDATE guardado por estado; NO toca cierre_dia ni
 * otra tabla (R21/R22).
 */
export class CierresBodegaAdminRepository implements ICierresBodegaAdminRepository {
  constructor(private readonly prisma: CierresBodegaAdminPrismaClient) {}

  /** R15: todos los cierres de bodega, mas reciente primero, totales -> STRING. */
  async findCierresBodega(): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      orderBy: { solicitadoAt: "desc" },
      select: BODEGA_RESUMEN_SELECT,
    });
    return rows.map(toBodegaResumenRow);
  }

  /** R11: cierre de bodega + cada cierre_dia con sus gestiones (WITH_DETALLE, reuso 37). */
  async findCierreBodegaConDetalle(id: string): Promise<{
    cierre: CierreBodegaResumenRow;
    cierresDia: {
      resumen: CierreBodegaDetalleCierreRow;
      gestiones: CierreGestionPendienteRow[];
    }[];
  } | null> {
    const cierre = await this.prisma.cierreBodega.findUnique({
      where: { id },
      select: BODEGA_RESUMEN_SELECT,
    });
    if (cierre === null) return null; // R19: no existe

    // Los cierre_dia incluidos (WHERE cierre_bodega_id = id), mas reciente primero.
    const cierresDiaRows = await this.prisma.cierreDia.findMany({
      where: { cierreBodegaId: id },
      orderBy: { solicitadoAt: "desc" },
      select: DETALLE_CIERRE_SELECT,
    });

    // Por cada cierre_dia, sus gestiones (WHERE cierre_id = cierre_dia.id).
    const cierresDia = await Promise.all(
      cierresDiaRows.map(async (cd) => {
        const gestiones = await this.prisma.gestionOrden.findMany({
          where: { cierreId: cd.id }, // R11: gestiones vinculadas a ESTE cierre_dia
          orderBy: { createdAt: "desc" },
          ...WITH_DETALLE,
        });
        return {
          resumen: toDetalleCierreRow(cd),
          gestiones: gestiones.map(toPendienteRow),
        };
      }),
    );

    return { cierre: toBodegaResumenRow(cierre), cierresDia };
  }

  /** R16-R22: transicion atomica guardada; un solo UPDATE, no toca otras tablas. */
  async resolverCierreBodega(
    input: ResolverCierreBodegaInput,
  ): Promise<ResolverCierreBodegaResult> {
    const { id, nuevoEstado, resueltoPor, motivoRechazo } = input;

    // R18: aplica SOLO si sigue `solicitado` (guardia de estado en el WHERE).
    const res = await this.prisma.cierreBodega.updateMany({
      where: { id, estado: ESTADO_SOLICITADO },
      data: {
        estado: nuevoEstado,
        resueltoPor, // R20
        resueltoAt: new Date(), // R20
        motivoRechazo,
      },
    });
    if (res.count === 1) return "updated";

    // count 0: distinguir "ya resuelto" (existe) de "no existe".
    const existe = await this.prisma.cierreBodega.count({ where: { id } });
    return existe > 0 ? "conflict" : "fuera_de_alcance"; // R18 vs R19
  }
}
