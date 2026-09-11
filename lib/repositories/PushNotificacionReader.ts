// FICHA 410 (design §8, T3.3) — QUIEN VERIA ESTE AVISO. SOLO queries Prisma.
//
// El predicado NO se escribe aqui: se importa de `NotificacionRepository`, donde vive PEGADO a
// `predicadoVisibilidad`, que es su espejo. Ver el comentario de `predicadoDestinatariosDeAviso`:
// tener las dos direcciones de la misma regla en el mismo archivo es lo que impide que diverjan, y
// una divergencia aqui significa un push en el telefono de quien no ve ese aviso (R25).
import type { PrismaClient, RolValue } from "@prisma/client";
import type {
  AvisoParaPush,
  DestinatarioDeAviso,
  IPushNotificacionReader,
} from "@/lib/interfaces/repositories/IPushNotificacionReader";
import { predicadoDestinatariosDeAviso } from "@/lib/repositories/NotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";

type LectorPrismaClient = Pick<PrismaClient, "notificacion" | "usuario">;

export class PushNotificacionReader implements IPushNotificacionReader {
  constructor(private readonly prisma: LectorPrismaClient) {}

  async leerAviso(notificacionId: string): Promise<AvisoParaPush | null> {
    const fila = await this.prisma.notificacion.findUnique({
      where: { id: notificacionId },
      select: { id: true, evento: true, descripcion: true, anexo: true },
    });
    if (fila === null) return null;
    return {
      id: fila.id,
      evento: fila.evento as NotificacionEvento,
      descripcion: fila.descripcion,
      anexo: fila.anexo,
    };
  }

  /**
   * R8/R21/R24/R25 — los usuarios ACTIVOS que verian este aviso y todavia no lo han leido ni
   * descartado.
   *
   * ⚠️ EL FILTRO DE «YA LO VIO» ES POR USUARIO Y NO POR FILA, porque el estado de lectura vive en
   * `notificacion_lectura` y es POR USUARIO desde la 146: que un admin lea el aviso no apaga el de
   * los demas admins, y por tanto tampoco puede apagarles el push. Excluir la fila entera en cuanto
   * alguien la lee dejaria sin aviso a los otros destinatarios, en silencio.
   */
  async destinatariosPendientes(notificacionId: string): Promise<DestinatarioDeAviso[]> {
    const aviso = await this.prisma.notificacion.findUnique({
      where: { id: notificacionId },
      select: {
        destinatarioRol: true,
        destinatarioUsuarioId: true,
        tiendaId: true,
        zonaId: true,
      },
    });
    if (aviso === null) return [];

    const usuarios = await this.prisma.usuario.findMany({
      where: {
        AND: [
          predicadoDestinatariosDeAviso({
            destinatarioRol: aviso.destinatarioRol,
            destinatarioUsuarioId: aviso.destinatarioUsuarioId,
            tiendaId: aviso.tiendaId,
            zonaId: aviso.zonaId,
          }),
          // R8: quien ya lo leyo o ya lo descarto no recibe push. `descartada_at` implica
          // `leida_at` desde la 146, asi que con mirar los dos campos por separado basta.
          {
            notificacionLecturas: {
              none: {
                notificacionId,
                OR: [{ leidaAt: { not: null } }, { descartadaAt: { not: null } }],
              },
            },
          },
        ],
      },
      select: { id: true, zonaId: true, rol: { select: { value: true } } },
      orderBy: { id: "asc" },
    });

    return usuarios.map((u) => ({
      usuarioId: u.id,
      rol: u.rol.value as RolValue,
      zonaId: u.zonaId,
    }));
  }
}
