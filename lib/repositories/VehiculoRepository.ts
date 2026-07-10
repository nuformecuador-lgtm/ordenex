import type { PrismaClient, Vehiculo } from "@prisma/client";
import type { VehiculoDTO } from "@/lib/types/vehiculos";
import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";

type VehiculoPrismaClient = Pick<PrismaClient, "vehiculo">;

// Serializa la fila de Prisma a VehiculoDTO: solo id + name, sin campos internos.
function toDTO(row: Vehiculo): VehiculoDTO {
  return { id: row.id, name: row.name };
}

export class VehiculoRepository implements IVehiculoRepository {
  constructor(private readonly prisma: VehiculoPrismaClient) {}

  async findMany(): Promise<VehiculoDTO[]> {
    const rows = await this.prisma.vehiculo.findMany({ orderBy: { name: "asc" } });
    return rows.map(toDTO);
  }

  async findById(id: string): Promise<VehiculoDTO | null> {
    const row = await this.prisma.vehiculo.findUnique({ where: { id } });
    return row ? toDTO(row) : null;
  }
}
