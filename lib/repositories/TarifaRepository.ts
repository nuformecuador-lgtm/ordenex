import { Prisma, type Tarifa, type PrismaClient } from "@prisma/client";
import type { TarifaDTO } from "@/lib/types/tarifa";
import type {
  CreateTarifaData,
  ITarifaRepository,
  ListTarifasParams,
  ListTarifasResult,
  UpdateTarifaData,
} from "@/lib/interfaces/repositories/ITarifaRepository";

type TarifaPrismaClient = Pick<PrismaClient, "tarifa">;

type TarifaRow = Tarifa;

// Serializa la fila de Prisma a TarifaDTO: las 8 columnas Decimal -> number
// (R27), incluye nombre, nunca expone deletedAt.
function toDTO(row: TarifaRow): TarifaDTO {
  return {
    id: row.id,
    nombre: row.nombre,
    valorFlete: row.valorFlete.toNumber(),
    valorFleteDevuelto: row.valorFleteDevuelto.toNumber(),
    valorFleteGam: row.valorFleteGam.toNumber(),
    valorFleteDevueltoGam: row.valorFleteDevueltoGam.toNumber(),
    fulfillment: row.fulfillment.toNumber(),
    comisionCod: row.comisionCod.toNumber(),
    ivaFlete: row.ivaFlete.toNumber(),
    ivaComisionCod: row.ivaComisionCod.toNumber(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TarifaRepository implements ITarifaRepository {
  constructor(private readonly prisma: TarifaPrismaClient) {}

  async create(data: CreateTarifaData): Promise<TarifaDTO> {
    const row = await this.prisma.tarifa.create({
      data: {
        nombre: data.nombre,
        valorFlete: new Prisma.Decimal(data.valorFlete),
        valorFleteDevuelto: new Prisma.Decimal(data.valorFleteDevuelto),
        valorFleteGam: new Prisma.Decimal(data.valorFleteGam),
        valorFleteDevueltoGam: new Prisma.Decimal(data.valorFleteDevueltoGam),
        fulfillment: new Prisma.Decimal(data.fulfillment),
        comisionCod: new Prisma.Decimal(data.comisionCod),
        ivaFlete: new Prisma.Decimal(data.ivaFlete),
        ivaComisionCod: new Prisma.Decimal(data.ivaComisionCod),
      },
    });
    return toDTO(row);
  }

  async findById(id: string): Promise<TarifaDTO | null> {
    const row = await this.prisma.tarifa.findFirst({
      where: { id, deletedAt: null }, // R19: excluye borrados
    });
    return row ? toDTO(row) : null;
  }

  async list(params: ListTarifasParams): Promise<ListTarifasResult> {
    const where: Prisma.TarifaWhereInput = { deletedAt: null }; // R19

    const [items, total] = await Promise.all([
      this.prisma.tarifa.findMany({
        where,
        orderBy: { createdAt: "desc" }, // R18: orden por defecto
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.tarifa.count({ where }),
    ]);

    return { items: items.map(toDTO), total };
  }

  async update(id: string, data: UpdateTarifaData): Promise<TarifaDTO | null> {
    // Solo aplica si existe y no esta borrado (R21); updateMany no lanza si 0 filas.
    const result = await this.prisma.tarifa.updateMany({
      where: { id, deletedAt: null },
      data: this.toUpdateData(data),
    });
    if (result.count === 0) return null;
    const row = await this.prisma.tarifa.findFirst({ where: { id, deletedAt: null } });
    return row ? toDTO(row) : null;
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.prisma.tarifa.updateMany({
      where: { id, deletedAt: null }, // R25: solo si no estaba ya borrado
      data: { deletedAt: new Date() }, // R24
    });
    return result.count > 0;
  }

  private toUpdateData(data: UpdateTarifaData): Prisma.TarifaUncheckedUpdateManyInput {
    const out: Prisma.TarifaUncheckedUpdateManyInput = {};
    if (data.nombre !== undefined) out.nombre = data.nombre;
    if (data.valorFlete !== undefined) out.valorFlete = new Prisma.Decimal(data.valorFlete);
    if (data.valorFleteDevuelto !== undefined) {
      out.valorFleteDevuelto = new Prisma.Decimal(data.valorFleteDevuelto);
    }
    if (data.valorFleteGam !== undefined) {
      out.valorFleteGam = new Prisma.Decimal(data.valorFleteGam);
    }
    if (data.valorFleteDevueltoGam !== undefined) {
      out.valorFleteDevueltoGam = new Prisma.Decimal(data.valorFleteDevueltoGam);
    }
    if (data.fulfillment !== undefined) out.fulfillment = new Prisma.Decimal(data.fulfillment);
    if (data.comisionCod !== undefined) out.comisionCod = new Prisma.Decimal(data.comisionCod);
    if (data.ivaFlete !== undefined) out.ivaFlete = new Prisma.Decimal(data.ivaFlete);
    if (data.ivaComisionCod !== undefined) {
      out.ivaComisionCod = new Prisma.Decimal(data.ivaComisionCod);
    }
    return out;
  }
}
