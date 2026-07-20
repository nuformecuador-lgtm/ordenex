import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import {
  encolarOptimizacionDebounce,
  encolarOptimizacionInmediata,
} from "@/lib/services/jobs/optimizacion-ruta-encolado";
import { loadRouteOptimizationConfig } from "@/lib/config/route-optimization";

// Feature 61: estado terminal de entrega para el KPI "entregadas" del portal.
const ESTATUS_ENTREGADA = "entregada";

type GestionPrismaClient = Pick<
  PrismaClient,
  "orden" | "usuario" | "gestionOrden" | "$transaction"
>;

// Proyeccion de "mis asignaciones": la orden + nombres legibles via relaciones ya
// existentes (patron OrdenRepository.WITH_ETIQUETA). No expone deletedAt.
const WITH_ASIGNACION = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    peso: true,
    montoCobrar: true,
    notas: true,
    mensajeroAsignadoId: true,
    estatus: { select: { value: true } },
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type AsignacionRow = Prisma.OrdenGetPayload<typeof WITH_ASIGNACION>;

function toMiAsignacionRow(row: AsignacionRow): MiAsignacionRow {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatus.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    peso: row.peso ? row.peso.toNumber() : null,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    notas: row.notas,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
    mensajeroAsignadoId: row.mensajeroAsignadoId,
  };
}

export class GestionOrdenRepository implements IGestionOrdenRepository {
  /**
   * Feature 92 (design §4.3, R16/R19): `jobRepo` se inyecta para el encolado TRANSACTIONAL
   * OUTBOX de la reoptimizacion de ruta, EXACTAMENTE como `OrdenRepository` en la 91. El
   * default apunta al repo real, asi que ninguna fabrica existente cambia.
   */
  constructor(
    private readonly prisma: GestionPrismaClient,
    private readonly jobRepo: IJobRepository = new JobRepository(
      prisma as unknown as ConstructorParameters<typeof JobRepository>[0],
    ),
    /** Reloj inyectable: el `runAfter` del debounce debe ser determinista en tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** R9/R13: filtrado por mensajero + estado en el WHERE, no borradas. */
  async findMisAsignaciones(mensajeroId: string, estados: string[]): Promise<MiAsignacionRow[]> {
    if (estados.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: {
        mensajeroAsignadoId: mensajeroId, // R13: nunca ordenes de otro mensajero
        deletedAt: null,
        estatus: { value: { in: estados } },
      },
      orderBy: { createdAt: "desc" },
      ...WITH_ASIGNACION,
    });
    return rows.map(toMiAsignacionRow);
  }

  /** Feature 61: conteo de entregadas del mensajero (KPI del portal), no borradas. */
  async contarEntregadas(mensajeroId: string): Promise<number> {
    return this.prisma.orden.count({
      where: {
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
        estatus: { value: ESTATUS_ENTREGADA },
      },
    });
  }

  /** Suma de `montoCobrar` (COD) de las entregadas del mensajero, no borradas; null -> 0. */
  async sumMontoCobrarEntregadas(mensajeroId: string): Promise<number> {
    const agg = await this.prisma.orden.aggregate({
      _sum: { montoCobrar: true },
      where: {
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
        estatus: { value: ESTATUS_ENTREGADA },
      },
    });
    return agg._sum.montoCobrar ? agg._sum.montoCobrar.toNumber() : 0;
  }

  /** R27/R31: filas por id INCLUYENDO borradas (el service distingue el motivo). */
  async findByIdsParaGestion(ids: string[]): Promise<OrdenGestionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        deletedAt: true,
        mensajeroAsignadoId: true,
        montoCobrar: true,
        zonaId: true, // feature 47/R5: insumo del ruteo a bodega responsable en un reintento
        estatus: { select: { value: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      estatusValue: r.estatus.value,
      deletedAt: r.deletedAt,
      mensajeroAsignadoId: r.mensajeroAsignadoId,
      montoCobrar: r.montoCobrar ? r.montoCobrar.toNumber() : null,
      zonaId: r.zonaId,
    }));
  }

  /** R20: puntero de bloqueo 1-a-1 del mensajero. */
  async getOrdenEnGestion(mensajeroId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: mensajeroId },
      select: { ordenEnGestionId: true },
    });
    return row?.ordenEnGestionId ?? null;
  }

  /**
   * R19-R21: fija el puntero de forma condicional e idempotente. El WHERE exige
   * que el puntero este NULL o ya apunte a `ordenId`; si apunta a otra, `count`
   * sera 0 (una fila que no cumple el filtro no se actualiza). Se distingue de
   * "el puntero ya apuntaba a ordenId" releyendo la fila.
   */
  async setOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean> {
    const result = await this.prisma.usuario.updateMany({
      where: {
        id: mensajeroId,
        OR: [{ ordenEnGestionId: null }, { ordenEnGestionId: ordenId }],
      },
      data: { ordenEnGestionId: ordenId },
    });
    if (result.count > 0) return true;
    // count 0: o bien el usuario no existe, o ya tiene OTRA orden activa. Releer
    // para confirmar el estado real (idempotencia ante carreras).
    const actual = await this.getOrdenEnGestion(mensajeroId);
    return actual === ordenId;
  }

  /**
   * R35: limpia el puntero de bloqueo del PROPIO mensajero SOLO si apunta a esa
   * orden. El WHERE guardado (`id = mensajeroId`, `ordenEnGestionId = ordenId`)
   * garantiza que nunca toca el puntero de otro actor ni limpia si apunta a otra
   * orden. Idempotente: `count 0 -> false` (no habia nada que limpiar).
   */
  async liberarOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean> {
    const result = await this.prisma.usuario.updateMany({
      where: { id: mensajeroId, ordenEnGestionId: ordenId },
      data: { ordenEnGestionId: null },
    });
    return result.count > 0;
  }

  /** R15/R16: guardia de propiedad + origen en el WHERE; devuelve filas afectadas. */
  async recogerLote(
    ordenIds: string[],
    mensajeroId: string,
    origenEstatusId: string,
    destinoEstatusId: string,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // Feature 49/#8 (R7/R8/R16): UPDATE guardado por propiedad + origen, con `RETURNING id`
    // dentro de un `$transaction` -> el append cubre EXACTAMENTE las ordenes que ganaron la
    // guarda (una que perdio la carrera / no era del mensajero / no estaba en el origen no
    // aparece en el RETURNING, no deja rastro). El actor es el propio mensajero (`mensajeroId`
    // ya es `actor.usuarioId`); origen = `origenEstatusId` (fijado por la guarda). `updated_at`
    // se fija a mano (el raw no dispara el @updatedAt de Prisma). Devuelve el count de filas.
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "orden"
        SET "estatus_id" = ${destinoEstatusId},
            "updated_at" = NOW()
        WHERE "id" IN (${Prisma.join(ordenIds)})
          AND "mensajero_asignado_id" = ${mensajeroId}
          AND "estatus_id" = ${origenEstatusId}
          AND "deleted_at" IS NULL
        RETURNING "id"`;
      await appendCambioEstado(
        tx,
        rows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: origenEstatusId, // en_espera_aceptacion (fijado por la guarda)
          estatusDestinoId: destinoEstatusId, // en_reparto
          actorUsuarioId: mensajeroId, // R21: el mensajero que recoge
          origenTipo: "recoleccion", // R23
        })),
      );
      // Feature 92 (R16): la recogida cambia el conjunto de paradas del mensajero -> se
      // encola una reoptimizacion DIFERIDA, DENTRO de esta misma transaccion (outbox): si
      // el UPDATE revierte, el job se va con el. El debounce colapsa las 8 recogidas de
      // "recoger todas" en UN job (R17), no en ocho llamadas facturadas.
      //
      // Solo si alguna orden gano la guarda: `rows.length === 0` significa que nada
      // cambio, asi que no hay nada que reoptimizar.
      if (rows.length > 0) {
        await encolarOptimizacionDebounce(
          this.jobRepo,
          tx as unknown as JobTxClient,
          mensajeroId,
          {
            ahora: this.now(),
            debounceS: loadRouteOptimizationConfig().RUTA_DEBOUNCE_S,
          },
        );
      }
      return rows.length;
    });
  }

  /** R23/R26/R28/R30: INSERT gestion + UPDATE estatus + limpiar puntero, atomico. */
  async crearGestionYTransicionar(input: {
    ordenId: string;
    mensajeroId: string;
    gestion: GestionOrdenData;
    nuevoEstatusId: string;
    seguimiento?: { destinoEstatusId: string; limpiaMensajero: boolean };
  }): Promise<string> {
    const { ordenId, mensajeroId, gestion, nuevoEstatusId, seguimiento } = input;
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#9 (R20): estatus de ORIGEN (en_reparto) pre-leido dentro de la tx.
      const actual = await tx.orden.findFirst({
        where: { id: ordenId },
        select: { estatusId: true },
      });
      const creada = await tx.gestionOrden.create({
        data: {
          ordenId,
          mensajeroId,
          resultado: gestion.resultado,
          montoRecibido:
            gestion.montoRecibido != null ? new Prisma.Decimal(gestion.montoRecibido) : null,
          metodoPago: gestion.metodoPago ?? null,
          evidenciaStoragePath: gestion.evidenciaStoragePath ?? null,
          evidenciaContentType: gestion.evidenciaContentType ?? null,
          motivo: gestion.motivo ?? null,
          fechaReprogramacion: gestion.fechaReprogramacion
            ? new Date(`${gestion.fechaReprogramacion}T00:00:00.000Z`)
            : null,
          // Feature 73/R11/R13: la causa entra en el MISMO INSERT que la gestion, dentro de
          // la tx que cambia el estatus y aplica la transicion de seguimiento de la 47 -> si
          // algo falla, la causa NO queda persistida (atomicidad ya provista, sin firma nueva).
          causaDevolucion: gestion.causaDevolucion ?? null,
        },
        select: { id: true },
      });
      await tx.orden.update({
        where: { id: ordenId },
        data: { estatusId: nuevoEstatusId },
      });
      // R19: libera el bloqueo 1-a-1 dentro de la misma transaccion.
      await tx.usuario.update({
        where: { id: mensajeroId },
        data: { ordenEnGestionId: null },
      });
      // Feature 49/#9 (R17/R22/R20): registra la transicion (destino = resultado, actor = el
      // mensajero, `origenTipo` = gestion, `gestion_orden_id` = la gestion recien creada,
      // `motivo` = motivo de la gestion si aplica) en la MISMA tx que crea la gestion.
      await appendCambioEstado(tx, [
        {
          ordenId,
          estatusOrigenId: actual?.estatusId ?? null,
          estatusDestinoId: nuevoEstatusId,
          actorUsuarioId: mensajeroId, // R21
          origenTipo: "gestion", // R23
          motivo: gestion.motivo ?? null, // R22
          gestionOrdenId: creada.id,
        },
      ]);
      // Feature 47/#9 (R6/R7/R10/R11): transicion de SEGUIMIENTO de una gestion `devuelta`,
      // en la MISMA tx. La orden NUNCA reposa en `devuelta`: se resuelve hacia la bodega
      // responsable (reintento, limpiando el mensajero, R6) o hacia `rechazada` (escalado,
      // conservando el mensajero). El actor es NULL (sistema, no una persona): la dispara el
      // sistema como consecuencia sincrona de la devolucion. Origen = `nuevoEstatusId` (= id
      // de `devuelta`), reutilizando `origen_tipo = gestion` (sin enum nuevo, sin migracion).
      if (seguimiento) {
        await tx.orden.update({
          where: { id: ordenId },
          data: {
            estatusId: seguimiento.destinoEstatusId,
            // Feature 76/LC1 (C1): al limpiar el mensajero (reintento devuelto) limpia tambien
            // `asignado_at` (defensivo, evita un timestamp huerfano).
            ...(seguimiento.limpiaMensajero ? { mensajeroAsignadoId: null, asignadoAt: null } : {}),
          },
        });
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: nuevoEstatusId, // = id de `devuelta` (la fila que el derivador cuenta)
            estatusDestinoId: seguimiento.destinoEstatusId,
            actorUsuarioId: null, // R10: sistema, no una persona
            origenTipo: "gestion", // R14/R21: reutiliza el enum existente (sin migracion)
            gestionOrdenId: creada.id,
          },
        ]);
      }
      // Feature 92 (R19): la gestion SACA la orden de `en_reparto` -> reoptimizacion
      // INMEDIATA (sin delay), dentro de esta misma transaccion (outbox).
      //
      // ⚠️ Este encolado usa el namespace `:inmediato:`, DISJUNTO del `:debounce:`. Si
      // compartieran espacio de claves, un debounce en vuelo del mismo mensajero lo
      // tragaria EN SILENCIO via el `ON CONFLICT DO NOTHING` y la ruta no se recalcularia
      // tras la entrega. El `eventoId` es el id de la gestion recien creada: unico por
      // evento, disponible aqui sin generar nada nuevo.
      await encolarOptimizacionInmediata(
        this.jobRepo,
        tx as unknown as JobTxClient,
        mensajeroId,
        creada.id,
      );
      return creada.id;
    });
  }
}
