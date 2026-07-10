import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CatalogoInvalidoError,
  UsuarioDuplicadoError,
  type CreateUsuarioInput,
  type IUserRepository,
  type UsuarioConHash,
  type UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { MensajeroDTO } from "@/lib/types/asignacion-mensajero";

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

  /** Feature 20/R9: actualiza solo `password_hash`; no expone el hash de vuelta. */
  async updatePasswordHash(usuarioId: string, passwordHash: string): Promise<void> {
    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { passwordHash },
    });
  }

  /** Feature 16/R1/R2/R3: solo mensajeros activos, proyectados a id/nombre. */
  async listMensajeros(): Promise<MensajeroDTO[]> {
    return this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" }, estado: "activo" },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
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
