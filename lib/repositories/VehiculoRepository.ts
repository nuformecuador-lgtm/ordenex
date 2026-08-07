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

  // BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivia `findById`. Se
  // quedo sin llamador al retirarse `VehiculoService.obtener`. El catalogo son TRES filas
  // (moto/carro/camion) y se lee entero con `findMany`.
}
