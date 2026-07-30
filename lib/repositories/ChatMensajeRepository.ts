// Feature 109 (design §3) — repositorio de MENSAJES de chat. Solo queries Prisma. El
// dedupe (R8) y la actualizacion de estado por `wa_message_id` (R7) se apoyan en el indice
// unico PARCIAL de la migracion. Patron `WalletMovimientoRepository` (createMany
// skipDuplicates = ON CONFLICT DO NOTHING).
import type { ChatMensajeEstado, PrismaClient } from "@prisma/client";
import type {
  ChatMensajeDTO,
  ChatMensajeErrorInput,
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
  latitud: true,
  longitud: true,
  errorCodigo: true,
  errorTitulo: true,
  errorDetalle: true,
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
}
