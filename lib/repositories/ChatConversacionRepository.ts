// Feature 109 (design §3) — repositorio del HILO de chat. Solo queries Prisma: sin logica
// de negocio (la ventana de 24 h, el dedupe y la resolucion D4 viven en el service). Patron
// `OrdenEnvioReader` / `PlantillaMensajeRepository`.
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ChatConversacionDTO,
  IChatConversacionRepository,
  NoLeidosPorOrden,
  ResolucionOrdenEntrante,
  UpsertHiloInput,
} from "@/lib/interfaces/repositories/IChatConversacionRepository";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";

// Cliente Prisma minimo consumido: la tabla del hilo, la de orden (resolucion D4) y el
// escape hatch de SQL crudo (`$queryRaw`) para normalizar el telefono en el matcheo.
type ChatConversacionPrismaClient = Pick<
  PrismaClient,
  "chatConversacion" | "orden" | "$queryRaw" | "$executeRaw"
>;

// Fila cruda del matcheo por telefono normalizado (columnas snake_case de la tabla `orden`).
type OrdenResolucionRaw = {
  id: string;
  mensajero_asignado_id: string | null;
  telefono_dest: string;
};

// Fila cruda del conteo de no leidos. `COUNT(*)` es `bigint` en Postgres y Prisma lo mapea a
// `BigInt` en JS, que NO es serializable a la UI: por eso el SQL lo castea a `int`.
type NoLeidosRaw = {
  orden_id: string;
  no_leidos: number;
};

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
    //
    // El match del telefono se hace NORMALIZADO en ambos lados: el entrante (a solo digitos)
    // contra `regexp_replace(telefono_dest, '[^0-9]', '', 'g')`. Asi `+573…` entrante casa con
    // una orden guardada como `573…` (o al reves), evitando el bug de hilos duplicados. Prisma
    // no puede normalizar la columna en el WHERE, por eso va raw (parametrizado, sin inyeccion).
    const normalizado = normalizarTelefonoWa(telefonoE164);
    if (normalizado === "") return null;

    const rows = await this.prisma.$queryRaw<OrdenResolucionRaw[]>(Prisma.sql`
      SELECT id, mensajero_asignado_id, telefono_dest
      FROM orden
      WHERE deleted_at IS NULL
        AND mensajero_asignado_id IS NOT NULL
        AND regexp_replace(telefono_dest, '[^0-9]', '', 'g') = ${normalizado}
      ORDER BY asignado_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `);

    const row = rows[0];
    if (row === undefined || row.mensajero_asignado_id === null) return null;
    return {
      ordenId: row.id,
      mensajeroId: row.mensajero_asignado_id,
      // El hilo se keyea SIEMPRE con el numero normalizado (clave estable).
      telefonoE164: normalizarTelefonoWa(row.telefono_dest),
    };
  }

  async upsertParaOrden(input: UpsertHiloInput): Promise<ChatConversacionDTO> {
    // R13: get-or-create por el unico (orden_id, telefono_e164). En update solo se refresca
    // `mensajero_id` (reasignaciones) y el `updated_at`; `ultimo_entrante_at` no se toca aqui.
    // El telefono se NORMALIZA aqui (solo digitos) para que la clave del hilo sea estable sin
    // importar el formato del caller (`+573…` vs `573…`): asi nunca se crean hilos duplicados.
    const telefonoE164 = normalizarTelefonoWa(input.telefonoE164);
    const row = await this.prisma.chatConversacion.upsert({
      where: {
        ordenId_telefonoE164: {
          ordenId: input.ordenId,
          telefonoE164,
        },
      },
      create: {
        ordenId: input.ordenId,
        telefonoE164,
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
    // Desempate DETERMINISTA: si por datos legados existiera mas de un hilo para la misma
    // (orden, mensajero), gana el que tiene ACTIVIDAD ENTRANTE mas reciente (nunca el vacio);
    // los `null` (sin entrantes) van al final. Con la normalizacion del telefono ya no deberia
    // haber duplicados, pero esto blinda la lectura del panel contra el hilo equivocado.
    const row = await this.prisma.chatConversacion.findFirst({
      where: { ordenId, mensajeroId },
      orderBy: [{ ultimoEntranteAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
  }

  async contarNoLeidosPorMensajero(mensajeroId: string): Promise<NoLeidosPorOrden[]> {
    // Va RAW porque la condicion de "no leido" compara dos tablas (`chat_mensaje.ocurrido_at`
    // contra `chat_conversacion.mensajero_leido_at`) dentro del propio JOIN, y el `groupBy` de
    // Prisma no expresa una correlacion asi sin traerse los mensajes a memoria.
    //
    // `mensajero_leido_at IS NULL` = nunca abierto -> cuentan TODOS los entrantes.
    // Se agrupa por `orden_id` (no por hilo): si por datos legados hubiera mas de un hilo para
    // la misma orden, la UI —que lista ordenes— ve un solo numero, la suma.
    const rows = await this.prisma.$queryRaw<NoLeidosRaw[]>(Prisma.sql`
      SELECT c.orden_id AS orden_id, COUNT(m.id)::int AS no_leidos
      FROM chat_conversacion c
      JOIN chat_mensaje m ON m.conversacion_id = c.id
      WHERE c.mensajero_id = ${mensajeroId}
        AND m.direccion = 'entrante'::"chat_mensaje_direccion"
        AND (c.mensajero_leido_at IS NULL OR m.ocurrido_at > c.mensajero_leido_at)
      GROUP BY c.orden_id
    `);
    return rows.map((r) => ({ ordenId: r.orden_id, noLeidos: Number(r.no_leidos) }));
  }

  async marcarLeidoHastaUltimoEntrante(
    ordenId: string,
    mensajeroId: string,
  ): Promise<void> {
    // La marca sale del propio hilo (subconsulta), NO de `now()`: sellar con la hora del
    // servidor daria por leido un entrante llegado un instante antes de este UPDATE y que el
    // mensajero no ha visto. `GREATEST` impide RETROCEDER la marca si el sellado llega
    // desordenado (dos pestanas, un reintento tardio).
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE chat_conversacion c
      SET mensajero_leido_at = GREATEST(
        c.mensajero_leido_at,
        (SELECT MAX(m.ocurrido_at)
           FROM chat_mensaje m
          WHERE m.conversacion_id = c.id
            AND m.direccion = 'entrante'::"chat_mensaje_direccion")
      ),
      updated_at = NOW()
      WHERE c.orden_id = ${ordenId}
        AND c.mensajero_id = ${mensajeroId}
    `);
  }

  async findById(id: string): Promise<ChatConversacionDTO | null> {
    const row = await this.prisma.chatConversacion.findUnique({
      where: { id },
      select: SELECT,
    });
    return row === null ? null : toDTO(row);
  }
}
