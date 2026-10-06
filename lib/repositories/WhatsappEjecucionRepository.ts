import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type WhatsappEjecucionEstado,
  type WhatsappEntregaEstado,
} from "@prisma/client";
import type {
  DesenlaceEntrega,
  EjecucionFila,
  EntregaDetalle,
  EntregaFila,
  EstadoWebhookEntrega,
  FijarContenidoData,
  HistorialEjecucionItem,
  HistorialFiltro,
  InsercionIdempotente,
  IWhatsappEjecucionRepository,
  NuevaEntrega,
} from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { DatosAviso } from "@/lib/whatsapp-envios/informes/tipos";
import { enmascararTelefono } from "@/lib/whatsapp-envios/telefono";

// Ficha 474 (design §1.4/§1.5/§4.3/§5.4, T6.2) — EJECUCIONES y ENTREGAS. Solo queries.
//
// La idempotencia es SQL, y por eso se prueba contra Postgres: los `INSERT … ON CONFLICT DO
// NOTHING` apuntan a los unicos PARCIALES de la migracion (el predicado del `ON CONFLICT` tiene que
// coincidir con el del indice para que Postgres lo infiera), y el reclamo de la entrega es un
// `UPDATE` condicional cuya fila afectada decide quien envia.

type EjecucionPrismaClient = Pick<
  PrismaClient,
  "whatsappEnvioEjecucion" | "whatsappEnvioEntrega" | "$queryRaw" | "$executeRaw"
>;

function fechaIso(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(0, 10);
}

function comoValores(v: unknown): Record<string, string> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const salida: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x !== "string") return null;
    salida[k] = x;
  }
  return salida;
}

function comoDatosAviso(v: unknown): DatosAviso | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.texto !== "string" || typeof o.rolFila !== "string" || typeof o.creadoAt !== "string") return null;
  return { texto: o.texto, rolFila: o.rolFila as DatosAviso["rolFila"], creadoAt: o.creadoAt };
}

const SELECT_ENTREGA = {
  id: true,
  ejecucionId: true,
  usuarioId: true,
  destinatarioNombre: true,
  telefono: true,
  estado: true,
  motivo: true,
  intentos: true,
} as const;

export class WhatsappEjecucionRepository implements IWhatsappEjecucionRepository {
  constructor(private readonly prisma: EjecucionPrismaClient) {}

  async insertarProgramada(data: {
    envioId: string;
    fechaCr: string;
    instanteProgramado: Date;
    estado?: "pendiente" | "omitida";
    motivo?: string | null;
  }): Promise<InsercionIdempotente> {
    const id = randomUUID();
    const estado = data.estado ?? "pendiente";
    const terminada = estado === "omitida";
    const insertadas = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "whatsapp_envio_ejecucion"
        ("id","envio_id","origen","fecha_cr","instante_programado","estado","motivo","terminada_at","updated_at")
      VALUES (${id}, ${data.envioId}, 'programado', ${data.fechaCr}::date, ${data.instanteProgramado},
              ${estado}::"whatsapp_ejecucion_estado", ${data.motivo ?? null},
              ${terminada ? new Date() : null}, CURRENT_TIMESTAMP)
      ON CONFLICT ("envio_id","fecha_cr") WHERE "origen" = 'programado' DO NOTHING
      RETURNING "id"
    `;
    if (insertadas.length > 0) return { id: insertadas[0].id, creada: true };
    const existente = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "whatsapp_envio_ejecucion"
      WHERE "envio_id" = ${data.envioId} AND "fecha_cr" = ${data.fechaCr}::date AND "origen" = 'programado'
    `;
    if (existente.length === 0) throw new Error("ejecucion programada en conflicto pero inexistente");
    return { id: existente[0].id, creada: false };
  }

  async insertarEvento(data: {
    envioId: string;
    eventoClave: string;
    eventoReferencia: string;
    eventoDatos: DatosAviso;
    notificacionId: string | null;
  }): Promise<InsercionIdempotente> {
    const id = randomUUID();
    const datos = JSON.stringify(data.eventoDatos);
    const insertadas = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "whatsapp_envio_ejecucion"
        ("id","envio_id","origen","evento_clave","evento_referencia","evento_datos","notificacion_id","estado","updated_at")
      VALUES (${id}, ${data.envioId}, 'evento', ${data.eventoClave}, ${data.eventoReferencia},
              ${datos}::jsonb, ${data.notificacionId}, 'pendiente', CURRENT_TIMESTAMP)
      ON CONFLICT ("envio_id","evento_clave","evento_referencia") WHERE "origen" = 'evento' DO NOTHING
      RETURNING "id"
    `;
    if (insertadas.length > 0) return { id: insertadas[0].id, creada: true };
    const existente = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "whatsapp_envio_ejecucion"
      WHERE "envio_id" = ${data.envioId} AND "evento_clave" = ${data.eventoClave}
        AND "evento_referencia" = ${data.eventoReferencia} AND "origen" = 'evento'
    `;
    if (existente.length === 0) throw new Error("ejecucion de evento en conflicto pero inexistente");
    return { id: existente[0].id, creada: false };
  }

  async insertarPrueba(data: { envioId: string; solicitadaPor: string }): Promise<string> {
    const r = await this.prisma.whatsappEnvioEjecucion.create({
      data: { envioId: data.envioId, origen: "prueba", solicitadaPor: data.solicitadaPor },
      select: { id: true },
    });
    return r.id;
  }

  async obtener(id: string): Promise<EjecucionFila | null> {
    const r = await this.prisma.whatsappEnvioEjecucion.findUnique({ where: { id } });
    if (r === null) return null;
    return {
      id: r.id,
      envioId: r.envioId,
      origen: r.origen,
      fechaCr: fechaIso(r.fechaCr),
      instanteProgramado: r.instanteProgramado,
      eventoClave: r.eventoClave,
      eventoReferencia: r.eventoReferencia,
      eventoDatos: comoDatosAviso(r.eventoDatos),
      notificacionId: r.notificacionId,
      solicitadaPor: r.solicitadaPor,
      estado: r.estado,
      motivo: r.motivo,
      plantillaId: r.plantillaId,
      plantillaNombre: r.plantillaNombre,
      valores: comoValores(r.valores),
      pdfRuta: r.pdfRuta,
      pdfNombre: r.pdfNombre,
      mediaId: r.mediaId,
      createdAt: r.createdAt,
    };
  }

  async cambiarEstado(
    id: string,
    estado: WhatsappEjecucionEstado,
    opts: { motivo?: string | null; terminada?: boolean } = {},
  ): Promise<void> {
    await this.prisma.whatsappEnvioEjecucion.update({
      where: { id },
      data: {
        estado,
        ...(opts.motivo !== undefined ? { motivo: opts.motivo } : {}),
        ...(opts.terminada ? { terminadaAt: new Date() } : {}),
      },
    });
  }

  async fijarContenido(id: string, data: FijarContenidoData): Promise<boolean> {
    // R35: UNA sola vez. Si dos corridas llegan a la vez, la segunda no pisa a la primera.
    const r = await this.prisma.whatsappEnvioEjecucion.updateMany({
      where: { id, valores: { equals: Prisma.DbNull } },
      data: {
        valores: data.valores,
        plantillaId: data.plantillaId,
        plantillaNombre: data.plantillaNombre,
        parametros: data.parametros as Prisma.InputJsonValue,
        ...(data.pdf !== null
          ? {
              pdfRuta: data.pdf.ruta,
              pdfNombre: data.pdf.nombre,
              pdfBytes: data.pdf.bytes,
              pdfCaducaAt: data.pdf.caducaAt,
            }
          : {}),
      },
    });
    return r.count > 0;
  }

  async fijarMediaId(id: string, mediaId: string): Promise<void> {
    await this.prisma.whatsappEnvioEjecucion.update({ where: { id }, data: { mediaId } });
  }

  async insertarEntregas(ejecucionId: string, entregas: NuevaEntrega[]): Promise<void> {
    for (const e of entregas) {
      await this.prisma.$executeRaw`
        INSERT INTO "whatsapp_envio_entrega"
          ("id","ejecucion_id","usuario_id","destinatario_nombre","telefono","estado","motivo","updated_at")
        VALUES (${randomUUID()}, ${ejecucionId}, ${e.usuarioId}, ${e.destinatarioNombre}, ${e.telefono},
                ${e.estado}::"whatsapp_entrega_estado", ${e.motivo}, CURRENT_TIMESTAMP)
        ON CONFLICT ("ejecucion_id","usuario_id") DO NOTHING
      `;
    }
  }

  async entregasPendientes(ejecucionId: string): Promise<EntregaFila[]> {
    return this.prisma.whatsappEnvioEntrega.findMany({
      where: { ejecucionId, estado: "pendiente" },
      select: SELECT_ENTREGA,
      orderBy: [{ destinatarioNombre: "asc" }, { id: "asc" }],
    });
  }

  async obtenerEntrega(id: string): Promise<EntregaFila | null> {
    return this.prisma.whatsappEnvioEntrega.findUnique({ where: { id }, select: SELECT_ENTREGA });
  }

  async reclamarEntrega(id: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "whatsapp_envio_entrega"
      SET "estado" = 'en_curso', "intentos" = "intentos" + 1, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "estado" = 'pendiente'
    `;
    return n > 0;
  }

  async resolverEntrega(id: string, d: DesenlaceEntrega): Promise<boolean> {
    const data: Prisma.WhatsappEnvioEntregaUpdateManyMutationInput =
      d.estado === "aceptada"
        ? { estado: "aceptada", waMessageId: d.waMessageId, enviadaAt: d.ahora, motivo: null }
        : d.estado === "rechazo_permanente"
          ? { estado: "rechazo_permanente", codigoMeta: d.codigoMeta, motivo: d.motivo }
          : { estado: d.estado, motivo: d.motivo };
    const r = await this.prisma.whatsappEnvioEntrega.updateMany({
      where: { id, estado: "en_curso" },
      data,
    });
    return r.count > 0;
  }

  async aplicarEstadoWebhook(
    waMessageId: string,
    estado: EstadoWebhookEntrega,
    motivo: string | null,
  ): Promise<number> {
    // R38: NUNCA retrocede. Rango: aceptada 1 < enviada 2 < recibida 3 < leida 4. `fallida`
    // vale 3 para la comparacion: solo pisa aceptada/enviada (una recibida no «falla» despues).
    return this.prisma.$executeRaw`
      UPDATE "whatsapp_envio_entrega"
      SET "estado" = ${estado}::"whatsapp_entrega_estado",
          "motivo" = CASE WHEN ${estado} = 'fallida' THEN ${motivo} ELSE "motivo" END,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "wa_message_id" = ${waMessageId}
        AND (CASE "estado"
               WHEN 'aceptada' THEN 1 WHEN 'enviada' THEN 2
               WHEN 'recibida' THEN 3 WHEN 'leida' THEN 4 ELSE 99 END)
          < (CASE ${estado}
               WHEN 'enviada' THEN 2 WHEN 'recibida' THEN 3
               WHEN 'leida' THEN 4 WHEN 'fallida' THEN 3 ELSE 0 END)
    `;
  }

  async ultimaPruebaDe(solicitadaPor: string, envioId: string): Promise<Date | null> {
    const r = await this.prisma.whatsappEnvioEjecucion.findFirst({
      where: { solicitadaPor, envioId, origen: "prueba" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return r?.createdAt ?? null;
  }

  async historial(f: HistorialFiltro): Promise<{ items: HistorialEjecucionItem[]; total: number }> {
    const where: Prisma.WhatsappEnvioEjecucionWhereInput = f.envioId !== undefined ? { envioId: f.envioId } : {};
    const [filas, total] = await Promise.all([
      this.prisma.whatsappEnvioEjecucion.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        select: SELECT_HISTORIAL,
      }),
      this.prisma.whatsappEnvioEjecucion.count({ where }),
    ]);
    const conteos = await this.conteosDe(filas.map((x) => x.id));
    return { items: filas.map((x) => aItemHistorial(x, conteos.get(x.id) ?? {})), total };
  }

  async detalle(id: string): Promise<{ ejecucion: HistorialEjecucionItem; entregas: EntregaDetalle[] } | null> {
    const fila = await this.prisma.whatsappEnvioEjecucion.findUnique({ where: { id }, select: SELECT_HISTORIAL });
    if (fila === null) return null;
    const entregas = await this.prisma.whatsappEnvioEntrega.findMany({
      where: { ejecucionId: id },
      orderBy: [{ destinatarioNombre: "asc" }, { id: "asc" }],
      select: { id: true, destinatarioNombre: true, telefono: true, estado: true, motivo: true, enviadaAt: true, updatedAt: true },
    });
    const conteos = await this.conteosDe([id]);
    return {
      ejecucion: aItemHistorial(fila, conteos.get(id) ?? {}),
      entregas: entregas.map((e) => ({
        id: e.id,
        destinatarioNombre: e.destinatarioNombre,
        telefonoEnmascarado: enmascararTelefono(e.telefono), // R42: el completo no sale de aqui
        estado: e.estado,
        motivo: e.motivo,
        instante: e.enviadaAt ?? e.updatedAt,
      })),
    };
  }

  async seleccionarPurga(ahora: Date, limite: number): Promise<{ id: string; pdfRuta: string }[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; pdf_ruta: string }[]>`
      SELECT "id", "pdf_ruta" FROM "whatsapp_envio_ejecucion"
      WHERE "pdf_ruta" IS NOT NULL AND "pdf_purgado_at" IS NULL AND "pdf_caduca_at" < ${ahora}
      ORDER BY "pdf_caduca_at"
      LIMIT ${limite}
    `;
    return rows.map((r) => ({ id: r.id, pdfRuta: r.pdf_ruta }));
  }

  async marcarPurgadas(ids: string[], ahora: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.whatsappEnvioEjecucion.updateMany({
      where: { id: { in: ids }, pdfPurgadoAt: null },
      data: { pdfPurgadoAt: ahora },
    });
  }

  async ultimaPorEnvio(
    envioIds: string[],
  ): Promise<Map<string, { instante: Date; estado: WhatsappEjecucionEstado }>> {
    const salida = new Map<string, { instante: Date; estado: WhatsappEjecucionEstado }>();
    if (envioIds.length === 0) return salida;
    const rows = await this.prisma.$queryRaw<{ envio_id: string; created_at: Date; estado: WhatsappEjecucionEstado }[]>`
      SELECT DISTINCT ON ("envio_id") "envio_id", "created_at", "estado"
      FROM "whatsapp_envio_ejecucion"
      WHERE "envio_id" = ANY(${envioIds}::text[]) AND "origen" <> 'prueba'
      ORDER BY "envio_id", "created_at" DESC
    `;
    for (const r of rows) salida.set(r.envio_id, { instante: r.created_at, estado: r.estado });
    return salida;
  }

  async pdfDe(id: string): Promise<{ ruta: string | null; purgado: boolean } | null> {
    const r = await this.prisma.whatsappEnvioEjecucion.findUnique({
      where: { id },
      select: { pdfRuta: true, pdfPurgadoAt: true },
    });
    return r === null ? null : { ruta: r.pdfRuta, purgado: r.pdfPurgadoAt !== null };
  }

  private async conteosDe(ids: string[]): Promise<Map<string, Partial<Record<WhatsappEntregaEstado, number>>>> {
    const salida = new Map<string, Partial<Record<WhatsappEntregaEstado, number>>>();
    if (ids.length === 0) return salida;
    const grupos = await this.prisma.whatsappEnvioEntrega.groupBy({
      by: ["ejecucionId", "estado"],
      where: { ejecucionId: { in: ids } },
      _count: { _all: true },
    });
    for (const g of grupos) {
      const c = salida.get(g.ejecucionId) ?? {};
      c[g.estado] = g._count._all;
      salida.set(g.ejecucionId, c);
    }
    return salida;
  }
}

const SELECT_HISTORIAL = {
  id: true,
  envioId: true,
  origen: true,
  createdAt: true,
  estado: true,
  motivo: true,
  plantillaNombre: true,
  pdfNombre: true,
  pdfRuta: true,
  pdfPurgadoAt: true,
  envio: { select: { nombre: true } },
} as const;

type FilaHistorial = Prisma.WhatsappEnvioEjecucionGetPayload<{ select: typeof SELECT_HISTORIAL }>;

function aItemHistorial(
  x: FilaHistorial,
  conteos: Partial<Record<WhatsappEntregaEstado, number>>,
): HistorialEjecucionItem {
  return {
    id: x.id,
    envioId: x.envioId,
    envioNombre: x.envio.nombre,
    origen: x.origen,
    instante: x.createdAt,
    estado: x.estado,
    motivo: x.motivo,
    plantillaNombre: x.plantillaNombre,
    conteos,
    pdf: x.pdfRuta === null ? null : { nombre: x.pdfNombre ?? "documento.pdf", caducado: x.pdfPurgadoAt !== null },
  };
}
