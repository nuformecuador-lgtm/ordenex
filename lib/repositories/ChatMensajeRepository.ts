// Feature 109 (design §3) — repositorio de MENSAJES de chat. Solo queries Prisma. El
// dedupe (R8) y la actualizacion de estado por `wa_message_id` (R7) se apoyan en el indice
// unico PARCIAL de la migracion. Patron `WalletMovimientoRepository` (createMany
// skipDuplicates = ON CONFLICT DO NOTHING).
import type { ChatMensajeEstado, PrismaClient } from "@prisma/client";
import type {
  ChatMensajeDTO,
  IChatMensajeRepository,
  InsertarEntranteInput,
  InsertarSalienteInput,
} from "@/lib/interfaces/repositories/IChatMensajeRepository";

type ChatMensajePrismaClient = Pick<PrismaClient, "chatMensaje">;

const SELECT = {
  id: true,
  conversacionId: true,
  direccion: true,
  tipo: true,
  cuerpo: true,
  plantillaId: true,
  waMessageId: true,
  estado: true,
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
      },
      select: SELECT,
    });
    return toDTO(row);
  }

  async actualizarEstadoPorWaMessageId(
    waMessageId: string,
    estado: ChatMensajeEstado,
  ): Promise<number> {
    // R7/R8: localiza el saliente por su id de Meta y actualiza el estado. `updateMany`
    // devuelve el conteo: 0 = el saliente aun no esta registrado (no rompe el 200, R9).
    const result = await this.prisma.chatMensaje.updateMany({
      where: { waMessageId, direccion: "saliente" },
      data: { estado },
    });
    return result.count;
  }

  async reconciliarSaliente(
    mensajeId: string,
    waMessageId: string,
    estado: ChatMensajeEstado,
  ): Promise<void> {
    await this.prisma.chatMensaje.update({
      where: { id: mensajeId },
      data: { waMessageId, estado },
    });
  }

  async findById(mensajeId: string): Promise<ChatMensajeDTO | null> {
    const row = await this.prisma.chatMensaje.findUnique({
      where: { id: mensajeId },
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
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
}
