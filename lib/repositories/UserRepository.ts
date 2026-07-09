import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
  type CreateUsuarioInput,
  type IUserRepository,
  type UsuarioConHash,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";

type UserPrismaClient = Pick<PrismaClient, "usuario" | "tipoIdentificacion" | "rol">;

const PUBLIC_SELECT = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  estado: true,
  cedula: true,
  tipoIdentificacionId: true,
  rolId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class UserRepository implements IUserRepository {
  constructor(private readonly prisma: UserPrismaClient) {}

  async findByEmailWithHash(email: string): Promise<UsuarioConHash | null> {
    return this.prisma.usuario.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<UsuarioPublico | null> {
    return this.prisma.usuario.findUnique({ where: { id }, select: PUBLIC_SELECT });
  }

  async findByEmail(email: string): Promise<UsuarioPublico | null> {
    return this.prisma.usuario.findUnique({ where: { email }, select: PUBLIC_SELECT });
  }

  async create(input: CreateUsuarioInput): Promise<UsuarioPublico> {
    // R10: se valida la FK de catalogo explicitamente en vez de depender del
    // codigo de error de Postgres, para dar un error de dominio claro (T017).
    const [tipoIdentificacion, rol] = await Promise.all([
      this.prisma.tipoIdentificacion.findUnique({ where: { id: input.tipoIdentificacionId } }),
      this.prisma.rol.findUnique({ where: { id: input.rolId } }),
    ]);
    if (!tipoIdentificacion) {
      throw new CatalogoInvalidoError("tipoIdentificacionId", input.tipoIdentificacionId);
    }
    if (!rol) {
      throw new CatalogoInvalidoError("rolId", input.rolId);
    }

    try {
      return await this.prisma.usuario.create({ data: input, select: PUBLIC_SELECT });
    } catch (error) {
      throw mapDuplicadoError(error);
    }
  }
}

/** R4/R5: traduce la violacion de unicidad de Postgres a un error de dominio. */
function mapDuplicadoError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
    if (target.includes("email")) return new UsuarioDuplicadoError("email");
    if (target.includes("cedula")) return new UsuarioDuplicadoError("cedula");
  }
  return error;
}
