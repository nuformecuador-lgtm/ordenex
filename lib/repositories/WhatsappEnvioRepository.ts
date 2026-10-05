import type { Prisma, PrismaClient, RolValue } from "@prisma/client";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import {
  EnvioNombreDuplicadoError,
  type DestinatarioResuelto,
  type EnvioDetalle,
  type EnvioProgramable,
  type GuardarEnvioData,
  type IWhatsappEnvioRepository,
  type JobProgramadoPendiente,
  type SeleccionDestinatarios,
} from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";

// Ficha 474 (design §1.2/§1.3/§4, T6.1) — repositorio de ENVIOS configurados. Solo queries: las
// reglas viven en `WhatsappEnvioService`. Las consultas que deciden algo en un WHERE (vigentes,
// encendidos, activos, job pendiente) se prueban CONTRA POSTGRES en `tests/integration/db/`
// (memoria «probar el WHERE donde vive»).

type EnvioPrismaClient = Pick<
  PrismaClient,
  "whatsappEnvio" | "whatsappEnvioDestinatario" | "usuario" | "$transaction" | "$queryRaw"
>;

const VIGENTE = { deletedAt: null } as const;

const DETALLE_INCLUDE = {
  destinatarios: { select: { rol: true, usuarioId: true } },
} as const;

type FilaDetalle = Prisma.WhatsappEnvioGetPayload<{ include: typeof DETALLE_INCLUDE }>;

function aDetalle(r: FilaDetalle): EnvioDetalle {
  const roles: RolValue[] = [];
  const usuarioIds: string[] = [];
  for (const d of r.destinatarios) {
    if (d.rol !== null) roles.push(d.rol);
    if (d.usuarioId !== null) usuarioIds.push(d.usuarioId);
  }
  return {
    id: r.id,
    nombre: r.nombre,
    informeClave: r.informeClave,
    plantillaId: r.plantillaId,
    parametros: r.parametros,
    disparo: r.disparo,
    diasSemana: r.diasSemana ?? [],
    hora: r.hora,
    eventoClave: r.eventoClave,
    activo: r.activo,
    destinatarios: { roles, usuarioIds },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}

function filasDestinatarios(sel: SeleccionDestinatarios): { rol?: RolValue; usuarioId?: string }[] {
  return [
    ...[...new Set(sel.roles)].map((rol) => ({ rol })),
    ...[...new Set(sel.usuarioIds)].map((usuarioId) => ({ usuarioId })),
  ];
}

function mapDuplicado(error: unknown): unknown {
  const texto = textoConstraintP2002(error);
  if (texto && texto.includes("nombre")) return new EnvioNombreDuplicadoError();
  return error;
}

export class WhatsappEnvioRepository implements IWhatsappEnvioRepository {
  constructor(private readonly prisma: EnvioPrismaClient) {}

  async crear(data: GuardarEnvioData): Promise<EnvioDetalle> {
    try {
      const r = await this.prisma.whatsappEnvio.create({
        data: {
          nombre: data.nombre,
          informeClave: data.informeClave,
          plantillaId: data.plantillaId,
          parametros: data.parametros as Prisma.InputJsonValue,
          disparo: data.disparo,
          diasSemana: data.diasSemana,
          hora: data.hora,
          eventoClave: data.eventoClave,
          // R15: `activo` NO se escribe: el default de la columna es `false`.
          createdBy: data.actorId,
          updatedBy: data.actorId,
          destinatarios: { create: filasDestinatarios(data.destinatarios) },
        },
        include: DETALLE_INCLUDE,
      });
      return aDetalle(r);
    } catch (error) {
      throw mapDuplicado(error);
    }
  }

  async actualizar(id: string, data: GuardarEnvioData): Promise<EnvioDetalle | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const res = await tx.whatsappEnvio.updateMany({
          where: { id, ...VIGENTE },
          data: {
            nombre: data.nombre,
            informeClave: data.informeClave,
            plantillaId: data.plantillaId,
            parametros: data.parametros as Prisma.InputJsonValue,
            disparo: data.disparo,
            diasSemana: data.diasSemana,
            hora: data.hora,
            eventoClave: data.eventoClave,
            updatedBy: data.actorId,
          },
        });
        if (res.count === 0) return null;
        await tx.whatsappEnvioDestinatario.deleteMany({ where: { envioId: id } });
        const filas = filasDestinatarios(data.destinatarios).map((f) => ({ envioId: id, ...f }));
        if (filas.length > 0) await tx.whatsappEnvioDestinatario.createMany({ data: filas });
        const r = await tx.whatsappEnvio.findFirst({ where: { id }, include: DETALLE_INCLUDE });
        return r === null ? null : aDetalle(r);
      });
    } catch (error) {
      throw mapDuplicado(error);
    }
  }

  async obtener(id: string, opts: { incluirBorrados?: boolean } = {}): Promise<EnvioDetalle | null> {
    const r = await this.prisma.whatsappEnvio.findFirst({
      where: opts.incluirBorrados ? { id } : { id, ...VIGENTE },
      include: DETALLE_INCLUDE,
    });
    return r === null ? null : aDetalle(r);
  }

  async listar(): Promise<EnvioDetalle[]> {
    const rows = await this.prisma.whatsappEnvio.findMany({
      where: VIGENTE,
      include: DETALLE_INCLUDE,
      orderBy: [{ nombre: "asc" }, { id: "asc" }],
    });
    return rows.map(aDetalle);
  }

  async cambiarActivo(id: string, activo: boolean, actorId: string | null): Promise<boolean> {
    const r = await this.prisma.whatsappEnvio.updateMany({
      where: { id, ...VIGENTE },
      data: { activo, updatedBy: actorId },
    });
    return r.count > 0;
  }

  async borrar(id: string, actorId: string | null): Promise<boolean> {
    // R21: soft delete Y apagado en la misma escritura: un borrado nunca queda encendido.
    const r = await this.prisma.whatsappEnvio.updateMany({
      where: { id, ...VIGENTE },
      data: { deletedAt: new Date(), activo: false, updatedBy: actorId },
    });
    return r.count > 0;
  }

  async resolverDestinatariosDe(
    sel: SeleccionDestinatarios,
    rolesPermitidos: readonly RolValue[],
  ): Promise<DestinatarioResuelto[]> {
    if (sel.roles.length === 0 && sel.usuarioIds.length === 0) return [];
    // R28: union (roles ∪ usuarios), SOLO `activo`, SOLO roles permitidos, una fila por usuario
    // (dedup natural: es una consulta sobre `usuario`), orden estable por nombre.
    const rows = await this.prisma.usuario.findMany({
      where: {
        estado: "activo",
        rol: { value: { in: [...rolesPermitidos] } },
        OR: [{ rol: { value: { in: sel.roles } } }, { id: { in: sel.usuarioIds } }],
      },
      select: { id: true, nombre: true, telefono: true, rol: { select: { value: true } } },
      orderBy: [{ nombre: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => ({ usuarioId: r.id, nombre: r.nombre, telefono: r.telefono, rol: r.rol.value }));
  }

  async resolverDestinatarios(
    envioId: string,
    rolesPermitidos: readonly RolValue[],
  ): Promise<DestinatarioResuelto[]> {
    const filas = await this.prisma.whatsappEnvioDestinatario.findMany({
      where: { envioId },
      select: { rol: true, usuarioId: true },
    });
    const sel: SeleccionDestinatarios = {
      roles: filas.flatMap((f) => (f.rol !== null ? [f.rol] : [])),
      usuarioIds: filas.flatMap((f) => (f.usuarioId !== null ? [f.usuarioId] : [])),
    };
    return this.resolverDestinatariosDe(sel, rolesPermitidos);
  }

  async rolesDeUsuarios(usuarioIds: string[]): Promise<{ id: string; rol: RolValue }[]> {
    if (usuarioIds.length === 0) return [];
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: usuarioIds } },
      select: { id: true, rol: { select: { value: true } } },
    });
    return rows.map((r) => ({ id: r.id, rol: r.rol.value }));
  }

  async nombresEncendidosConPlantilla(plantillaId: string): Promise<string[]> {
    const rows = await this.prisma.whatsappEnvio.findMany({
      where: { plantillaId, activo: true, ...VIGENTE },
      select: { nombre: true },
      orderBy: { nombre: "asc" },
    });
    return rows.map((r) => r.nombre);
  }

  async hayEncendidosConEvento(evento: string): Promise<boolean> {
    // R26/R50: la UNICA consulta del puente en el camino del aviso. El predicado es EXACTAMENTE el
    // del indice parcial `whatsapp_envio_evento_encendido_idx`: con todo apagado, un index scan
    // vacio y cero escrituras.
    const rows = await this.prisma.$queryRaw<{ uno: number }[]>`
      SELECT 1 AS "uno" FROM "whatsapp_envio"
      WHERE "evento_clave" = ${evento}
        AND "activo" AND "deleted_at" IS NULL AND "disparo" = 'evento'
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async encendidosConEvento(evento: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "whatsapp_envio"
      WHERE "evento_clave" = ${evento}
        AND "activo" AND "deleted_at" IS NULL AND "disparo" = 'evento'
      ORDER BY "nombre", "id"
    `;
    return rows.map((r) => r.id);
  }

  async encendidosHoraFijaSinJobPendiente(): Promise<EnvioProgramable[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; dias_semana: number[] | null; hora: string | null }[]>`
      SELECT e."id", e."dias_semana", e."hora"
      FROM "whatsapp_envio" e
      WHERE e."activo" AND e."deleted_at" IS NULL AND e."disparo" = 'hora_fija'
        AND NOT EXISTS (
          SELECT 1 FROM "jobs" j
          WHERE j."tipo" = 'whatsapp_envio_programado'
            AND j."estado" = 'pending'
            AND j."payload"->>'envioId' = e."id"
        )
      ORDER BY e."id"
    `;
    return rows.flatMap((r) =>
      r.hora === null ? [] : [{ id: r.id, diasSemana: (r.dias_semana ?? []).map(Number), hora: r.hora }],
    );
  }

  async jobsProgramadosPendientes(envioIds: string[]): Promise<JobProgramadoPendiente[]> {
    if (envioIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { envio_id: string; fecha_cr: string | null; hora: string | null; run_after: Date }[]
    >`
      SELECT j."payload"->>'envioId' AS "envio_id",
             j."payload"->>'fechaCr' AS "fecha_cr",
             j."payload"->>'hora' AS "hora",
             j."run_after"
      FROM "jobs" j
      WHERE j."tipo" = 'whatsapp_envio_programado'
        AND j."estado" = 'pending'
        AND j."payload"->>'envioId' = ANY(${envioIds}::text[])
      ORDER BY j."run_after"
    `;
    return rows.flatMap((r) =>
      r.fecha_cr === null || r.hora === null
        ? []
        : [{ envioId: r.envio_id, fechaCr: r.fecha_cr, hora: r.hora, runAfter: r.run_after }],
    );
  }
}
