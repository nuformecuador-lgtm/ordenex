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
// relaciones existentes (patron GestionOrdenRepository.WITH_ASIGNACION).
const WITH_DETALLE = {
  select: {
    id: true,
    ordenId: true,
    resultado: true,
    montoRecibido: true,
    metodoPago: true,
    motivo: true,
    fechaReprogramacion: true,
    evidenciaStoragePath: true,
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

type DetalleRow = Prisma.GestionOrdenGetPayload<typeof WITH_DETALLE>;

// Money-safe: Decimal -> string con escala 2 fija (nunca number/parseFloat).
function decimalToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

function toPendienteRow(row: DetalleRow): CierreGestionPendienteRow {
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

  /** R13/R14: INSERT cierre_dia + vincular gestiones pendientes, atomico. */
  async crearCierre(input: CrearCierreInput): Promise<string> {
    const { mensajeroId, destinoTipo, destinoZonaId, totales } = input;
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
        },
        select: { id: true },
      });
      // R13: consume las gestiones pendientes con guardia de propiedad + no-cerradas
      // en el WHERE (concurrencia-segura: solo las cierre_id IS NULL del actor).
      await tx.gestionOrden.updateMany({
        where: { mensajeroId, cierreId: null },
        data: { cierreId: cierre.id },
      });
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
      solicitadoAt: r.solicitadoAt.toISOString(),
    }));
  }
}
