import type { PrismaClient, Vehiculo } from "@prisma/client";
import type { VehiculoDTO } from "@/lib/types/vehiculos";
import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";

type VehiculoPrismaClient = Pick<PrismaClient, "vehiculo" | "usuario" | "tarifaZonaMensajero">;

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

  async findByName(name: string): Promise<VehiculoDTO | null> {
    const row = await this.prisma.vehiculo.findUnique({ where: { name } });
    return row ? toDTO(row) : null;
  }

  async create(name: string): Promise<VehiculoDTO> {
    return toDTO(await this.prisma.vehiculo.create({ data: { name } }));
  }

  async update(id: string, name: string): Promise<VehiculoDTO | null> {
    // updateMany en vez de update: no lanza si la fila no existe, devuelve count 0.
    const res = await this.prisma.vehiculo.updateMany({ where: { id }, data: { name } });
    if (res.count === 0) return null;
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.prisma.vehiculo.deleteMany({ where: { id } });
    return res.count > 0;
  }

  async contarUsos(id: string): Promise<number> {
    // Las DOS relaciones que declara el modelo: mensajeros que declararon este
    // vehiculo (feature 21) y tarifas de zona por tipo de vehiculo (feature 24).
    const [usuarios, tarifas] = await Promise.all([
      this.prisma.usuario.count({ where: { vehiculoId: id } }),
      this.prisma.tarifaZonaMensajero.count({ where: { vehiculoId: id } }),
    ]);
    return usuarios + tarifas;
  }
}
