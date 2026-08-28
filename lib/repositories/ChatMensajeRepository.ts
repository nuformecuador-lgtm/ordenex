// Feature 109 (design §3) — repositorio de MENSAJES de chat. Solo queries Prisma. El
// dedupe (R8) y la actualizacion de estado por `wa_message_id` (R7) se apoyan en el indice
// unico PARCIAL de la migracion. Patron `WalletMovimientoRepository` (createMany
// skipDuplicates = ON CONFLICT DO NOTHING).
import { Prisma, type ChatMensajeEstado, type PrismaClient } from "@prisma/client";
import type {
  ChatMediaAutorizada,
  ChatMensajeDTO,
  ChatMensajeErrorInput,
  IChatMensajeRepository,
  InsertarEntranteInput,
  InsertarSalienteInput,
} from "@/lib/interfaces/repositories/IChatMensajeRepository";
import { parsearContactosGuardados } from "@/lib/types/chat-contactos";

type ChatMensajePrismaClient = Pick<PrismaClient, "chatMensaje" | "$queryRaw">;

const SELECT = {
  id: true,
  conversacionId: true,
  direccion: true,
  tipo: true,
  cuerpo: true,
  plantillaId: true,
  waMessageId: true,
  estado: true,
  latitud: true,
  longitud: true,
  errorCodigo: true,
  errorTitulo: true,
  errorDetalle: true,
  // Feature 308 (design §4): columnas de los tipos entrantes nuevos. `mediaId` se lee aqui
  // porque la ruta proxy lo necesita; NO viaja a la UI (el mapeo del DTO a la vista lo omite).
  mediaId: true,
  mediaMime: true,
  mediaNombre: true,
  mediaTamanoBytes: true,
  reaccionAWaMessageId: true,
  reaccionEmoji: true,
  contactosJson: true,
  sistemaTelefonoAnterior: true,
  sistemaTelefonoNuevo: true,
  ocurridoAt: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  conversacionId: string;
  direccion: ChatMensajeDTO["direccion"];
  tipo: ChatMensajeDTO["tipo"];
  cuerpo: string | null;
  plantillaId: string | null;
  waMessageId: string | null;
  estado: ChatMensajeEstado | null;
  latitud: number | null;
  longitud: number | null;
  errorCodigo: number | null;
  errorTitulo: string | null;
  errorDetalle: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaNombre: string | null;
  mediaTamanoBytes: number | null;
  reaccionAWaMessageId: string | null;
  reaccionEmoji: string | null;
  // La columna es JSONB: Prisma la entrega como `JsonValue`. NO se propaga asi: `toDTO` la
  // valida con zod y el DTO expone `ChatContactoNormalizado[] | null` (design §1.3).
  contactosJson: Prisma.JsonValue | null;
  sistemaTelefonoAnterior: string | null;
  sistemaTelefonoNuevo: string | null;
  ocurridoAt: Date;
  createdAt: Date;
};

function toDTO(row: Row): ChatMensajeDTO {
  return {
    id: row.id,
    conversacionId: row.conversacionId,
    direccion: row.direccion,
    tipo: row.tipo,
    cuerpo: row.cuerpo,
    plantillaId: row.plantillaId,
    waMessageId: row.waMessageId,
    estado: row.estado,
    latitud: row.latitud,
    longitud: row.longitud,
    errorCodigo: row.errorCodigo,
    errorTitulo: row.errorTitulo,
    errorDetalle: row.errorDetalle,
    mediaId: row.mediaId,
    mediaMime: row.mediaMime,
    mediaNombre: row.mediaNombre,
    mediaTamanoBytes: row.mediaTamanoBytes,
    reaccionAWaMessageId: row.reaccionAWaMessageId,
    reaccionEmoji: row.reaccionEmoji,
    // R14: una fila historica o con un JSON corrupto se lee como "sin contactos", no revienta
    // el listado del hilo entero. `safeParse`, nunca un cast.
    contactos: parsearContactosGuardados(row.contactosJson),
    sistemaTelefonoAnterior: row.sistemaTelefonoAnterior,
    sistemaTelefonoNuevo: row.sistemaTelefonoNuevo,
    ocurridoAt: row.ocurridoAt,
    createdAt: row.createdAt,
  };
}

export class ChatMensajeRepository implements IChatMensajeRepository {
  constructor(private readonly prisma: ChatMensajePrismaClient) {}

  async insertarEntranteIdempotente(input: InsertarEntranteInput): Promise<boolean> {
    // R6/R8: insert con `skipDuplicates` (ON CONFLICT DO NOTHING). El indice unico PARCIAL
    // sobre `wa_message_id` es el arbitro: un id de Meta reenviado NO crea fila y NO falla.
    const result = await this.prisma.chatMensaje.createMany({
      data: [
        {
          conversacionId: input.conversacionId,
          direccion: "entrante",
          tipo: input.tipo,
          cuerpo: input.cuerpo,
          waMessageId: input.waMessageId,
          // Feature 121 (R4): coords del entrante de ubicacion; NULL en los demas entrantes.
          latitud: input.latitud ?? null,
          longitud: input.longitud ?? null,
          // Feature 308 (R1/R4/R5/R7/R9): cada grupo lo puebla SOLO su tipo; el resto queda
          // NULL. Un entrante de media o una reaccion es un entrante MAS: no toca el dedupe
          // (`skipDuplicates` sigue arbitrando por `wa_message_id`) ni el sellado (R12).
          mediaId: input.mediaId ?? null,
          mediaMime: input.mediaMime ?? null,
          mediaNombre: input.mediaNombre ?? null,
          mediaTamanoBytes: input.mediaTamanoBytes ?? null,
          reaccionAWaMessageId: input.reaccionAWaMessageId ?? null,
          reaccionEmoji: input.reaccionEmoji ?? null,
          // `undefined` deja la columna sin tocar; `Prisma.DbNull` escribe NULL SQL (no el
          // literal JSON `null`, que es lo que haria `Prisma.JsonNull`).
          contactosJson: input.contactos ?? Prisma.DbNull,
          sistemaTelefonoAnterior: input.sistemaTelefonoAnterior ?? null,
          sistemaTelefonoNuevo: input.sistemaTelefonoNuevo ?? null,
          ocurridoAt: input.ocurridoAt,
          // `estado` no aplica a entrantes (queda NULL).
        },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async insertarSaliente(input: InsertarSalienteInput): Promise<ChatMensajeDTO> {
    // R20: saliente con estado inicial. `waMessageId` puede ser null (aun no lo dio Meta,
    // caso `queued`); no colisiona con el indice parcial porque este ignora los NULL.
    const row = await this.prisma.chatMensaje.create({
      data: {
        conversacionId: input.conversacionId,
        direccion: "saliente",
        tipo: input.tipo,
        cuerpo: input.cuerpo,
        plantillaId: input.plantillaId ?? null,
        waMessageId: input.waMessageId ?? null,
        estado: input.estado,
        ocurridoAt: input.ocurridoAt,
        // Un saliente puede NACER `failed` (rechazo determinista de la Graph API): el motivo
        // se guarda en el mismo insert, no en un update posterior.
        errorCodigo: input.error?.codigo ?? null,
        errorTitulo: input.error?.titulo ?? null,
        errorDetalle: input.error?.detalle ?? null,
      },
      select: SELECT,
    });
    return toDTO(row);
  }

  async actualizarEstadoPorWaMessageId(
    waMessageId: string,
    estado: ChatMensajeEstado,
    error?: ChatMensajeErrorInput | null,
  ): Promise<number> {
    // R7/R8: localiza el saliente por su id de Meta y actualiza el estado. `updateMany`
    // devuelve el conteo: 0 = el saliente aun no esta registrado (no rompe el 200, R9).
    //
    // `error === undefined` (el caso de sent/delivered/read) NO toca las columnas de error:
    // se distingue de `null`, que las LIMPIA a proposito. Sin esa distincion, cada status
    // posterior a un fallo borraria el motivo o, peor, lo conservaria para siempre.
    const result = await this.prisma.chatMensaje.updateMany({
      where: { waMessageId, direccion: "saliente" },
      data: {
        estado,
        ...(error === undefined
          ? {}
          : {
              errorCodigo: error?.codigo ?? null,
              errorTitulo: error?.titulo ?? null,
              errorDetalle: error?.detalle ?? null,
            }),
      },
    });
    return result.count;
  }

  async marcarFallido(mensajeId: string, error: ChatMensajeErrorInput): Promise<void> {
    await this.prisma.chatMensaje.update({
      where: { id: mensajeId },
      data: {
        estado: "failed",
        errorCodigo: error.codigo,
        errorTitulo: error.titulo,
        errorDetalle: error.detalle,
      },
    });
  }

  async findByWaMessageId(waMessageId: string): Promise<ChatMensajeDTO | null> {
    const row = await this.prisma.chatMensaje.findFirst({
      where: { waMessageId, direccion: "saliente" },
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
  }

  async reconciliarSaliente(
    mensajeId: string,
    waMessageId: string,
    estado: ChatMensajeEstado,
  ): Promise<void> {
    await this.prisma.chatMensaje.update({
      where: { id: mensajeId },
      // El reintento salio bien: se limpia el motivo del fallo anterior. Si no se limpiara,
      // un mensaje entregado seguiria mostrando el error que ya se supero.
      data: { waMessageId, estado, errorCodigo: null, errorTitulo: null, errorDetalle: null },
    });
  }

  async findById(mensajeId: string): Promise<ChatMensajeDTO | null> {
    const row = await this.prisma.chatMensaje.findUnique({
      where: { id: mensajeId },
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
  }

  async ultimoEntranteAt(conversacionId: string): Promise<Date | null> {
    // Ventana de 24 h calculada desde el ULTIMO mensaje entrante REAL del hilo (no la columna
    // `ultimo_entrante_at`, que puede quedar desincronizada). Asi el envio (backend) y el panel
    // (que habilita el input al haber entrantes) usan la MISMA fuente: los mensajes.
    const row = await this.prisma.chatMensaje.findFirst({
      where: { conversacionId, direccion: "entrante" },
      orderBy: { ocurridoAt: "desc" },
      select: { ocurridoAt: true },
    });
    return row?.ocurridoAt ?? null;
  }

  async listarHilo(conversacionId: string): Promise<ChatMensajeDTO[]> {
    // R22: historial ordenado cronologicamente (usa el indice conversacion_id, ocurrido_at).
    const rows = await this.prisma.chatMensaje.findMany({
      where: { conversacionId },
      orderBy: [{ ocurridoAt: "asc" }, { createdAt: "asc" }],
      select: SELECT,
    });
    return rows.map(toDTO);
  }

  async findMediaParaMensajero(
    mensajeId: string,
    mensajeroId: string,
  ): Promise<ChatMediaAutorizada | null> {
    // Feature 308 (design §5.2, R23): UNA sola query. El join mensaje -> conversacion -> orden
    // con `o.mensajero_asignado_id = $mensajeroId` ES la autorizacion: si la orden no esta
    // asignada a quien pide, no hay fila y el proxy responde 403 sin tocar la Graph API.
    //
    // Se comprueba la asignacion contra `orden`, no solo contra `chat_conversacion.mensajero_id`:
    // el hilo sobrevive a las reasignaciones (`upsertParaOrden` reescribe `mensajero_id`), pero
    // la fuente de verdad de "de quien es la orden" es `orden.mensajero_asignado_id`, que es la
    // misma puerta que usa `OrdenEnvioReader.findParaEnvio` en `listarHilo` (R16/R17 de la 109).
    // `deleted_at IS NULL` por el mismo motivo que alli: una orden borrada no da acceso a nada.
    const rows = await this.prisma.$queryRaw<
      { media_id: string | null; media_mime: string | null; media_nombre: string | null; orden_id: string }[]
    >(Prisma.sql`
      SELECT m.media_id, m.media_mime, m.media_nombre, c.orden_id
      FROM chat_mensaje m
      JOIN chat_conversacion c ON c.id = m.conversacion_id
      JOIN orden o ON o.id = c.orden_id
      WHERE m.id = ${mensajeId}::uuid
        AND o.deleted_at IS NULL
        AND o.mensajero_asignado_id = ${mensajeroId}
      LIMIT 1
    `);

    const row = rows[0];
    if (row === undefined) return null;
    return {
      mediaId: row.media_id,
      mediaMime: row.media_mime,
      mediaNombre: row.media_nombre,
      ordenId: row.orden_id,
    };
  }
}
