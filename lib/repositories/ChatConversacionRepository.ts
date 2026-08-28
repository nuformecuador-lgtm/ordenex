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
import { sqlNormalizarTelefonoCr } from "@/lib/utils/telefono-cr-sql";

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
    // El match del telefono se hace NORMALIZADO EN AMBOS LADOS, y "normalizado" significa
    // exactamente lo que hace `normalizarTelefonoCR`, no un simple quitar-separadores:
    //
    //   BUG QUE ARREGLA ESTO. Antes el lado de la COLUMNA solo aplicaba
    //   `regexp_replace(telefono_dest, '[^0-9]', '', 'g')` mientras el entrante venia ya
    //   prefijado con `506` por `normalizarTelefonoWa`. Una orden de Costa Rica guardada en
    //   formato LOCAL (`8888-7777`, que es como las carga el negocio) daba `88887777` contra un
    //   entrante `50688887777`: NUNCA casaban. El webhook contaba el evento como `sinResolver`,
    //   respondia 200 y el mensaje se perdia sin dejar rastro (Meta no reintenta un 200). El
    //   caso no-CR no lo delataba porque esos numeros ya se guardan con su indicativo.
    //
    // La expresion de la columna vive en `sqlNormalizarTelefonoCr` (una sola copia, vigilada
    // contra la funcion de TypeScript por `chat-entrante-telefono-cr.test.ts`). Prisma no puede
    // normalizar una columna en el WHERE, por eso va raw; el numero viaja como PARAMETRO y el
    // unico texto interpolado es un identificador literal de este archivo (sin inyeccion).
    const normalizado = normalizarTelefonoWa(telefonoE164);
    if (normalizado === "") return null;

    const telefonoNormalizado = Prisma.raw(sqlNormalizarTelefonoCr("o.telefono_dest"));
    const rows = await this.prisma.$queryRaw<OrdenResolucionRaw[]>(Prisma.sql`
      SELECT o.id, o.mensajero_asignado_id, o.telefono_dest
      FROM orden o
      WHERE o.deleted_at IS NULL
        AND o.mensajero_asignado_id IS NOT NULL
        AND ${telefonoNormalizado} = ${normalizado}
      ORDER BY o.asignado_at DESC NULLS LAST, o.created_at DESC
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

  async migrarTelefono(anterior: string, nuevo: string): Promise<number> {
    // Feature 308 (design §3, R16/R18): el cliente cambio de numero -> los hilos que hoy
    // tienen el numero ANTERIOR pasan a tener el NUEVO. Ambos lados se normalizan aqui por la
    // misma razon que en `upsertParaOrden`: la clave del hilo es siempre el numero canonico.
    //
    // LO QUE ESTA MIGRACION *NO* HACE (limitacion conocida, DECISION DEL HUMANO del 2026-08-27;
    // ver el bloque «LIMITACION CONOCIDA» bajo R16 en
    // `specs/308-chat-media-reacciones-contactos/requirements.md`):
    //
    //   NO consigue que los mensajes posteriores del cliente caigan en este hilo. Un entrante
    //   se resuelve a su orden por `orden.telefono_dest` (ver `resolverOrdenActivaPorNumero`,
    //   arriba en este mismo archivo), NO por el `telefono_e164` del hilo; y R17 prohibe tocar
    //   ese campo del maestro. Asi que un mensaje enviado desde el numero NUEVO no resuelve
    //   ninguna orden: se cuenta `sinResolver`, el webhook responde 200 y el mensaje no llega
    //   a nadie (Meta no reintenta un 200).
    //
    // El UPDATE de aqui deja el hilo COHERENTE y sostiene la EVIDENCIA del cambio (la burbuja
    // de sistema de R18/R32), que es exactamente el alcance que el humano eligio tras evaluar
    // las tres salidas (tabla de alias, escribir `orden.telefono_dest`, o dejarlo asi).
    // NO es un descuido: fijado por el test
    // «LIMITACION CONOCIDA (decision humana 2026-08-27): un entrante desde el numero NUEVO NO
    // resuelve orden y se cuenta sinResolver» en
    // `tests/unit/services/chat-whatsapp-service.test.ts`. Si vienes a «arreglarlo» tocando el
    // maestro, primero reabre R16/R17 con el humano.
    const antes = normalizarTelefonoWa(anterior);
    const despues = normalizarTelefonoWa(nuevo);
    // Sin numero utilizable, o con el mismo numero a ambos lados, no hay nada que migrar. Se
    // devuelve 0 (desenlace valido) en vez de lanzar: la ingesta del lote no puede romperse.
    if (antes === "" || despues === "" || antes === despues) return 0;

    // EL `NOT EXISTS` ES EL "ON CONFLICT DO NOTHING" (P5). El unico `(orden_id, telefono_e164)`
    // hace que migrar una fila cuya orden YA tiene hilo con el numero nuevo viole la
    // restriccion y aborte la transaccion entera del webhook. Filtrar esas filas ANTES del
    // UPDATE es lo que deja el evento sin fusionar hilos, sin lanzar y sin romper el 200: el
    // hilo destino existente se queda como esta y la evidencia se registra igual (R18).
    //
    // NO se toca `orden` ni `cliente` (R17): este UPDATE escribe solo en `chat_conversacion`.
    return await this.prisma.$executeRaw(Prisma.sql`
      UPDATE chat_conversacion c
      SET telefono_e164 = ${despues}, updated_at = NOW()
      WHERE c.telefono_e164 = ${antes}
        AND NOT EXISTS (
          SELECT 1 FROM chat_conversacion otro
          WHERE otro.orden_id = c.orden_id
            AND otro.telefono_e164 = ${despues}
        )
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
