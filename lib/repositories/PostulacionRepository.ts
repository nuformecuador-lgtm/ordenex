import { Prisma, type PrismaClient } from "@prisma/client";
import {
  UsuarioDuplicadoError,
  type CreateUsuarioInput,
} from "@/lib/interfaces/repositories/IUserRepository";
import type { MensajeroDocumentoInput } from "@/lib/interfaces/repositories/IMensajeroDocumentoRepository";
import type { IPostulacionRepository } from "@/lib/interfaces/repositories/IPostulacionRepository";

type PostulacionPrismaClient = Pick<
  PrismaClient,
  "usuario" | "rol" | "tipoIdentificacion" | "vehiculo" | "$transaction"
>;

// Feature 21 — capa de datos de la postulacion. Solo queries Prisma; la logica
// de negocio (hash, orquestacion, limpieza) vive en PostulacionMensajeroService.
export class PostulacionRepository implements IPostulacionRepository {
  constructor(private readonly prisma: PostulacionPrismaClient) {}

  async emailExiste(email: string): Promise<boolean> {
    const row = await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    return row !== null;
  }

  async cedulaExiste(cedula: string): Promise<boolean> {
    const row = await this.prisma.usuario.findUnique({ where: { cedula }, select: { id: true } });
    return row !== null;
  }

  async findRolIdByValue(value: string): Promise<string | null> {
    const row = await this.prisma.rol.findUnique({
      where: { value: value as Prisma.RolWhereUniqueInput["value"] },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async tipoIdentificacionExiste(id: string): Promise<boolean> {
    const row = await this.prisma.tipoIdentificacion.findUnique({
      where: { id },
      select: { id: true },
    });
    return row !== null;
  }

  async vehiculoExiste(id: string): Promise<boolean> {
    const row = await this.prisma.vehiculo.findUnique({ where: { id }, select: { id: true } });
    return row !== null;
  }

  async crearMensajeroConDocumentos(
    usuario: CreateUsuarioInput & { id: string },
    documentos: MensajeroDocumentoInput[],
  ): Promise<{ id: string }> {
    try {
      // R12/R13/R16/R24: usuario + 5 documentos en una unica transaccion. El
      // estado NO se pasa: la DB aplica el default `pendiente`.
      return await this.prisma.$transaction(async (tx) => {
        const creado = await tx.usuario.create({
          data: {
            id: usuario.id,
            nombre: usuario.nombre,
            primerApellido: usuario.primerApellido ?? null,
            segundoApellido: usuario.segundoApellido ?? null,
            email: usuario.email,
            telefono: usuario.telefono,
            passwordHash: usuario.passwordHash,
            cedula: usuario.cedula,
            tipoIdentificacionId: usuario.tipoIdentificacionId,
            rolId: usuario.rolId,
            vehiculoId: usuario.vehiculoId ?? null,
            placa: usuario.placa ?? null,
          },
          select: { id: true },
        });
        await tx.mensajeroDocumento.createMany({
          data: documentos.map((d) => ({
            usuarioId: creado.id,
            tipo: d.tipo,
            storagePath: d.storagePath,
            contentType: d.contentType,
          })),
        });
        return creado;
      });
    } catch (error) {
      throw mapDuplicadoError(error);
    }
  }
}

/** R19/R20/R21: traduce la violacion de unicidad de Postgres a error de dominio. */
function mapDuplicadoError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
    if (target.includes("email")) return new UsuarioDuplicadoError("email");
    if (target.includes("cedula")) return new UsuarioDuplicadoError("cedula");
  }
  return error;
}
