// Feature 109 (design §3) — repositorio del HILO de chat. Solo queries Prisma: sin logica
// de negocio (la ventana de 24 h, el dedupe y la resolucion D4 viven en el service). Patron
// `OrdenEnvioReader` / `PlantillaMensajeRepository`.
import type { PrismaClient } from "@prisma/client";
import type {
  ChatConversacionDTO,
  IChatConversacionRepository,
  ResolucionOrdenEntrante,
  UpsertHiloInput,
} from "@/lib/interfaces/repositories/IChatConversacionRepository";

// Cliente Prisma minimo consumido: la tabla del hilo y la de orden (para la resolucion D4).
type ChatConversacionPrismaClient = Pick<PrismaClient, "chatConversacion" | "orden">;

const SELECT = {
  id: true,
  telefonoE164: true,
  ordenId: true,
  mensajeroId: true,
  ultimoEntranteAt: true,
} as const;

type Row = {
  id: string;
  telefonoE164: string;
  ordenId: string;
  mensajeroId: string;
  ultimoEntranteAt: Date | null;
};

function toDTO(row: Row): ChatConversacionDTO {
  return {
    id: row.id,
    telefonoE164: row.telefonoE164,
    ordenId: row.ordenId,
    mensajeroId: row.mensajeroId,
    ultimoEntranteAt: row.ultimoEntranteAt,
  };
}

export class ChatConversacionRepository implements IChatConversacionRepository {
  constructor(private readonly prisma: ChatConversacionPrismaClient) {}

  async resolverOrdenActivaPorNumero(
    telefonoE164: string,
  ): Promise<ResolucionOrdenEntrante | null> {
    // R25/D4: orden viva, asignada (mensajero not null), del numero, la MAS RECIENTE por
    // `asignado_at`. Empate/NULL de asignado_at -> desempata por created_at desc.
    const row = await this.prisma.orden.findFirst({
      where: {
        telefonoDest: telefonoE164,
        deletedAt: null,
        mensajeroAsignadoId: { not: null },
      },
      orderBy: [{ asignadoAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, mensajeroAsignadoId: true, telefonoDest: true },
    });
    if (row === null || row.mensajeroAsignadoId === null) return null;
    return {
      ordenId: row.id,
      mensajeroId: row.mensajeroAsignadoId,
      telefonoE164: row.telefonoDest,
    };
  }

  async upsertParaOrden(input: UpsertHiloInput): Promise<ChatConversacionDTO> {
    // R13: get-or-create por el unico (orden_id, telefono_e164). En update solo se refresca
    // `mensajero_id` (reasignaciones) y el `updated_at`; `ultimo_entrante_at` no se toca aqui.
    const row = await this.prisma.chatConversacion.upsert({
      where: {
        ordenId_telefonoE164: {
          ordenId: input.ordenId,
          telefonoE164: input.telefonoE164,
        },
      },
      create: {
        ordenId: input.ordenId,
        telefonoE164: input.telefonoE164,
        mensajeroId: input.mensajeroId,
      },
      update: { mensajeroId: input.mensajeroId },
      select: SELECT,
    });
    return toDTO(row);
  }

  async marcarUltimoEntrante(conversacionId: string, ocurridoAt: Date): Promise<void> {
    await this.prisma.chatConversacion.update({
      where: { id: conversacionId },
      data: { ultimoEntranteAt: ocurridoAt },
    });
  }

  async findByOrdenParaMensajero(
    ordenId: string,
    mensajeroId: string,
  ): Promise<ChatConversacionDTO | null> {
    // R16: nunca hilos de otro mensajero. El scope va en el WHERE, no en el service.
    const row = await this.prisma.chatConversacion.findFirst({
      where: { ordenId, mensajeroId },
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
  }

  async findById(id: string): Promise<ChatConversacionDTO | null> {
    const row = await this.prisma.chatConversacion.findUnique({
      where: { id },
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
  }
}
