import { Prisma } from "@prisma/client";
import type {
  AlcanceIncidente,
  IIncidenteAdminRepository,
  IncidenteAdminPrismaClient,
  IncidenteAdminRow,
  ReportarIncidenteRepoInput,
  ReportarIncidenteRepoResult,
  ResolverIncidenteRepoInput,
  ResolverIncidenteRepoResult,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletIndemnizacionIncidenteFeedService } from "@/lib/interfaces/services/IWalletIndemnizacionIncidenteFeedService";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";

// Feature 158 (T1.26/T1.27, camino del ADMIN) — repositorio de `orden_incidente`. SOLO queries
// Prisma; la autorizacion por rol, R51 (quien reporta no aprueba) y la derivacion del destino de
// la reversion viven en `IncidenteAdminService`. El alcance por zona SIEMPRE va en el WHERE.

// Estado del incidente que la resolucion puede transicionar (R53). Reintentar sobre uno ya
// resuelto encuentra 0 filas -> `conflict`, y por tanto NO vuelve a emitir el egreso.
const ESTADO_RESOLUBLE = "solicitado" as const;

// Nombre del indice unico PARCIAL que materializa R47 en la base. Se usa para distinguir SU
// violacion de cualquier otra: si un dia apareciera otro unique sobre esta tabla, un
// `duplicado` generico mentiria.
const INDICE_INCIDENTE_VIVO = "orden_incidente_orden_vivo_uq";

/**
 * Sentinela interno para abortar la transaccion del reporte sin efectos. NO se exporta: fuera de
 * este archivo el resultado es el union de `ReportarIncidenteRepoResult`, no una excepcion.
 */
class OrdenNoAplicableError extends Error {
  constructor() {
    super("orden_incidente: la orden no admite el reporte");
    this.name = "OrdenNoAplicableError";
  }
}

/** Guardia de zona en el WHERE (R48). `null` = acceso total, sin restriccion. */
function zonaWhere(alcance: AlcanceIncidente): { zonaId?: string } {
  return alcance.zonaId === null ? {} : { zonaId: alcance.zonaId };
}

// Proyeccion de una fila de incidente con lo que la cola y el detalle necesitan. Las evidencias
// entran ORDENADAS por `indice` para que la portada (0) sea siempre la primera.
const INCIDENTE_SELECT = {
  id: true,
  ordenId: true,
  causa: true,
  motivo: true,
  estado: true,
  indemnizacion: true,
  reportadoPor: true,
  resueltoPor: true,
  resueltoAt: true,
  motivoRechazo: true,
  createdAt: true,
  orden: {
    select: {
      numGuia: true,
      numRemision: true,
      destinatario: true,
      zonaId: true,
      zona: { select: { nombre: true } },
      estatus: { select: { value: true } },
    },
  },
  reportadoPorUsuario: { select: { nombre: true } },
  resueltoPorUsuario: { select: { nombre: true } },
  evidencias: { select: { storagePath: true }, orderBy: { indice: "asc" } },
} as const satisfies Prisma.OrdenIncidenteSelect;

type IncidenteRow = Prisma.OrdenIncidenteGetPayload<{ select: typeof INCIDENTE_SELECT }>;

/** Fila cruda -> DTO del repo. Money-safe: Decimal -> STRING escala 2 (nunca number). */
function toRow(r: IncidenteRow): IncidenteAdminRow {
  return {
    incidenteId: r.id,
    ordenId: r.ordenId,
    numGuia: r.orden.numGuia,
    numRemision: r.orden.numRemision,
    destinatario: r.orden.destinatario,
    zonaId: r.orden.zonaId,
    zonaNombre: r.orden.zona.nombre,
    estatusValue: r.orden.estatus.value,
    causa: r.causa,
    motivo: r.motivo,
    estado: r.estado,
    indemnizacion: r.indemnizacion === null ? null : r.indemnizacion.toFixed(2),
    reportadoPor: r.reportadoPor,
    reportadoPorNombre: r.reportadoPorUsuario.nombre,
    resueltoPor: r.resueltoPor,
    resueltoPorNombre: r.resueltoPorUsuario?.nombre ?? null,
    resueltoAt: r.resueltoAt?.toISOString() ?? null,
    motivoRechazo: r.motivoRechazo,
    createdAt: r.createdAt.toISOString(),
    // Paths CRUDOS del bucket privado. El service los firma antes de que salgan de ahi (R46).
    evidenciaStoragePaths: r.evidencias.map((e) => e.storagePath),
  };
}

export class IncidenteAdminRepository implements IIncidenteAdminRepository {
  constructor(
    private readonly prisma: IncidenteAdminPrismaClient,
    // Feature 42: el mismo repo del libro que usan los feeds del cierre. La idempotencia sale de
    // su `createMany({ skipDuplicates })` sobre el indice unico parcial (R53).
    private readonly walletMovimientoRepo: IWalletMovimientoRepository,
    // Feature 158/R52: el SEGUNDO (y ultimo) emisor de `egreso_indemnizacion`.
    private readonly feed: IWalletIndemnizacionIncidenteFeedService,
  ) {}

  /**
   * R41-R44/R47 — reporte ATOMICO. Orden de las escrituras dentro de la MISMA transaccion:
   *   1) pre-lectura de la orden GUARDADA por estado, borrado y alcance (R42/R48);
   *   2) `updateMany` guardado por ESE `estatusId` exacto (anti-TOCTOU: si alguien la movio
   *      entre la lectura y la escritura, `count` es 0 y todo revierte);
   *   3) `create` del incidente en `solicitado` — aqui pega el indice unico parcial (R47);
   *   4) las N evidencias (R46);
   *   5) `appendCambioEstado` por el CHOKE POINT, con `origen_tipo = incidente` (R44). La
   *      guardia de la 140 valida el par contra #48-#52: una arista sin declarar aborta ruidosa.
   *
   * Si algo falla, NADA queda persistido (R42/R43): ni fila, ni transicion, ni historial. Los
   * objetos del bucket los compensa el SERVICE, que es quien los subio (patron
   * `MisAsignacionesService`).
   */
  async reportar(input: ReportarIncidenteRepoInput): Promise<ReportarIncidenteRepoResult> {
    const {
      ordenId,
      causa,
      motivo,
      reportadoPor,
      origenEstatusIds,
      incidenteEstatusId,
      evidencias,
      alcance,
    } = input;
    try {
      const incidenteId = await this.prisma.$transaction(async (tx) => {
        // 1) R42/R48: existe, NO borrada, en uno de los CINCO estados y dentro del alcance. Las
        // cuatro condiciones van juntas en el WHERE y su fallo es INDISTINGUIBLE: no se revela
        // si la orden no existe, si esta en otro estado o si es de otra zona.
        const orden = await tx.orden.findFirst({
          where: {
            id: ordenId,
            deletedAt: null,
            estatusId: { in: [...origenEstatusIds] },
            ...zonaWhere(alcance),
          },
          select: { estatusId: true },
        });
        if (orden === null) throw new OrdenNoAplicableError();

        // 2) Escritura GUARDADA por el estado exacto que se acaba de leer.
        const movidas = await tx.orden.updateMany({
          where: { id: ordenId, estatusId: orden.estatusId, deletedAt: null },
          data: { estatusId: incidenteEstatusId },
        });
        if (movidas.count !== 1) throw new OrdenNoAplicableError();

        // 3) R43: nace `solicitado` (default de la columna, explicito aqui para que se lea).
        // R47: el indice unico parcial `(orden_id) WHERE estado <> 'rechazado'` rechaza un
        // segundo incidente VIVO sobre la misma orden. No hay check-then-insert: la carrera la
        // pierde la base, no una comprobacion previa.
        const creado = await tx.ordenIncidente.create({
          data: { ordenId, causa, motivo, estado: "solicitado", reportadoPor },
          select: { id: true },
        });

        // 4) R46: las N evidencias, en la MISMA tx.
        if (evidencias.length > 0) {
          await tx.ordenIncidenteEvidencia.createMany({
            data: evidencias.map((e) => ({
              incidenteId: creado.id,
              storagePath: e.storagePath,
              contentType: e.contentType,
              indice: e.indice,
            })),
          });
        }

        // 5) R44: rastro con actor, instante y familia `incidente` — la MISMA que produce el
        // camino del mensajero (Q-G). La direccion es inequivoca por `estatus_destino_id`.
        // NO se enlaza `gestion_orden_id`: esto NO es una gestion (design §9.7).
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: orden.estatusId,
            estatusDestinoId: incidenteEstatusId,
            actorUsuarioId: reportadoPor,
            origenTipo: "incidente",
            motivo,
          },
        ]);

        return creado.id;
      });
      return { status: "ok", incidenteId };
    } catch (error) {
      if (error instanceof OrdenNoAplicableError) return { status: "no_aplicable" };
      // R47: la violacion del indice unico parcial es un resultado de dominio, no un 500.
      const constraint = textoConstraintP2002(error);
      if (constraint !== null && constraint.includes(INDICE_INCIDENTE_VIVO)) {
        return { status: "duplicado" };
      }
      throw error;
    }
  }

  /**
   * R52-R54/R57 — resolucion ATOMICA. La guardia del `updateMany` (`estado = 'solicitado'` +
   * alcance por la zona de la ORDEN) es lo que hace que reintentar una aprobacion NO emita un
   * segundo movimiento (R53): la segunda pasada encuentra `count === 0` y sale por `conflict`
   * antes de tocar el feed.
   *
   * Rama `aprobado`: escribe el monto -> el feed LEE lo que esa misma tx acaba de escribir ->
   * `crearMovimientos` con `skipDuplicates` (doble red de idempotencia: la guardia de estado y
   * el indice unico parcial de la 42).
   *
   * Rama `rechazado` (rechazo del aprobador o retracto del autor): devuelve la orden a su estado
   * de ORIGEN —ya derivado y validado por el service (R57/R58)— por el choke point, y NO escribe
   * monto ni emite ningun movimiento (R54).
   */
  async resolver(input: ResolverIncidenteRepoInput): Promise<ResolverIncidenteRepoResult> {
    const { incidenteId, alcance, nuevoEstado, resueltoPor, monto, motivoRechazo, reversion } =
      input;

    const resultado = await this.prisma.$transaction(async (tx) => {
      // R53/R48: transicion GUARDADA por estado resoluble + alcance (por la zona de la ORDEN,
      // via la relacion: nunca en memoria).
      const res = await tx.ordenIncidente.updateMany({
        where: {
          id: incidenteId,
          estado: ESTADO_RESOLUBLE,
          ...(alcance.zonaId === null ? {} : { orden: { zonaId: alcance.zonaId } }),
        },
        data: {
          estado: nuevoEstado,
          resueltoPor,
          resueltoAt: new Date(),
          // R52: money-safe, STRING -> Decimal SOLO al escribir. Al rechazar se deja `null`
          // explicitamente: un rechazo NO persiste monto (R54).
          indemnizacion: monto === null ? null : new Prisma.Decimal(monto),
          motivoRechazo,
        },
      });
      if (res.count !== 1) return "no_aplicado" as const;

      if (nuevoEstado === "aprobado") {
        // R52: el feed LEE de la base lo que el `updateMany` de arriba acaba de escribir. NO
        // recibe el monto por parametro (design §9.3): si el libro se construyera con el numero
        // del request y la escritura fallara, libro e incidente dirian cosas distintas.
        const egreso = await this.feed.construirEgresoIndemnizacionIncidente(incidenteId, tx);
        if (egreso.length > 0) {
          await this.walletMovimientoRepo.crearMovimientos(tx, egreso);
        }
        return "updated" as const;
      }

      // R54/R57: la orden vuelve a su estado de origen, en la MISMA tx.
      if (reversion !== undefined) {
        const movidas = await tx.orden.updateMany({
          where: {
            id: reversion.ordenId,
            estatusId: reversion.incidenteEstatusId, // guardia: sigue en `incidente`
            deletedAt: null,
          },
          data: { estatusId: reversion.destinoEstatusId },
        });
        // R60 (Q-K): NO se toca `mensajero_asignado_id` ni `asignado_at`. No hay nada que
        // reponer porque el reporte tampoco los toco: la reversion es correcta POR
        // CONSTRUCCION, no por acordarse de restaurarlos.
        if (movidas.count !== 1) {
          // La orden se movio bajo los pies entre la lectura del service y esta escritura. Se
          // revierte TODO (incluido el `updateMany` del incidente) devolviendo el sentinela.
          return "no_aplicado" as const;
        }
        await appendCambioEstado(tx, [
          {
            ordenId: reversion.ordenId,
            estatusOrigenId: reversion.incidenteEstatusId,
            estatusDestinoId: reversion.destinoEstatusId,
            actorUsuarioId: resueltoPor,
            origenTipo: "incidente", // #54-#58: misma familia, direccion inversa
            motivo: motivoRechazo,
          },
        ]);
      }
      return "updated" as const;
    });

    if (resultado === "updated") return "updated";
    // count 0: distinguir "ya resuelto / se movio" (existe en alcance) de "no existe / otra
    // zona" (R48: no se revela nada). Se re-consulta FUERA de la tx, que ya revirtio.
    const existe = await this.prisma.ordenIncidente.count({
      where: {
        id: incidenteId,
        ...(alcance.zonaId === null ? {} : { orden: { zonaId: alcance.zonaId } }),
      },
    });
    return existe > 0 ? "conflict" : "fuera_de_alcance";
  }

  /** R49: los incidentes del alcance, mas reciente primero. El service los parte en dos colas. */
  async findByAlcance(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]> {
    const rows = await this.prisma.ordenIncidente.findMany({
      // R48: el alcance va en el WHERE, por la ZONA DE LA ORDEN (no la del autor: un maestro
      // puede reportar sobre una orden de cualquier zona y el adminSatelite solo debe ver las
      // suyas).
      where: alcance.zonaId === null ? {} : { orden: { zonaId: alcance.zonaId } },
      orderBy: { createdAt: "desc" },
      select: INCIDENTE_SELECT,
    });
    return rows.map(toRow);
  }

  /** R48: un incidente SOLO si su orden casa el alcance; fuera de alcance / inexistente -> null. */
  async findByIdEnAlcance(
    incidenteId: string,
    alcance: AlcanceIncidente,
  ): Promise<IncidenteAdminRow | null> {
    const row = await this.prisma.ordenIncidente.findFirst({
      where: {
        id: incidenteId,
        ...(alcance.zonaId === null ? {} : { orden: { zonaId: alcance.zonaId } }),
      },
      select: INCIDENTE_SELECT,
    });
    return row === null ? null : toRow(row);
  }
}
