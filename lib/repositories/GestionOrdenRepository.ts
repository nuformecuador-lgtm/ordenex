import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
  ReprogramarDesdeDevueltaInput,
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

// Feature 100 — `resultado` de la gestion que ancla la ventana en `devuelta` (R5: de ahi se deriva
// el mensajero de la gestion sintetica) y `resultado` de la gestion sintetica de reprogramacion
// (R3). Valores del catalogo `gestion_resultado` ya sembrados; esta feature NO agrega estados.
const RESULTADO_DEVUELTA = "devuelta";
const RESULTADO_REPROGRAMADA = "reprogramada";

type GestionPrismaClient = Pick<
  PrismaClient,
  // Feature 119 (R1/R9): + `gestionOrdenEvidencia` para insertar las N filas hijas dentro de
  // la MISMA transaccion que crea la gestion y transiciona la orden.
  "orden" | "usuario" | "gestionOrden" | "gestionOrdenEvidencia" | "$transaction"
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
    // Feature 97: coordenadas geocodificadas (feature 91) para dibujar el mapa de ruta.
    latitud: true,
    longitud: true,
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
    // Feature 97: Decimal -> number|null con el MISMO patron que `montoCobrar` (una instancia
    // Decimal es siempre truthy, incluida la de valor 0, asi que 0.0 NO se pierde: solo null->null).
    latitud: row.latitud ? row.latitud.toNumber() : null,
    longitud: row.longitud ? row.longitud.toNumber() : null,
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
  }): Promise<string> {
    const { ordenId, mensajeroId, gestion, nuevoEstatusId } = input;
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#9 (R20): estatus de ORIGEN (en_reparto) pre-leido dentro de la tx.
      const actual = await tx.orden.findFirst({
        where: { id: ordenId },
        select: { estatusId: true },
      });
      // Feature 119 (R12): PORTADA denormalizada = evidencia indice 0 (o la primera si no hay
      // un 0 explicito). Retro-compat: si el caller aun pasa la portada suelta y no la lista,
      // se cae a `evidenciaStoragePath/_content_type`. La escriben el MISMO INSERT que las hijas.
      const cover =
        gestion.evidencias?.find((e) => e.indice === 0) ?? gestion.evidencias?.[0] ?? null;
      const coverStoragePath = cover?.storagePath ?? gestion.evidenciaStoragePath ?? null;
      const coverContentType = cover?.contentType ?? gestion.evidenciaContentType ?? null;
      const creada = await tx.gestionOrden.create({
        data: {
          ordenId,
          mensajeroId,
          resultado: gestion.resultado,
          montoRecibido:
            gestion.montoRecibido != null ? new Prisma.Decimal(gestion.montoRecibido) : null,
          metodoPago: gestion.metodoPago ?? null,
          // Feature 119 (R12): dual-write de la portada (indice 0) en las columnas viejas para que
          // los consumidores actuales (cierres 37/38/40, API 106) sigan mostrando UNA foto sin cambios.
          evidenciaStoragePath: coverStoragePath,
          evidenciaContentType: coverContentType,
          motivo: gestion.motivo ?? null,
          fechaReprogramacion: gestion.fechaReprogramacion
            ? new Date(`${gestion.fechaReprogramacion}T00:00:00.000Z`)
            : null,
          // Feature 73/R11/R13: la causa entra en el MISMO INSERT que la gestion, dentro de
          // la tx que cambia el estatus -> si algo falla, la causa NO queda persistida
          // (atomicidad ya provista, sin firma nueva).
          causaDevolucion: gestion.causaDevolucion ?? null,
        },
        select: { id: true },
      });
      // Feature 119 (R1/R2/R9): las N filas hijas se insertan en la MISMA transaccion (todo-o-nada
      // con la gestion + la transicion). Vacio (reprogramada / sin fotos) no inserta nada.
      if (gestion.evidencias && gestion.evidencias.length > 0) {
        await tx.gestionOrdenEvidencia.createMany({
          data: gestion.evidencias.map((e) => ({
            gestionId: creada.id,
            storagePath: e.storagePath,
            contentType: e.contentType,
            indice: e.indice,
          })),
        });
      }
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
      // Feature 99 (R1/R29): la rama `devuelta` YA NO aplica una transicion de seguimiento
      // inmediata. La orden REPOSA en `devuelta` (destino = `nuevoEstatusId`) y el cron SLA
      // (`DevolucionSlaService`/`DevolucionSlaRepository`) decide el reintento a bodega o el
      // escalado a `rechazada` al vencer la ventana. Antes, aqui vivia un segundo `orden.update`
      // + append (feature 47); se relocalizo al cron.
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

  /**
   * Feature 100 (design §2.1, R2/R3/R5/R11/R20/R21): reprograma UNA orden en `devuelta` a
   * `reprogramada`, atomico. (a) UPDATE guardado por `estatus_id = devuelta` + no borrada (R21);
   * si count 0 (carrera con el cron SLA de la 99 / doble submit) -> false, sin efectos (R7).
   * (b) Deriva el mensajero de la ULTIMA gestion `devuelta` VIGENTE (`anulada_at IS NULL`,
   * `createdAt desc`), leido DENTRO de la tx (R5, misma derivacion que `findDevueltasSla`);
   * `gestion_orden.mensajero_id` es NOT NULL, asi que su ausencia (anomalia: una orden en
   * `devuelta` SIN gestion que la explique) ABORTA la tx lanzando -> revierte el UPDATE (R20),
   * en vez de persistir una gestion sintetica sin actor. (c) Crea la gestion sintetica
   * `resultado = reprogramada` con `fecha_reprogramacion` (patron `crearGestionYTransicionar`) y
   * `motivo` opcional, `cierre_id NULL` (entra al proximo cierre pero aporta $0.00: el cierre solo
   * acredita `entregada`/`rechazada`, R10). (d) Appendea la transicion via el choke point
   * (`actor = adminTienda`, `origen_tipo = reprogramacion_tienda`, enlazando la gestion, R11). El
   * destino es `reprogramada`, NO `devuelta`, asi que NO cuenta como intento (R8).
   */
  async reprogramarDesdeDevuelta(input: ReprogramarDesdeDevueltaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // R21: UPDATE guardado por estatus=devuelta + no borrada -> reprogramada.
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusDevueltaId, // guarda de idempotencia/carrera con el cron 99
          deletedAt: null,
        },
        data: { estatusId: input.estatusReprogramadaId },
      });
      // R7/R21: la orden ya salio de `devuelta` -> no crea gestion ni append (no-op).
      if (result.count === 0) return false;

      // R5: mensajero de la ULTIMA gestion `devuelta` vigente, leido dentro de la tx (mismo
      // criterio de vigencia que `findDevueltasSla` de la 99: no anulada, mas reciente).
      const ancla = await tx.gestionOrden.findFirst({
        where: { ordenId: input.ordenId, resultado: RESULTADO_DEVUELTA, anuladaAt: null },
        orderBy: { createdAt: "desc" },
        select: { mensajeroId: true },
      });
      if (!ancla) {
        // Anomalia: una orden en `devuelta` SIN gestion `devuelta` vigente no tiene a quien
        // atribuir la gestion sintetica (`mensajero_id` NOT NULL). Abortar la tx (revierte el
        // UPDATE, R20) es preferible a inventar un actor.
        throw new Error(
          "reprogramarDesdeDevuelta: sin gestion `devuelta` vigente para derivar el mensajero (R5)",
        );
      }

      // R3: gestion sintetica `reprogramada` en la MISMA tx. `fecha_reprogramacion` -> DATE
      // (patron `crearGestionYTransicionar`). `cierre_id NULL` -> money-neutral (R10).
      const gestion = await tx.gestionOrden.create({
        data: {
          ordenId: input.ordenId,
          mensajeroId: ancla.mensajeroId, // R5
          resultado: RESULTADO_REPROGRAMADA, // R3
          fechaReprogramacion: new Date(`${input.fechaReprogramacion}T00:00:00.000Z`), // R3
          motivo: input.motivo, // Q1: opcional (puede ser null)
          cierreId: null, // R10: entra al proximo cierre pero aporta $0.00 (no es entregada/rechazada)
        },
        select: { id: true },
      });

      // R11/R20: append por el choke point, actor = adminTienda, origen_tipo reprogramacion_tienda,
      // enlaza la gestion sintetica; origen `devuelta` (fijado por la guarda del UPDATE).
      await appendCambioEstado(tx, [
        {
          ordenId: input.ordenId,
          estatusOrigenId: input.estatusDevueltaId,
          estatusDestinoId: input.estatusReprogramadaId,
          actorUsuarioId: input.actorUsuarioId, // R11: el adminTienda
          origenTipo: "reprogramacion_tienda", // R11
          motivo: input.motivo, // consistente con la gestion (puede ser null)
          gestionOrdenId: gestion.id,
        },
      ]);
      return true;
    });
  }
}
