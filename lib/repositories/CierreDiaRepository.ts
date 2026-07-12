import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CierreGestionPendienteRow,
  CrearCierreInput,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";

// El estado que representa una solicitud viva de cierre (R12) y el que crea la 37
// (R13). La 37 SOLO escribe `solicitado`.
const ESTADO_SOLICITADO = "solicitado";

type CierrePrismaClient = Pick<PrismaClient, "gestionOrden" | "orden" | "cierreDia" | "$transaction">;

// Proyeccion de una gestion pendiente de cierre con el detalle de la orden via las
// relaciones existentes (patron GestionOrdenRepository.WITH_ASIGNACION). Exportada
// para reuso por CierresAdminRepository (feature 38): mismo detalle de gestion,
// distinto WHERE (cierre_id = X en vez de cierre_id IS NULL).
export const WITH_DETALLE = {
  select: {
    id: true,
    ordenId: true,
    resultado: true,
    montoRecibido: true,
    metodoPago: true,
    motivo: true,
    fechaReprogramacion: true,
    evidenciaStoragePath: true,
    pagoMensajero: true, // feature 39: snapshot del pago al mensajero (reuso 38/40)
    orden: {
      select: {
        numGuia: true,
        numRemision: true,
        destinatario: true,
        direccion: true,
        producto: true,
        tienda: { select: { nombre: true } },
        zona: { select: { nombre: true } },
        provincia: { select: { nombre: true } },
        canton: { select: { nombre: true } },
        distrito: { select: { nombre: true } },
      },
    },
  },
} as const;

export type DetalleRow = Prisma.GestionOrdenGetPayload<typeof WITH_DETALLE>;

// Money-safe: Decimal -> string con escala 2 fija (nunca number/parseFloat).
function decimalToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

// Mapper de la proyeccion WITH_DETALLE a la fila de dominio. Exportado para reuso
// por CierresAdminRepository (feature 38).
export function toPendienteRow(row: DetalleRow): CierreGestionPendienteRow {
  return {
    gestionId: row.id,
    ordenId: row.ordenId,
    numGuia: row.orden.numGuia,
    numRemision: row.orden.numRemision,
    destinatario: row.orden.destinatario,
    direccion: row.orden.direccion,
    zonaNombre: row.orden.zona.nombre,
    provinciaNombre: row.orden.provincia.nombre,
    cantonNombre: row.orden.canton.nombre,
    distritoNombre: row.orden.distrito?.nombre ?? null,
    producto: row.orden.producto,
    tiendaNombre: row.orden.tienda.nombre,
    resultado: row.resultado,
    montoRecibido: decimalToString(row.montoRecibido),
    metodoPago: row.metodoPago,
    motivo: row.motivo,
    fechaReprogramacion: row.fechaReprogramacion
      ? row.fechaReprogramacion.toISOString().slice(0, 10)
      : null,
    evidenciaStoragePath: row.evidenciaStoragePath,
    // Feature 39: snapshot del pago al mensajero (Decimal->string; null si aun sin cerrar
    // o cierre pre-migracion, R22). En la vista EN VIVO (37) el service lo DERIVA aparte.
    pagoMensajero: decimalToString(row.pagoMensajero),
  };
}

/**
 * Feature 37 — repositorio del cierre del dia. SOLO queries Prisma (sin logica de
 * negocio: los estados "pendientes" los decide el service y se pasan por parametro;
 * los totales snapshot llegan ya calculados como STRING). `crearCierre` es
 * transaccional y consume las gestiones pendientes con un WHERE guardado.
 */
export class CierreDiaRepository implements ICierreDiaRepository {
  constructor(private readonly prisma: CierrePrismaClient) {}

  /** R2/R3: gestiones del mensajero sin cierre (cierre_id IS NULL) + detalle. */
  async findGestionesPendientes(mensajeroId: string): Promise<CierreGestionPendienteRow[]> {
    const rows = await this.prisma.gestionOrden.findMany({
      where: { mensajeroId, cierreId: null }, // R2: nunca gestiones de otro mensajero; R3: solo sin cierre
      orderBy: { createdAt: "desc" },
      ...WITH_DETALLE,
    });
    return rows.map(toPendienteRow);
  }

  /** R10: ordenes asignadas al mensajero (no borradas) en los estados pendientes. */
  async contarOrdenesPendientesGestion(mensajeroId: string, estados: string[]): Promise<number> {
    if (estados.length === 0) return 0;
    return this.prisma.orden.count({
      where: {
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
        estatus: { value: { in: estados } },
      },
    });
  }

  /** R12: existe un cierre `solicitado` del mensajero. */
  async existeCierreSolicitado(mensajeroId: string): Promise<boolean> {
    const count = await this.prisma.cierreDia.count({
      where: { mensajeroId, estado: ESTADO_SOLICITADO },
    });
    return count > 0;
  }

  /** R13/R14: INSERT cierre_dia + vincular gestiones pendientes + snapshot pago, atomico. */
  async crearCierre(input: CrearCierreInput): Promise<string> {
    const { mensajeroId, destinoTipo, destinoZonaId, totales, pagoByGestionId, totalPagoMensajero } =
      input;
    return this.prisma.$transaction(async (tx) => {
      const cierre = await tx.cierreDia.create({
        data: {
          mensajeroId,
          estado: ESTADO_SOLICITADO,
          destinoTipo,
          destinoZonaId,
          totalEfectivo: new Prisma.Decimal(totales.efectivo),
          totalSimpe: new Prisma.Decimal(totales.simpe),
          totalTransferencia: new Prisma.Decimal(totales.transferencia),
          totalGeneral: new Prisma.Decimal(totales.general),
          // Feature 39/R13/R14: total snapshot del pago al mensajero, en la misma tx.
          totalPagoMensajero: new Prisma.Decimal(totalPagoMensajero),
        },
        select: { id: true },
      });
      // R13: consume las gestiones pendientes con guardia de propiedad + no-cerradas
      // en el WHERE (concurrencia-segura: solo las cierre_id IS NULL del actor).
      await tx.gestionOrden.updateMany({
        where: { mensajeroId, cierreId: null },
        data: { cierreId: cierre.id },
      });
      // Feature 39/R12/R14: puebla pago_mensajero por gestion AGRUPADO por valor de pago
      // (F1.4: a lo sumo 2 valores distintos — cobroEntregado para `entregada`, "0.00" para
      // el resto). Guardia por cierreId=nuevo (las que acabamos de vincular). Todo en la tx.
      const idsByPago = new Map<string, string[]>();
      for (const [gestionId, pago] of Object.entries(pagoByGestionId)) {
        const arr = idsByPago.get(pago);
        if (arr) arr.push(gestionId);
        else idsByPago.set(pago, [gestionId]);
      }
      for (const [pago, ids] of idsByPago) {
        await tx.gestionOrden.updateMany({
          where: { id: { in: ids }, cierreId: cierre.id },
          data: { pagoMensajero: new Prisma.Decimal(pago) },
        });
      }
      return cierre.id;
    });
  }

  /** R18: cierres del mensajero (mas reciente primero) con totales snapshot. */
  async findCierresByMensajero(mensajeroId: string): Promise<CierrePasadoDTO[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: { mensajeroId },
      orderBy: { solicitadoAt: "desc" },
      select: {
        id: true,
        estado: true,
        destinoTipo: true,
        destinoZonaId: true,
        totalEfectivo: true,
        totalSimpe: true,
        totalTransferencia: true,
        totalGeneral: true,
        totalPagoMensajero: true, // feature 39/R13: total snapshot del pago al mensajero
        solicitadoAt: true,
      },
    });
    return rows.map((r) => ({
      cierreId: r.id,
      estado: r.estado,
      destinoTipo: r.destinoTipo,
      destinoZonaId: r.destinoZonaId,
      totales: {
        efectivo: r.totalEfectivo.toFixed(2),
        simpe: r.totalSimpe.toFixed(2),
        transferencia: r.totalTransferencia.toFixed(2),
        general: r.totalGeneral.toFixed(2),
      },
      totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R13: snapshot money-safe STRING
      solicitadoAt: r.solicitadoAt.toISOString(),
    }));
  }
}
