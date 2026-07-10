import type { PrismaClient } from "@prisma/client";
import type {
  IAprobacionPostulacionRepository,
  ListarPendientesInput,
  ListarPendientesResult,
  MensajeroEstado,
  PostulacionRow,
} from "@/lib/interfaces/repositories/IAprobacionPostulacionRepository";

type AprobacionPrismaClient = Pick<PrismaClient, "usuario">;

const ROL_MENSAJERO = "mensajero" as const;
const ESTADO_PENDIENTE = "pendiente" as const;

// Feature 22 — solo Prisma (sin logica de negocio). Filtra rol `mensajero` +
// estado `pendiente`, incluye catalogos y documentos (R6/R7/R8), y aplica la
// transicion condicional atomica con updateMany (R12/R14/R16/R18).
export class AprobacionPostulacionRepository implements IAprobacionPostulacionRepository {
  constructor(private readonly prisma: AprobacionPrismaClient) {}

  async listPendientes(input: ListarPendientesInput): Promise<ListarPendientesResult> {
    const where = { estado: ESTADO_PENDIENTE, rol: { value: ROL_MENSAJERO } } as const;

    const [rows, total] = await Promise.all([
      this.prisma.usuario.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: input.skip,
        take: input.take,
        select: {
          id: true,
          nombre: true,
          primerApellido: true,
          segundoApellido: true,
          email: true,
          telefono: true,
          cedula: true,
          placa: true,
          tipoIdentificacion: { select: { value: true } },
          vehiculo: { select: { name: true } },
          documentos: {
            orderBy: { tipo: "asc" },
            select: {
              id: true,
              usuarioId: true,
              tipo: true,
              storagePath: true,
              contentType: true,
            },
          },
        },
      }),
      this.prisma.usuario.count({ where }),
    ]);

    const items: PostulacionRow[] = rows.map((u) => ({
      usuarioId: u.id,
      nombre: u.nombre,
      primerApellido: u.primerApellido,
      segundoApellido: u.segundoApellido,
      email: u.email,
      telefono: u.telefono,
      tipoIdentificacion: u.tipoIdentificacion.value,
      cedula: u.cedula,
      vehiculo: u.vehiculo?.name ?? null,
      placa: u.placa,
      documentos: u.documentos,
    }));

    return { items, total };
  }

  async findMensajeroById(id: string): Promise<MensajeroEstado | null> {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, rol: { value: ROL_MENSAJERO } },
      select: { id: true, estado: true },
    });
    return usuario ? { id: usuario.id, estado: usuario.estado } : null;
  }

  async actualizarEstadoSiPendiente(
    id: string,
    estadoDestino: "activo" | "inactivo",
  ): Promise<number> {
    const { count } = await this.prisma.usuario.updateMany({
      where: { id, estado: ESTADO_PENDIENTE, rol: { value: ROL_MENSAJERO } },
      data: { estado: estadoDestino },
    });
    return count;
  }
}
