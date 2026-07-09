import { Prisma, type PrismaClient } from "@prisma/client";
import type { OrdenDTO } from "@/lib/types/orden";
import {
  NumRemisionDuplicadoError,
  type CreateOrdenData,
  type GeoExistence,
  type IOrdenRepository,
  type ListOrdenesParams,
  type ListOrdenesResult,
  type UpdateOrdenData,
} from "@/lib/interfaces/repositories/IOrdenRepository";

type OrdenPrismaClient = Pick<
  PrismaClient,
  "orden" | "orderStatus" | "zona" | "provincia" | "canton" | "distrito"
>;

// Mapa columna de negocio -> columna Prisma para el orden (lista blanca R31).
const SORT_COLUMN: Record<string, "createdAt" | "numGuia" | "numRemision"> = {
  created_at: "createdAt",
  num_guia: "numGuia",
  num_remision: "numRemision",
};

// Fila de orden con el `value` del estatus incluido (para OrdenDTO.estatusValue).
type OrdenRow = Prisma.OrdenGetPayload<{
  include: { estatus: { select: { value: true } } };
}>;

const WITH_ESTATUS = {
  include: { estatus: { select: { value: true } } },
} as const;

// Serializa la fila de Prisma a OrdenDTO: peso Decimal -> number, nunca expone
// deletedAt (R42/N3).
function toDTO(row: OrdenRow): OrdenDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusId: row.estatusId,
    estatusValue: row.estatus?.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    tiendaId: row.tiendaId,
    zonaId: row.zonaId,
    provinciaId: row.provinciaId,
    cantonId: row.cantonId,
    distritoId: row.distritoId,
    producto: row.producto,
    peso: row.peso.toNumber(),
    notas: row.notas,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class OrdenRepository implements IOrdenRepository {
  constructor(private readonly prisma: OrdenPrismaClient) {}

  async create(data: CreateOrdenData): Promise<OrdenDTO> {
    try {
      const row = await this.prisma.orden.create({
        data: {
          numRemision: data.numRemision,
          estatusId: data.estatusId,
          destinatario: data.destinatario,
          telefonoDest: data.telefonoDest,
          tiendaId: data.tiendaId,
          zonaId: data.zonaId,
          provinciaId: data.provinciaId,
          cantonId: data.cantonId,
          distritoId: data.distritoId ?? null,
          producto: data.producto,
          peso: new Prisma.Decimal(data.peso),
          notas: data.notas ?? null,
        },
        ...WITH_ESTATUS,
      });
      return toDTO(row);
    } catch (error) {
      throw mapCreateError(error, data.numRemision);
    }
  }

  async findById(id: string): Promise<OrdenDTO | null> {
    const row = await this.prisma.orden.findFirst({
      where: { id, deletedAt: null }, // R34: excluye borradas
      ...WITH_ESTATUS,
    });
    return row ? toDTO(row) : null;
  }

  async list(params: ListOrdenesParams): Promise<ListOrdenesResult> {
    const where: Prisma.OrdenWhereInput = {
      deletedAt: null, // R34
      ...(params.where.tiendaId ? { tiendaId: params.where.tiendaId } : {}),
      ...(params.where.estatusId ? { estatusId: params.where.estatusId } : {}),
    };
    const orderBy = { [SORT_COLUMN[params.sortBy]]: params.sortDir };

    const [items, total] = await Promise.all([
      this.prisma.orden.findMany({
        where,
        orderBy,
        skip: params.skip,
        take: params.take,
        ...WITH_ESTATUS,
      }),
      this.prisma.orden.count({ where }),
    ]);

    return { items: items.map(toDTO), total };
  }

  async update(id: string, data: UpdateOrdenData): Promise<OrdenDTO | null> {
    // Solo aplica si existe y no esta borrada (R36); updateMany no lanza si 0 filas.
    const result = await this.prisma.orden.updateMany({
      where: { id, deletedAt: null },
      data: this.toUpdateData(data),
    });
    if (result.count === 0) return null;
    const row = await this.prisma.orden.findFirst({
      where: { id, deletedAt: null },
      ...WITH_ESTATUS,
    });
    return row ? toDTO(row) : null;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.prisma.orden.updateMany({
      where: { id, deletedAt: null }, // R40: solo si no estaba ya borrada
      data: { deletedAt: new Date() }, // R39
    });
    return result.count > 0;
  }

  async existsEstatus(estatusId: string): Promise<boolean> {
    const found = await this.prisma.orderStatus.findUnique({ where: { id: estatusId } });
    return found !== null;
  }

  async findEstatusIdByValue(value: string): Promise<string | null> {
    const found = await this.prisma.orderStatus.findUnique({ where: { value } });
    return found?.id ?? null;
  }

  async existsGeo(input: {
    zonaId: string;
    provinciaId: string;
    cantonId: string;
    distritoId?: string | null;
  }): Promise<GeoExistence> {
    const [zona, provincia, canton, distrito] = await Promise.all([
      this.prisma.zona.findUnique({ where: { id: input.zonaId } }),
      this.prisma.provincia.findUnique({ where: { id: input.provinciaId } }),
      this.prisma.canton.findUnique({ where: { id: input.cantonId } }),
      input.distritoId
        ? this.prisma.distrito.findUnique({ where: { id: input.distritoId } })
        : Promise.resolve(true),
    ]);
    return {
      zona: zona !== null,
      provincia: provincia !== null,
      canton: canton !== null,
      distrito: distrito !== null,
    };
  }

  private toUpdateData(data: UpdateOrdenData): Prisma.OrdenUncheckedUpdateManyInput {
    const out: Prisma.OrdenUncheckedUpdateManyInput = {};
    if (data.estatusId !== undefined) out.estatusId = data.estatusId;
    if (data.destinatario !== undefined) out.destinatario = data.destinatario;
    if (data.telefonoDest !== undefined) out.telefonoDest = data.telefonoDest;
    if (data.tiendaId !== undefined) out.tiendaId = data.tiendaId;
    if (data.zonaId !== undefined) out.zonaId = data.zonaId;
    if (data.provinciaId !== undefined) out.provinciaId = data.provinciaId;
    if (data.cantonId !== undefined) out.cantonId = data.cantonId;
    if (data.distritoId !== undefined) out.distritoId = data.distritoId;
    if (data.producto !== undefined) out.producto = data.producto;
    if (data.peso !== undefined) out.peso = new Prisma.Decimal(data.peso);
    if (data.notas !== undefined) out.notas = data.notas;
    return out;
  }
}

/** R28/R14: traduce la violacion de unicidad de num_remision a error de dominio. */
function mapCreateError(error: unknown, numRemision: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
    if (target.some((t) => t.includes("num_remision") || t.includes("numRemision"))) {
      return new NumRemisionDuplicadoError(numRemision);
    }
    // Cualquier otra unicidad se traduce igual a conflicto de num_remision por ser
    // el unico campo unico que el usuario provee.
    return new NumRemisionDuplicadoError(numRemision);
  }
  return error;
}
