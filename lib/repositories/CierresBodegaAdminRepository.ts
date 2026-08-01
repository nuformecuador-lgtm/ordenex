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
// Feature 69/T23 (R15): se reusan las MISMAS piezas que compone T18 en `CierresAdminRepository`
// (proyeccion + mapper), no una copia: las dos pantallas de admin muestran el detalle del mismo
// cierre_dia ya creado y tienen que salir del mismo sitio o divergen.
import {
  DETALLE_ADMIN_SELECT,
  GESTION_ADMIN_SELECT,
  toPendienteRowDesdeSnapshot,
} from "@/lib/repositories/CierresAdminRepository";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Solo el estado que la 40 puede transicionar (R18): la guardia del updateMany.
const ESTADO_SOLICITADO = "solicitado";

// Feature 69/T23: el detalle sale del SNAPSHOT -> el cliente necesita `cierreDetail`.
type CierresBodegaAdminPrismaClient = Pick<
  PrismaClient,
  "cierreBodega" | "cierreDia" | "gestionOrden" | "cierreDetail"
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
 * toBodegaResumenRow (cabecera). `resolverCierreBodega` es un unico UPDATE guardado por
 * estado; NO toca cierre_dia ni otra tabla (R21/R22).
 *
 * Feature 69/T23 (R15): el detalle de las gestiones ya NO reusa WITH_DETALLE / toPendienteRow
 * de la 37 (que leen la orden VIVA y siguen siendo correctos para la vista EN VIVO de
 * gestiones sin cierre); sale del SNAPSHOT `cierre_detail` con las mismas piezas que T18.
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

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina del HISTORICO + el total.
   *
   * El `where` se construye UNA vez y lo comparten `findMany` y `count`: escribirlo dos veces
   * es como el total acaba contando un conjunto distinto del que se muestra.
   */
  async findHistoricoPaginado(
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    // R44: `notIn` es el espejo EXACTO del `else` del servicio. Con un
    // `in: ["aprobado","rechazado"]`, un `vencido` desapareceria de las dos listas.
    const where = { estado: { notIn: [...ESTADOS_COLA_SOLICITADO] } };
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

  /** R11 (+69/R15): cierre de bodega + cada cierre_dia con sus gestiones desde el SNAPSHOT. */
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

    // Por cada cierre_dia, sus gestiones (WHERE cierre_id = cierre_dia.id) compuestas con el
    // SNAPSHOT de ese cierre. Feature 69/T23 (R15): un cierre_dia consolidado en un
    // cierre_bodega esta YA CREADO (y normalmente ya aprobado y liquidado), asi que su detalle
    // son los datos CONGELADOS. Antes esto reusaba `WITH_DETALLE`, que navegaba
    // `gestion_orden.orden.*` VIVO: esta pantalla y la de `findCierreByIdEnAlcance` mostraban
    // detalle distinto del MISMO cierre. Mismo DTO que antes -> la UI no cambia.
    const cierresDia = await Promise.all(
      cierresDiaRows.map(async (cd) => {
        const [gestiones, detalle] = await Promise.all([
          this.prisma.gestionOrden.findMany({
            where: { cierreId: cd.id }, // R11: gestiones vinculadas a ESTE cierre_dia
            orderBy: { createdAt: "desc" },
            select: GESTION_ADMIN_SELECT,
          }),
          this.prisma.cierreDetail.findMany({
            where: { cierreId: cd.id }, // el snapshot de ESE cierre_dia
            select: DETALLE_ADMIN_SELECT,
          }),
        ]);
        // Grano: N gestiones de una orden comparten su UNICA fila congelada.
        const byOrden = new Map(detalle.map((d) => [d.ordenId, d]));
        return {
          resumen: toDetalleCierreRow(cd),
          // Sin fallback (R14/decision (a)): si falta la fila, error DURO. Igual que T18: un
          // fallback a datos vivos seria el camino de lectura que esta feature vino a matar.
          gestiones: gestiones.map((g) => {
            const d = byOrden.get(g.ordenId);
            if (d === undefined) throw new CierreDetalleFaltanteError(cd.id, g.ordenId);
            return toPendienteRowDesdeSnapshot(g, d);
          }),
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
