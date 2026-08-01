import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CierreBodegaResumenRow,
  CierreDiaConsolidableRow,
  CrearCierreBodegaInput,
  ICierreBodegaRepository,
} from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Estados/destino relevantes (fuente de verdad en lib/types/cierre.ts). El cierre de
// bodega se crea SIEMPRE en `solicitado`; consolida SOLO cierre_dia `aprobado`.
const ESTADO_SOLICITADO = "solicitado";
const ESTADO_APROBADO = "aprobado";
const DESTINO_SATELITE = "bodega_satelite";

type CierreBodegaPrismaClient = Pick<PrismaClient, "cierreDia" | "cierreBodega" | "$transaction">;

// Money-safe: Decimal -> string escala 2 (nunca number/parseFloat).
function totalesToString(r: {
  totalEfectivo: Prisma.Decimal;
  totalSimpe: Prisma.Decimal;
  totalTransferencia: Prisma.Decimal;
  totalGeneral: Prisma.Decimal;
}) {
  return {
    efectivo: r.totalEfectivo.toFixed(2),
    simpe: r.totalSimpe.toFixed(2),
    transferencia: r.totalTransferencia.toFixed(2),
    general: r.totalGeneral.toFixed(2),
  };
}

// Proyeccion de la cabecera de un cierre_dia consolidable (mensajero + totales).
const CONSOLIDABLE_SELECT = {
  id: true,
  mensajeroId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R18: snapshot del pago al mensajero del cierre_dia
  totalIngresoBodegaRechazos: true, // feature 56/R17: snapshot del ingreso de bodega por rechazos del cierre_dia
  mensajero: { select: { nombre: true } },
} as const;

// Proyeccion de la cabecera de un cierre de bodega (join a zona/usuario + _count).
// Exportada para reuso por CierresBodegaAdminRepository (lado maestro): mismo mapper,
// distinto WHERE (todos vs por zona).
export const BODEGA_RESUMEN_SELECT = {
  id: true,
  zonaId: true,
  solicitadoPor: true,
  estado: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R19/R20: snapshot agregado del pago a mensajeros
  totalIngresoBodegaRechazos: true, // feature 56/R18/R19: snapshot agregado del ingreso de bodega por rechazos
  solicitadoAt: true,
  resueltoAt: true,
  motivoRechazo: true,
  zona: { select: { nombre: true } },
  solicitadoPorUsuario: { select: { nombre: true } },
  _count: { select: { cierresDia: true } },
} as const;

type BodegaResumenRow = Prisma.CierreBodegaGetPayload<{ select: typeof BODEGA_RESUMEN_SELECT }>;

// Mapper cabecera cruda -> fila de dominio (totales STRING, fechas ISO). Exportado
// para reuso por CierresBodegaAdminRepository.
export function toBodegaResumenRow(r: BodegaResumenRow): CierreBodegaResumenRow {
  return {
    cierreBodegaId: r.id,
    zonaId: r.zonaId,
    zonaNombre: r.zona.nombre,
    solicitadoPorId: r.solicitadoPor,
    solicitadoPorNombre: r.solicitadoPorUsuario.nombre,
    estado: r.estado,
    totales: totalesToString(r),
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R19/R20: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R18/R19: snapshot money-safe STRING
    cantidadCierres: r._count.cierresDia,
    solicitadoAt: r.solicitadoAt.toISOString(),
    resueltoAt: r.resueltoAt ? r.resueltoAt.toISOString() : null,
    motivoRechazo: r.motivoRechazo,
  };
}

/**
 * Feature 40 — repositorio del "Cierre de bodega" (lado adminSatelite). SOLO queries
 * Prisma. El alcance (zona/estado) va SIEMPRE en el WHERE (R3/R5/R6), nunca en memoria.
 * `crearCierreBodega` es transaccional (INSERT + link atomico, R9/R10) con guardia de
 * concurrencia en el updateMany; una violacion del indice unico parcial (P2002) se
 * PROPAGA para que el service la traduzca a `conflict` (R8).
 */
export class CierreBodegaRepository implements ICierreBodegaRepository {
  constructor(private readonly prisma: CierreBodegaPrismaClient) {}

  /** R5: cierre_dia aprobados de la zona, destino satelite, sin cierre de bodega. */
  async findCierresDiaConsolidables(zonaId: string): Promise<CierreDiaConsolidableRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: {
        estado: ESTADO_APROBADO, // R5: solo aprobados aportan dinero cuadrado
        destinoTipo: DESTINO_SATELITE, // R5: destino bodega satelite
        destinoZonaId: zonaId, // R3/R5: acotado a SU zona (en el WHERE)
        cierreBodegaId: null, // R5: aun no consolidados
      },
      orderBy: { solicitadoAt: "desc" },
      select: CONSOLIDABLE_SELECT,
    });
    return rows.map((r) => ({
      cierreDiaId: r.id,
      mensajeroId: r.mensajeroId,
      mensajeroNombre: r.mensajero.nombre,
      totales: totalesToString(r),
      totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R18: snapshot money-safe STRING
      totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R17: snapshot money-safe STRING
    }));
  }

  /** R6: cierre_dia de la zona aun `solicitado` (sin resolver por el adminSatelite). */
  async contarCierresDiaSolicitados(zonaId: string): Promise<number> {
    return this.prisma.cierreDia.count({
      where: {
        destinoTipo: DESTINO_SATELITE,
        destinoZonaId: zonaId,
        estado: ESTADO_SOLICITADO,
      },
    });
  }

  /** R8: existe un CierreBodega de la zona en estado `solicitado`. */
  async existeCierreBodegaSolicitado(zonaId: string): Promise<boolean> {
    const count = await this.prisma.cierreBodega.count({
      where: { zonaId, estado: ESTADO_SOLICITADO },
    });
    return count > 0;
  }

  /** R9/R10: INSERT cierre_bodega (snapshot Decimal) + vincular cierre_dia, atomico. */
  async crearCierreBodega(input: CrearCierreBodegaInput): Promise<string> {
    const { zonaId, solicitadoPor, cierreDiaIds, totales, totalPagoMensajero, totalIngresoBodegaRechazos } =
      input;
    return this.prisma.$transaction(async (tx) => {
      const cierre = await tx.cierreBodega.create({
        data: {
          zonaId,
          solicitadoPor,
          estado: ESTADO_SOLICITADO,
          totalEfectivo: new Prisma.Decimal(totales.efectivo),
          totalSimpe: new Prisma.Decimal(totales.simpe),
          totalTransferencia: new Prisma.Decimal(totales.transferencia),
          totalGeneral: new Prisma.Decimal(totales.general),
          // Feature 39/R19: snapshot agregado del pago a mensajeros, en la misma tx.
          totalPagoMensajero: new Prisma.Decimal(totalPagoMensajero),
          // Feature 56/R18: snapshot agregado del ingreso de bodega por rechazos, en la misma tx.
          totalIngresoBodegaRechazos: new Prisma.Decimal(totalIngresoBodegaRechazos),
        },
        select: { id: true },
      });
      // R9: vincula SOLO los cierre_dia consolidables de la zona (guardia de propiedad
      // + no-consolidados + aprobados en el WHERE; concurrencia-segura).
      await tx.cierreDia.updateMany({
        where: {
          id: { in: cierreDiaIds },
          cierreBodegaId: null,
          estado: ESTADO_APROBADO,
          destinoZonaId: zonaId,
        },
        data: { cierreBodegaId: cierre.id },
      });
      return cierre.id;
    });
  }

  /** F1.4-h: historico propio de la zona, mas reciente primero, totales -> STRING. */
  async findCierresBodegaByZona(zonaId: string): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: { zonaId },
      orderBy: { solicitadoAt: "desc" },
      select: BODEGA_RESUMEN_SELECT,
    });
    return rows.map(toBodegaResumenRow);
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina de los cierres de bodega de
   * la zona + el total.
   *
   * El `where` con el acotamiento por zona se construye UNA vez y lo comparten `findMany` y
   * `count`. Que el `zonaId` sea el MISMO objeto en las dos consultas no es cosmetico: es lo
   * que impide que el total cuente los cierres de toda la operacion mientras la pagina muestra
   * los de una bodega.
   */
  async findCierresBodegaByZonaPaginado(
    zonaId: string,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    const where = { zonaId }; // R3: el alcance por zona, en el WHERE y nunca en memoria
    const [rows, total] = await Promise.all([
      this.prisma.cierreBodega.findMany({
        where,
        orderBy: { solicitadoAt: "desc" }, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: BODEGA_RESUMEN_SELECT,
      }),
      this.prisma.cierreBodega.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toBodegaResumenRow), total };
  }
}
