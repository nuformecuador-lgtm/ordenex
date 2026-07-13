import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  Alcance,
  CierreAdminResumenRow,
  ICierresAdminRepository,
  ResolverCierreInput,
  ResolverCierreResult,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type { CierreEstado } from "@/lib/types/cierre";
import { WITH_DETALLE, toPendienteRow } from "@/lib/repositories/CierreDiaRepository";

// Estados de ORIGEN que la resolucion puede transicionar (R12). Feature 41/E1 (R19):
// ademas de `solicitado`, un `vencido` (creado por el corte diario) es resoluble por la
// bodega responsable reusando la auditoria existente; resolverlo desbloquea (R15). Los
// totales NO se recalculan (R4).
const ESTADOS_RESOLUBLES: CierreEstado[] = ["solicitado", "vencido"];

// Feature 42/T8: la resolucion del cierre ahora orquesta una transaccion (para alimentar
// la wallet atomicamente al aprobar, R5/R7) -> el cliente necesita `$transaction`.
type CierresAdminPrismaClient = Pick<PrismaClient, "cierreDia" | "gestionOrden" | "$transaction">;

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
  totalIngresoBodegaRechazos: true, // feature 56/R16: snapshot total del ingreso de bodega por rechazos
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
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R16: snapshot money-safe STRING
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
  constructor(
    private readonly prisma: CierresAdminPrismaClient,
    // Feature 42/T8: dependencias del enganche a la wallet (por inyeccion, no logica en el
    // repo: el repo orquesta la tx, el feed construye los movimientos, el repo de wallet
    // los inserta idempotentemente).
    private readonly walletMovimientoRepo: IWalletMovimientoRepository,
    private readonly walletFeedService: IWalletFeedService,
    // Feature 43/T10: enganche al LEDGER por tienda (por inyeccion, misma tx). El feed
    // construye los movimientos por tienda (credito COD + debitos por concepto) y el repo de
    // tienda los inserta idempotentemente EN LA MISMA tx que la 42 (atomico, R5/R7/R12/R13).
    private readonly walletTiendaMovimientoRepo: IWalletTiendaMovimientoRepository,
    private readonly walletTiendaFeedService: IWalletTiendaFeedService,
  ) {}

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

  /**
   * R10-R15 + feature 42/T8 (R5/R7): transicion atomica guardada. Envuelta en
   * `$transaction`: mantiene el `updateMany` guardado (estado resoluble + alcance) y, SOLO
   * si la aprobacion se aplico (count===1 Y nuevoEstado==='aprobado'), alimenta la wallet
   * con los movimientos de ingreso del cierre en la MISMA tx (atomico: si el insert falla,
   * la aprobacion hace rollback). La alimentacion es IDEMPOTENTE (skipDuplicates -> ON
   * CONFLICT DO NOTHING, R6/R13): re-aprobar o un vencido->aprobado no duplica (R12). Un
   * `rechazado` NO alimenta. La distincion count===0 (conflict vs fuera_de_alcance) queda
   * igual.
   */
  async resolverCierre(input: ResolverCierreInput): Promise<ResolverCierreResult> {
    const { cierreId, alcance, nuevoEstado, resueltoPor, motivoRechazo } = input;
    const alcanceGuard = alcanceWhere(alcance);

    const count = await this.prisma.$transaction(async (tx) => {
      // R12/R13 + feature 41/E1 (R19): aplica SOLO si sigue en un estado resoluble
      // (`solicitado` o `vencido`) Y casa el alcance (guardia en WHERE).
      const res = await tx.cierreDia.updateMany({
        where: { id: cierreId, estado: { in: ESTADOS_RESOLUBLES }, ...alcanceGuard },
        data: {
          estado: nuevoEstado,
          resueltoPor,
          resueltoAt: new Date(),
          motivoRechazo,
        },
      });

      // R5/R7: solo al APROBAR y si se aplico, construir e insertar los movimientos de
      // ingreso EN LA MISMA TX (todo-o-nada). `rechazado` no toca la wallet.
      if (res.count === 1 && nuevoEstado === "aprobado") {
        const movs = await this.walletFeedService.construirMovimientosDeIngreso(cierreId, tx);
        await this.walletMovimientoRepo.crearMovimientos(tx, movs); // R6/R13: idempotente
        // Feature 43/T10 (R5/R7/R12/R13): TRAS alimentar la 42, alimenta el LEDGER por tienda
        // en la MISMA tx (todo-o-nada: si falla, rollback de la aprobacion Y de la 42).
        const movsTienda = await this.walletTiendaFeedService.construirMovimientosPorTienda(
          cierreId,
          tx,
        );
        await this.walletTiendaMovimientoRepo.crearMovimientos(tx, movsTienda); // R6/R13: idempotente
      }
      return res.count;
    });

    if (count === 1) return "updated";

    // count 0: distinguir "ya resuelto" (existe en alcance) de "fuera de alcance".
    const enAlcance = await this.prisma.cierreDia.count({
      where: { id: cierreId, ...alcanceGuard },
    });
    return enAlcance > 0 ? "conflict" : "fuera_de_alcance"; // R12 vs R13
  }
}
