import type { PrismaClient } from "@prisma/client";
import type {
  IRolPermisoRepository,
  AsociarInput,
  RolPermiso,
} from "@/lib/interfaces/repositories/IRolPermisoRepository";

type RolPermisoPrismaClient = Pick<PrismaClient, "rolPermiso">;

export class RolPermisoRepository implements IRolPermisoRepository {
  constructor(private readonly prisma: RolPermisoPrismaClient) {}

  async asociar(input: AsociarInput): Promise<RolPermiso> {
    return this.prisma.rolPermiso.create({
      data: {
        rolId: input.rolId,
        permisoId: input.permisoId,
      },
    });
  }

  async listarPorRol(rolId: string): Promise<RolPermiso[]> {
    return this.prisma.rolPermiso.findMany({ where: { rolId } });
  }

  async listarPorPermiso(permisoId: string): Promise<RolPermiso[]> {
    return this.prisma.rolPermiso.findMany({ where: { permisoId } });
  }

  async contar(): Promise<number> {
    return this.prisma.rolPermiso.count();
  }
}
