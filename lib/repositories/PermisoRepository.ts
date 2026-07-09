import type { PrismaClient } from "@prisma/client";
import type {
  IPermisoRepository,
  CrearPermisoInput,
  Permiso,
} from "@/lib/interfaces/repositories/IPermisoRepository";

type PermisoPrismaClient = Pick<PrismaClient, "permiso">;

export class PermisoRepository implements IPermisoRepository {
  constructor(private readonly prisma: PermisoPrismaClient) {}

  async crear(input: CrearPermisoInput): Promise<Permiso> {
    return this.prisma.permiso.create({
      data: {
        nombre: input.nombre,
        method: input.method,
        route: input.route,
      },
    });
  }

  async contar(): Promise<number> {
    return this.prisma.permiso.count();
  }
}
