import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";

type GestionPrismaClient = Pick<
  PrismaClient,
  "orden" | "usuario" | "gestionOrden" | "$transaction"
>;

// Proyeccion de "mis asignaciones": la orden + nombres legibles via relaciones ya
// existentes (patron OrdenRepository.WITH_ETIQUETA). No expone deletedAt.
const WITH_ASIGNACION = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    montoCobrar: true,
    notas: true,
    mensajeroAsignadoId: true,
    estatus: { select: { value: true } },
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type AsignacionRow = Prisma.OrdenGetPayload<typeof WITH_ASIGNACION>;

function toMiAsignacionRow(row: AsignacionRow): MiAsignacionRow {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatus.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    notas: row.notas,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
    mensajeroAsignadoId: row.mensajeroAsignadoId,
  };
}

export class GestionOrdenRepository implements IGestionOrdenRepository {
  constructor(private readonly prisma: GestionPrismaClient) {}

  /** R9/R13: filtrado por mensajero + estado en el WHERE, no borradas. */
  async findMisAsignaciones(mensajeroId: string, estados: string[]): Promise<MiAsignacionRow[]> {
    if (estados.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: {
        mensajeroAsignadoId: mensajeroId, // R13: nunca ordenes de otro mensajero
        deletedAt: null,
        estatus: { value: { in: estados } },
      },
      orderBy: { createdAt: "desc" },
      ...WITH_ASIGNACION,
    });
    return rows.map(toMiAsignacionRow);
  }

  /** R27/R31: filas por id INCLUYENDO borradas (el service distingue el motivo). */
  async findByIdsParaGestion(ids: string[]): Promise<OrdenGestionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        deletedAt: true,
        mensajeroAsignadoId: true,
        montoCobrar: true,
        estatus: { select: { value: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      estatusValue: r.estatus.value,
      deletedAt: r.deletedAt,
      mensajeroAsignadoId: r.mensajeroAsignadoId,
      montoCobrar: r.montoCobrar ? r.montoCobrar.toNumber() : null,
    }));
  }

  /** R20: puntero de bloqueo 1-a-1 del mensajero. */
  async getOrdenEnGestion(mensajeroId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: mensajeroId },
      select: { ordenEnGestionId: true },
    });
    return row?.ordenEnGestionId ?? null;
  }

  /**
   * R19-R21: fija el puntero de forma condicional e idempotente. El WHERE exige
   * que el puntero este NULL o ya apunte a `ordenId`; si apunta a otra, `count`
   * sera 0 (una fila que no cumple el filtro no se actualiza). Se distingue de
   * "el puntero ya apuntaba a ordenId" releyendo la fila.
   */
  async setOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean> {
    const result = await this.prisma.usuario.updateMany({
      where: {
        id: mensajeroId,
        OR: [{ ordenEnGestionId: null }, { ordenEnGestionId: ordenId }],
      },
      data: { ordenEnGestionId: ordenId },
    });
    if (result.count > 0) return true;
    // count 0: o bien el usuario no existe, o ya tiene OTRA orden activa. Releer
    // para confirmar el estado real (idempotencia ante carreras).
    const actual = await this.getOrdenEnGestion(mensajeroId);
    return actual === ordenId;
  }

  /**
   * R35: limpia el puntero de bloqueo del PROPIO mensajero SOLO si apunta a esa
   * orden. El WHERE guardado (`id = mensajeroId`, `ordenEnGestionId = ordenId`)
   * garantiza que nunca toca el puntero de otro actor ni limpia si apunta a otra
   * orden. Idempotente: `count 0 -> false` (no habia nada que limpiar).
   */
  async liberarOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean> {
    const result = await this.prisma.usuario.updateMany({
      where: { id: mensajeroId, ordenEnGestionId: ordenId },
      data: { ordenEnGestionId: null },
    });
    return result.count > 0;
  }

  /** R15/R16: guardia de propiedad + origen en el WHERE; devuelve filas afectadas. */
  async recogerLote(
    ordenIds: string[],
    mensajeroId: string,
    origenEstatusId: string,
    destinoEstatusId: string,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    const result = await this.prisma.orden.updateMany({
      where: {
        id: { in: ordenIds },
        mensajeroAsignadoId: mensajeroId, // guardia de propiedad (R17)
        estatusId: origenEstatusId, // guardia de origen en_espera_aceptacion (R17)
        deletedAt: null,
      },
      data: { estatusId: destinoEstatusId },
    });
    return result.count;
  }

  /** R23/R26/R28/R30: INSERT gestion + UPDATE estatus + limpiar puntero, atomico. */
  async crearGestionYTransicionar(input: {
    ordenId: string;
    mensajeroId: string;
    gestion: GestionOrdenData;
    nuevoEstatusId: string;
  }): Promise<string> {
    const { ordenId, mensajeroId, gestion, nuevoEstatusId } = input;
    return this.prisma.$transaction(async (tx) => {
      const creada = await tx.gestionOrden.create({
        data: {
          ordenId,
          mensajeroId,
          resultado: gestion.resultado,
          montoRecibido:
            gestion.montoRecibido != null ? new Prisma.Decimal(gestion.montoRecibido) : null,
          metodoPago: gestion.metodoPago ?? null,
          evidenciaStoragePath: gestion.evidenciaStoragePath ?? null,
          evidenciaContentType: gestion.evidenciaContentType ?? null,
          motivo: gestion.motivo ?? null,
          fechaReprogramacion: gestion.fechaReprogramacion
            ? new Date(`${gestion.fechaReprogramacion}T00:00:00.000Z`)
            : null,
        },
        select: { id: true },
      });
      await tx.orden.update({
        where: { id: ordenId },
        data: { estatusId: nuevoEstatusId },
      });
      // R19: libera el bloqueo 1-a-1 dentro de la misma transaccion.
      await tx.usuario.update({
        where: { id: mensajeroId },
        data: { ordenEnGestionId: null },
      });
      return creada.id;
    });
  }
}
