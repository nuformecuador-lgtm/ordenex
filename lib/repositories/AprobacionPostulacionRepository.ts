import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import type { PrismaClient } from "@prisma/client";
import type {
  IAprobacionPostulacionRepository,
  ListarPendientesInput,
  ListarPendientesResult,
  MensajeroEstado,
  PostulacionRow,
} from "@/lib/interfaces/repositories/IAprobacionPostulacionRepository";

// FICHA 362 (R9): la decision registra su accion en la MISMA transaccion que la escribe.
type AprobacionPrismaClient = Pick<PrismaClient, "usuario" | "$transaction" | "historialAccion">;

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

  /**
   * FICHA 362 (R9/R11) — `postulacion_aprobada` / `postulacion_rechazada`. El metodo se envuelve
   * en `$transaction` (forma 2 del design §2.3: era un `updateMany` suelto).
   *
   * ⚠️ EL REGISTRO VA DENTRO DEL `count === 1`, y ese `where` con `estado: pendiente` es lo que
   * hace la operacion idempotente: dos administradores decidiendo a la vez producen UNA decision,
   * y la segunda —que alcanza cero filas— NO deja fila de auditoria. Si se escribiera antes de
   * mirar el `count`, el registro diria que la postulacion se aprobo dos veces.
   */
  async actualizarEstadoSiPendiente(
    id: string,
    estadoDestino: "activo" | "inactivo",
    actorUsuarioId: string | null,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.usuario.updateMany({
        where: { id, estado: ESTADO_PENDIENTE, rol: { value: ROL_MENSAJERO } },
        data: { estado: estadoDestino },
      });
      if (count === 0) return 0;

      const postulante = await tx.usuario.findUnique({
        where: { id },
        select: { nombre: true, primerApellido: true },
      });
      const actor = await resolverActorCongelado(tx, actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: estadoDestino === "activo" ? "postulacion_aprobada" : "postulacion_rechazada",
          entidadTipo: "usuario",
          entidadId: id,
          entidadEtiqueta: etiquetaDeEntidad("usuario", {
            nombre: postulante?.nombre ?? "",
            primerApellido: postulante?.primerApellido ?? null,
          }),
          ...actor,
        },
      ]);
      return count;
    });
  }
}
