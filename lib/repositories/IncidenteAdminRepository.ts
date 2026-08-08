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
import { ESTADOS_COLA_SOLICITADO } from "@/lib/utils/colas-cierre";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

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

/**
 * R48 — la MISMA guardia, vista desde `orden_incidente`: el alcance se aplica por la ZONA DE
 * LA ORDEN, no por la del autor (un maestro puede reportar sobre una orden de cualquier zona
 * y el `adminSatelite` solo debe ver las suyas).
 *
 * Feature 170 (T I.1): estaba escrita a mano en las DOS lecturas del incidente y la pagina
 * del historico habria sido la tercera. Es el `construirWhere` de este repositorio: extraerlo
 * es lo que impide que la version paginada acote distinto de la que sustituye (R44).
 */
function alcanceWhere(alcance: AlcanceIncidente): { orden?: { zonaId: string } } {
  return alcance.zonaId === null ? {} : { orden: { zonaId: alcance.zonaId } };
}

/**
 * Feature 184 — Tanda F (R16) — el ORDEN de los dos listados de incidentes, declarado UNA vez.
 *
 * Estaba escrito TRES veces en este archivo (`findByAlcance`, `findHistoricoPaginado`,
 * `findColaPaginada`) y los dos conjuntos de esta tanda habrian sido la cuarta y la quinta
 * copia. No es simetria: en cuanto un archivo depende de estos conjuntos, si su orden diverge
 * del de la pagina, la fila 26 del archivo deja de ser la primera de la pagina 2 (R5) y no hay
 * ninguna pantalla que lo diga. Una sola declaracion tampoco lo vuelve invisible: los casos de
 * los `*-where.test.ts` fijan el valor ABSOLUTO, asi que cambiar la constante los pone rojos.
 */
const ORDEN_INCIDENTES_ADMIN = {
  createdAt: "desc",
} as const satisfies Prisma.OrdenIncidenteOrderByWithRelationInput;

/**
 * Feature 184 — Tanda F (R16) — el criterio del HISTORICO de incidentes, declarado UNA vez para
 * su pagina y para su conjunto.
 *
 * R44 de la 170 sigue vigente y es el motivo del `notIn`: es el espejo EXACTO del `else` con que
 * el servicio manda al historico todo lo que no esta en la cola. Con un `in: ["aprobado",
 * "rechazado"]` un estado nuevo del enum desapareceria de las dos listas en vez de caer en el
 * historico.
 */
function historicoIncidentesWhere(alcance: AlcanceIncidente): Prisma.OrdenIncidenteWhereInput {
  return {
    ...alcanceWhere(alcance), // R48: el alcance va en el WHERE, nunca en memoria
    estado: { notIn: [...ESTADOS_COLA_SOLICITADO] },
  };
}

/**
 * Feature 184 — Tanda F (R16) — el criterio de la COLA de incidentes pendientes de decision,
 * declarado UNA vez para su pagina y para su conjunto.
 *
 * COMPLEMENTO EXACTO del de arriba: mismo `alcanceWhere` y la MISMA constante de estados, aqui
 * con `in` (el espejo del `if` del servicio) y alli con `notIn`. Que las dos mitades lean la
 * misma constante es lo que garantiza que ningun incidente quede en las dos listas ni se caiga
 * de las dos — y aqui «caerse» significa que un incidente sin resolver deja de verse, con una
 * orden atrapada en `incidente` y, si lleva indemnizacion, dinero sin decidir.
 */
function colaIncidentesWhere(alcance: AlcanceIncidente): Prisma.OrdenIncidenteWhereInput {
  return {
    ...alcanceWhere(alcance),
    estado: { in: [...ESTADOS_COLA_SOLICITADO] },
  };
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
      // Fix «tope de negocio» (2026-08-04): el valor de la orden, que es el tope de NEGOCIO del
      // monto de indemnizacion. Una COLUMNA MAS del select que la cola y el detalle ya hacen:
      // el tope no puede costar una consulta extra por incidente.
      montoCobrar: true,
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
    // Tope de NEGOCIO (fix 2026-08-04). Money-safe: STRING escala 2, nunca number.
    ordenMontoCobrar: r.orden.montoCobrar === null ? null : r.orden.montoCobrar.toFixed(2),
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
          // Feature 184 (T F.1, R16): la MISMA `alcanceWhere` que las lecturas. Estaba escrita
          // a mano aqui y en el `count` de abajo; tres declaraciones del mismo criterio, y la
          // que decide si un `adminSatelite` puede mover el dinero de otra zona.
          ...alcanceWhere(alcance),
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
        ...alcanceWhere(alcance), // R48/R16: la MISMA guardia de zona que la escritura
      },
    });
    return existe > 0 ? "conflict" : "fuera_de_alcance";
  }

  /** R49: los incidentes del alcance, mas reciente primero. El service los parte en dos colas. */
  async findByAlcance(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]> {
    const rows = await this.prisma.ordenIncidente.findMany({
      where: alcanceWhere(alcance), // R48: el alcance va en el WHERE, nunca en memoria
      orderBy: ORDEN_INCIDENTES_ADMIN,
      select: INCIDENTE_SELECT,
    });
    return rows.map(toRow);
  }

  /**
   * Feature 184 — Tanda F (T F.1, R1/R14/R15/R16) — el HISTORICO ENTERO del alcance, sin
   * recorte: el conjunto del que sale el archivo de «Incidentes — historico» (listado 9).
   *
   * **Por que existe.** La unica lectura sin recorte de este repositorio es `findByAlcance`, y
   * NO es este conjunto: es este conjunto MAS la cola de la misma pantalla. Producir el archivo
   * con ella obliga a partir en memoria lo que la base ya sabe cortar, y deja el archivo
   * saliendo de un listado compuesto (R1).
   *
   * Es su hermano paginado SIN `skip`/`take` y SIN el `count`, con el MISMO
   * `historicoIncidentesWhere` y el MISMO `ORDEN_INCIDENTES_ADMIN` por construccion, no por
   * vigilancia (R16). UNA consulta (R15).
   */
  async findHistoricoCompleto(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]> {
    const rows = await this.prisma.ordenIncidente.findMany({
      where: historicoIncidentesWhere(alcance),
      orderBy: ORDEN_INCIDENTES_ADMIN,
      select: INCIDENTE_SELECT,
    });
    return rows.map(toRow);
  }

  /**
   * Feature 184 — Tanda F (T F.1, R1/R14/R15/R16) — la COLA ENTERA de pendientes de decision
   * del alcance, sin recorte: el conjunto del archivo de «Incidentes pendientes» (listado 8).
   *
   * COMPLEMENTO EXACTO del de arriba, y donde mas se nota la mejora: la cola son los incidentes
   * sin resolver —una decena— y el historico crece sin tope con los dias, asi que descargar la
   * cola arrastraba TODOS los incidentes que el actor puede ver.
   */
  async findColaCompleta(alcance: AlcanceIncidente): Promise<IncidenteAdminRow[]> {
    const rows = await this.prisma.ordenIncidente.findMany({
      where: colaIncidentesWhere(alcance),
      orderBy: ORDEN_INCIDENTES_ADMIN,
      select: INCIDENTE_SELECT,
    });
    return rows.map(toRow);
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina del HISTORICO + el total.
   *
   * MISMO `alcanceWhere` que `findByAlcance` (R48) y MISMO `orderBy createdAt desc` (R51),
   * con dos anadidos: `estado NOT IN <cola>` —el espejo del `else` con que el servicio parte
   * hoy las dos colas (R44)— y el recorte `skip`/`take`. El `where` se construye UNA vez y lo
   * comparten `findMany` y `count`: si el conteo tuviera el suyo, un `adminSatelite` acabaria
   * viendo cuantos incidentes hay en zonas que no puede leer.
   */
  async findHistoricoPaginado(
    alcance: AlcanceIncidente,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<IncidenteAdminRow>> {
    // Feature 184 (T F.1, R16): UNA declaracion del criterio y del orden, compartida con el
    // conjunto del archivo (`findHistoricoCompleto`). El `where` se construye una vez y lo
    // comparten `findMany` y `count`.
    const where = historicoIncidentesWhere(alcance);
    const [rows, total] = await Promise.all([
      this.prisma.ordenIncidente.findMany({
        where,
        orderBy: ORDEN_INCIDENTES_ADMIN, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: INCIDENTE_SELECT,
      }),
      this.prisma.ordenIncidente.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toRow), total };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R51/R54): una pagina de la COLA de incidentes
   * pendientes de decision + el total.
   *
   * COMPLEMENTO EXACTO de `findHistoricoPaginado`: mismo `alcanceWhere` (por la zona de la
   * ORDEN, R48), mismo `orderBy createdAt desc` y la MISMA `ESTADOS_COLA_SOLICITADO`, aqui con
   * `in`. El `where` lo comparten pagina y conteo: sin eso, el contador de cabecera de un
   * `adminSatelite` acabaria contando incidentes de zonas que no puede leer.
   */
  async findColaPaginada(
    alcance: AlcanceIncidente,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<IncidenteAdminRow>> {
    // Feature 184 (T F.1, R16): UNA declaracion del criterio y del orden, compartida con el
    // conjunto del archivo (`findColaCompleta`).
    const where = colaIncidentesWhere(alcance);
    const [rows, total] = await Promise.all([
      this.prisma.ordenIncidente.findMany({
        where,
        orderBy: ORDEN_INCIDENTES_ADMIN, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: INCIDENTE_SELECT,
      }),
      this.prisma.ordenIncidente.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toRow), total };
  }

  /** R48: un incidente SOLO si su orden casa el alcance; fuera de alcance / inexistente -> null. */
  async findByIdEnAlcance(
    incidenteId: string,
    alcance: AlcanceIncidente,
  ): Promise<IncidenteAdminRow | null> {
    const row = await this.prisma.ordenIncidente.findFirst({
      where: { id: incidenteId, ...alcanceWhere(alcance) }, // R48: la MISMA guardia del listado
      select: INCIDENTE_SELECT,
    });
    return row === null ? null : toRow(row);
  }
}
