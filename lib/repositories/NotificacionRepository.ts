// Feature 146 (design §1.5/§2) — repositorio de notificaciones. SOLO queries Prisma: la
// ventana de 30 dias, el limite, el mapeo a DTO y las respuestas de dominio viven en el
// service. Aqui vive UNA cosa de peso: `predicadoVisibilidad`, la fuente UNICA de R13-R17.
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  ListarParaUsuarioInput,
  NotificacionActor,
  NotificacionDestinatario,
  NotificacionRow,
  NotificacionTxClient,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento, NotificationType } from "@/lib/types/notificacion";

type NotificacionPrismaClient = Pick<PrismaClient, "notificacion" | "notificacionLectura">;

/**
 * PREDICADO UNICO DE VISIBILIDAD (design §1.5) — fuente de verdad de R13-R17. Las CINCO
 * consultas que necesitan alcance (listar, verificar, marcar leida, marcar todas, descartar)
 * lo reutilizan; NO existe un segundo filtro de alcance en el repositorio ni en el service.
 *
 *   visible(actor) :=  destinatario_usuario_id = actor.usuarioId
 *                   OR ( destinatario_rol = actor.rol
 *                        AND (tienda_id IS NULL OR tienda_id = actor.usuarioId)
 *                        AND (zona_id   IS NULL OR zona_id   = actor.zonaId) )
 *
 * - Alcance NULL en ambas columnas -> visible a TODO el rol (R13).
 * - `tienda_id` con valor -> solo el `adminTienda` que ES esa tienda (R14); cualquier otro
 *   `adminTienda` queda fuera (R15).
 * - `zona_id` con valor -> solo los usuarios del rol con esa `usuario.zona_id` (R16). Si el
 *   actor NO tiene zona, `zonaId` es `null` y la rama solo casa con `zona_id IS NULL`: no ve
 *   ninguna acotada por zona.
 * - Todo el segundo termino cuelga de `destinatario_rol = actor.rol`, asi que una
 *   notificacion dirigida a otro rol es invisible sea cual sea su alcance (R17).
 *
 * Autorizar con el MISMO predicado que lista es lo que hace imposible olvidar R35.
 */
export function predicadoVisibilidad(actor: NotificacionActor): Prisma.NotificacionWhereInput {
  return {
    OR: [
      { destinatarioUsuarioId: actor.usuarioId },
      {
        destinatarioRol: actor.rol,
        OR: [{ tiendaId: null }, { tiendaId: actor.usuarioId }],
        AND: [{ OR: [{ zonaId: null }, { zonaId: actor.zonaId }] }],
      },
    ],
  };
}

/**
 * Traduce el destinatario a las DOS columnas del CHECK XOR. Las escrituras y la guardia de
 * dedupe comparten esta traduccion para que la clave del `create` y la del `count` no puedan
 * divergir (la clave del indice unico es `(evento, entidad_id, destinatario_rol,
 * destinatario_usuario_id)`: el ALCANCE no entra, a proposito).
 */
function columnasDestinatario(destinatario: NotificacionDestinatario): {
  destinatarioRol: Prisma.NotificacionCreateInput["destinatarioRol"];
  destinatarioUsuarioId: string | null;
  tiendaId: string | null;
  zonaId: string | null;
} {
  if (destinatario.tipo === "usuario") {
    return {
      destinatarioRol: null,
      destinatarioUsuarioId: destinatario.usuarioId,
      tiendaId: null,
      zonaId: null,
    };
  }
  return {
    destinatarioRol: destinatario.rol,
    destinatarioUsuarioId: null,
    tiendaId: destinatario.tiendaId ?? null,
    zonaId: destinatario.zonaId ?? null,
  };
}

const SELECT_LISTADO = {
  id: true,
  tipo: true,
  descripcion: true,
  anexo: true,
  createdAt: true,
} as const;

export class NotificacionRepository implements INotificacionRepository {
  constructor(private readonly prisma: NotificacionPrismaClient) {}

  private cliente(tx?: NotificacionTxClient): NotificacionPrismaClient {
    return tx ?? this.prisma;
  }

  async crear(input: CrearNotificacionInput, tx?: NotificacionTxClient): Promise<boolean> {
    const cols = columnasDestinatario(input.destinatario);
    try {
      await this.cliente(tx).notificacion.create({
        data: {
          tipo: input.tipo,
          evento: input.evento,
          descripcion: input.descripcion,
          anexo: input.anexo ?? null,
          entidadTipo: input.entidadTipo,
          entidadId: input.entidadId,
          ...cols,
        },
        select: { id: true },
      });
      return true;
    } catch (error) {
      // R27: chocar con `notificacion_dedupe_key` NO es un fallo, es la dedupe haciendo su
      // trabajo ante una carrera que la guardia previa no pudo ver. Se trata como no-op.
      // Cualquier otro error SI se propaga (en el productor transaccional del rechazo eso
      // revierte el cambio de estado, F1.4-3 / R21).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  async existeNoLeidaPara(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
    tx?: NotificacionTxClient,
  ): Promise<boolean> {
    const cols = columnasDestinatario(destinatario);
    const encontrada = await this.cliente(tx).notificacion.findFirst({
      where: {
        evento,
        entidadId,
        destinatarioRol: cols.destinatarioRol,
        destinatarioUsuarioId: cols.destinatarioUsuarioId,
        // "no leida por su destinatario": ninguna fila de lectura la marca como leida.
        // Depende de OTRA tabla, por eso esto es una guardia y no un indice (design §1.4).
        lecturas: { none: { leidaAt: { not: null } } },
      },
      select: { id: true },
    });
    return encontrada !== null;
  }

  async listarParaUsuario(input: ListarParaUsuarioInput): Promise<NotificacionRow[]> {
    const { actor, desde, limite } = input;
    const filas = await this.prisma.notificacion.findMany({
      where: {
        AND: [
          predicadoVisibilidad(actor), // R13-R17
          { createdAt: { gte: desde } }, // R29: ventana
          // R33: lo que ESTE usuario descarto desaparece de SU listado, sin borrar la fila
          // ni afectar a los demas destinatarios.
          { lecturas: { none: { usuarioId: actor.usuarioId, descartadaAt: { not: null } } } },
        ],
      },
      orderBy: { createdAt: "desc" }, // R28: de mas reciente a mas antigua
      take: limite, // R29
      select: {
        ...SELECT_LISTADO,
        // R30/R3: el estado de lectura se resuelve POR ACTOR; dos usuarios del mismo rol
        // pueden ver la misma fila con `leida` distinto.
        lecturas: {
          where: { usuarioId: actor.usuarioId },
          select: { leidaAt: true },
          take: 1,
        },
      },
    });
    return filas.map((f) => ({
      id: f.id,
      tipo: f.tipo as NotificationType,
      descripcion: f.descripcion,
      anexo: f.anexo,
      createdAt: f.createdAt,
      leida: (f.lecturas[0]?.leidaAt ?? null) !== null,
    }));
  }

  async verificarVisible(
    id: string,
    actor: NotificacionActor,
  ): Promise<"visible" | "no_visible" | "no_existe"> {
    const visible = await this.prisma.notificacion.findFirst({
      where: { AND: [{ id }, predicadoVisibilidad(actor)] }, // R35: mismo predicado que lista
      select: { id: true },
    });
    if (visible !== null) return "visible";
    // Solo en el camino negativo se paga la segunda consulta, para distinguir "no existe"
    // (not_found) de "existe pero no es tuya" (forbidden).
    const existe = await this.prisma.notificacion.findUnique({ where: { id }, select: { id: true } });
    return existe === null ? "no_existe" : "no_visible";
  }

  async marcarLeida(notificacionId: string, usuarioId: string, ahora: Date): Promise<void> {
    // R37: upsert por el unico (notificacion, usuario) -> idempotente y con UNA sola fila.
    // La PRIMERA lectura manda: re-marcar no reescribe el instante. Toda fila de lectura
    // nace con `leida_at` (tambien las que crea `descartar`), asi que el `update` vacio no
    // deja nunca una fila "no leida".
    await this.prisma.notificacionLectura.upsert({
      where: { notificacionId_usuarioId: { notificacionId, usuarioId } },
      create: { notificacionId, usuarioId, leidaAt: ahora },
      update: {},
    });
  }

  async marcarTodasLeidas(
    actor: NotificacionActor,
    desde: Date,
    ahora: Date,
  ): Promise<number> {
    // R32: el conjunto es EXACTAMENTE el del listado (visibles, en ventana, no descartadas)
    // menos las que ya estaban leidas, para que el contador quede en cero.
    const pendientes = await this.prisma.notificacion.findMany({
      where: {
        AND: [
          predicadoVisibilidad(actor),
          { createdAt: { gte: desde } },
          { lecturas: { none: { usuarioId: actor.usuarioId, descartadaAt: { not: null } } } },
          { lecturas: { none: { usuarioId: actor.usuarioId, leidaAt: { not: null } } } },
        ],
      },
      select: { id: true },
    });
    if (pendientes.length === 0) return 0;
    // `skipDuplicates` compila a ON CONFLICT DO NOTHING: idempotente y sin
    // read-modify-write, aunque otra pestana marque a la vez.
    const { count } = await this.prisma.notificacionLectura.createMany({
      data: pendientes.map((n) => ({
        notificacionId: n.id,
        usuarioId: actor.usuarioId,
        leidaAt: ahora,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  async descartar(notificacionId: string, usuarioId: string, ahora: Date): Promise<void> {
    // R33: NO se borra la fila de `notificacion`; el descarte es por usuario.
    await this.prisma.notificacionLectura.upsert({
      where: { notificacionId_usuarioId: { notificacionId, usuarioId } },
      create: { notificacionId, usuarioId, leidaAt: ahora, descartadaAt: ahora },
      update: { descartadaAt: ahora }, // R37: repetir el descarte no crea una segunda fila
    });
    // Equivalente al `leida_at = COALESCE(leida_at, now())` del design §3.5, que el `upsert`
    // de Prisma no puede expresar: descartar implica leer, para que descartar una NO leida
    // no deje el contador descuadrado.
    await this.prisma.notificacionLectura.updateMany({
      where: { notificacionId, usuarioId, leidaAt: null },
      data: { leidaAt: ahora },
    });
  }
}
