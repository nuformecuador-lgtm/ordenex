import { Prisma, type PrismaClient } from "@prisma/client";
import type { OrdenDTO, OrdenListItemDTO } from "@/lib/types/orden";
import {
  NumRemisionDuplicadoError,
  type CantonRow,
  type CreateOrdenData,
  type DistritoRow,
  type GeoExistence,
  type IOrdenRepository,
  type ListOrdenesParams,
  type ListOrdenesResult,
  type ProvinciaRow,
  type UpdateOrdenData,
} from "@/lib/interfaces/repositories/IOrdenRepository";

type OrdenPrismaClient = Pick<
  PrismaClient,
  "orden" | "orderStatus" | "zona" | "provincia" | "canton" | "distrito" | "usuario"
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

// R25/R26: solo el LISTADO incluye el nombre legible de la tienda
// (relacion Orden.tienda -> Usuario.nombre). No requiere migracion: es un include
// sobre una relacion ya existente en el esquema.
const WITH_ESTATUS_Y_TIENDA = {
  include: {
    estatus: { select: { value: true } },
    tienda: { select: { nombre: true } },
  },
} as const;

// Fila de orden del listado: estatus.value + tienda.nombre.
type OrdenListRow = Prisma.OrdenGetPayload<{
  include: {
    estatus: { select: { value: true } };
    tienda: { select: { nombre: true } };
  };
}>;

// Serializa la fila de Prisma a OrdenDTO: peso Decimal -> number (o null,
// feature 15/R4), nunca expone deletedAt (R42/N3).
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
    peso: row.peso ? row.peso.toNumber() : null,
    notas: row.notas,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// R25/R26: serializa una fila del listado a OrdenListItemDTO, agregando el nombre
// legible de la tienda. Solo el listado usa este mapeo; el resto del CRUD usa toDTO.
function toListItemDTO(row: OrdenListRow): OrdenListItemDTO {
  return {
    ...toDTO(row),
    tiendaNombre: row.tienda.nombre,
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
          peso: data.peso !== null ? new Prisma.Decimal(data.peso) : null,
          notas: data.notas ?? null,
          direccion: data.direccion ?? null,
          montoCobrar: data.montoCobrar != null ? new Prisma.Decimal(data.montoCobrar) : null,
          mensajeroSugeridoId: data.mensajeroSugeridoId ?? null,
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
        ...WITH_ESTATUS_Y_TIENDA, // R25: incluye estatus.value + tienda.nombre
      }),
      this.prisma.orden.count({ where }),
    ]);

    return { items: items.map(toListItemDTO), total };
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
    if (data.peso !== undefined) {
      out.peso = data.peso !== null ? new Prisma.Decimal(data.peso) : null;
    }
    if (data.notas !== undefined) out.notas = data.notas;
    return out;
  }

  // --- Feature 15: carga masiva (metodos batch) ---

  /** R25: remision -> estatus.value de la orden existente (no borrada). */
  async findExistingRemisiones(nums: string[]): Promise<Map<string, string>> {
    if (nums.length === 0) return new Map();
    const rows = await this.prisma.orden.findMany({
      where: { numRemision: { in: nums }, deletedAt: null },
      select: { numRemision: true, estatus: { select: { value: true } } },
    });
    return new Map(rows.map((r) => [r.numRemision, r.estatus.value]));
  }

  /** R19/R21: provincias candidatas por nombre; el service resuelve jerarquia/ambiguedad. */
  async findProvinciasByNombres(nombres: string[]): Promise<ProvinciaRow[]> {
    if (nombres.length === 0) return [];
    const rows = await this.prisma.provincia.findMany({
      where: { nombre: { in: nombres, mode: "insensitive" } },
      select: { id: true, nombre: true, zonaId: true },
    });
    return rows;
  }

  /** R19: cantones de las provincias resueltas (todo el universo, el service filtra por jerarquia). */
  async findCantonesByProvinciaIds(provinciaIds: string[]): Promise<CantonRow[]> {
    if (provinciaIds.length === 0) return [];
    const rows = await this.prisma.canton.findMany({
      where: { provinciaId: { in: provinciaIds } },
      select: { id: true, nombre: true, provinciaId: true },
    });
    return rows;
  }

  /** R19: distritos de los cantones resueltos. */
  async findDistritosByCantonIds(cantonIds: string[]): Promise<DistritoRow[]> {
    if (cantonIds.length === 0) return [];
    const rows = await this.prisma.distrito.findMany({
      where: { cantonId: { in: cantonIds } },
      select: { id: true, nombre: true, cantonId: true },
    });
    return rows;
  }

  /** R22: subconjunto de `ids` con rol `mensajero`. */
  async findMensajerosByIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: ids }, rol: { value: "mensajero" } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** R27: insercion masiva en lotes de `batchSize`, tolerando carreras de num_remision. */
  async createManyOrdenes(data: CreateOrdenData[], batchSize: number): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      const result = await this.prisma.orden.createMany({
        data: chunk.map((d) => this.toCreateManyInput(d)),
        skipDuplicates: true,
      });
      inserted += result.count;
    }
    return inserted;
  }

  private toCreateManyInput(data: CreateOrdenData): Prisma.OrdenCreateManyInput {
    return {
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
      peso: data.peso !== null ? new Prisma.Decimal(data.peso) : null,
      notas: data.notas ?? null,
      direccion: data.direccion ?? null,
      montoCobrar: data.montoCobrar != null ? new Prisma.Decimal(data.montoCobrar) : null,
      mensajeroSugeridoId: data.mensajeroSugeridoId ?? null,
    };
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
