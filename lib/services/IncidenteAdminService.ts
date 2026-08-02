import { Prisma } from "@prisma/client";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { gestionConfig, GESTION_MIME_EXTENSION, type GestionMimeType } from "@/lib/config/gestion";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  AlcanceIncidente,
  EvidenciaIncidenteInput,
  IIncidenteAdminRepository,
  IncidenteAdminRow,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AprobarIncidenteServiceResult,
  IIncidenteAdminService,
  IncidenteAdminDTO,
  ListarHistoricoIncidentesServiceResult,
  ListarIncidentesServiceResult,
  ListarPendientesIncidentesServiceResult,
  RechazarIncidenteServiceResult,
  ReportarIncidenteInput,
  ReportarIncidenteServiceResult,
  RetractarIncidenteServiceResult,
  VerIncidenteServiceResult,
} from "@/lib/interfaces/services/IIncidenteAdminService";
import {
  MSG_AUTOR_NO_RESUELVE,
  MSG_CATALOGO_INCOMPLETO,
  MSG_INCIDENTE_YA_EXISTE,
  MSG_INCIDENTE_YA_RESUELTO,
  MSG_MONTO_REQUERIDO,
  MSG_MOTIVO_RECHAZO_REQUERIDO,
  MSG_ORDEN_NO_REPORTABLE,
  MSG_SIN_ORIGEN_REVERSIBLE,
  MSG_SOLO_EL_AUTOR_RETRACTA,
} from "@/lib/services/mensajes-incidente-admin";
import { esColaSolicitado } from "@/lib/utils/colas-cierre";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// Feature 158 (T1.28/T1.29, camino del ADMIN) — logica de negocio del incidente reportado por un
// admin. Espejo de forma de `CierresAdminService` (38), que es la aplicacion original del patron
// de aprobacion que el humano pidio reusar. No conoce HTTP ni Prisma: se instancia con dobles.

const ROL_ADMIN_SATELITE = "adminSatelite";

/**
 * Q-A (CERRADA por el humano) — conjunto EXACTO y CERRADO de estados desde los que un admin
 * puede reportar un incidente: bodega y transitos internos, nunca en manos de un mensajero (ese
 * camino es el del propio mensajero, arista #44).
 *
 * ES TAMBIEN el conjunto de destinos admitidos de la REVERSION (R57/R58): el destino se DERIVA
 * del historial y se valida contra esta misma lista, asi que una entrada y su inversa no pueden
 * divergir por descuido. Cada uno tiene su arista declarada en el mapa de la 140 (#48-#52 y
 * #54-#58); si alguien retirase una de alli, la guardia del choke point abortaria la escritura.
 */
export const ORIGENES_INCIDENTE_ADMIN = [
  "en_bodega_central",
  "en_bodega_satelite",
  "en_ruta_bodega_central",
  "en_ruta_bodega_satelite",
  "por_recoger",
] as const;

const SET_ORIGENES: ReadonlySet<string> = new Set(ORIGENES_INCIDENTE_ADMIN);

/** Estado destino del reporte. Es el mismo `value` del catalogo que usa el camino del mensajero. */
const ESTADO_INCIDENTE = "incidente";

/** Resultado interno de resolver el alcance del actor (R48). */
type AlcanceResult =
  | { status: "ok"; alcance: AlcanceIncidente }
  | { status: "sinZona" }
  | { status: "forbidden" };

/** Metodos de repo consumidos (Pick para dobles de test sin DB/red). */
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioZonaId" | "findEstatusIdByValue">;
type HistorialRepo = Pick<IOrdenHistorialRepository, "findOrigenesReversion">;

export class IncidenteAdminService implements IIncidenteAdminService {
  constructor(
    private readonly repo: IIncidenteAdminRepository,
    private readonly ordenRepo: OrdenRepo,
    private readonly historialRepo: HistorialRepo,
    private readonly storage: IFileStorage,
    private readonly signedUrls: ISignedUrlProvider,
  ) {}

  /**
   * R48 — alcance server-side por rol+zona. Acceso total (maestro/admin) ve todas las zonas; el
   * `adminSatelite` SOLO la suya, resuelta del usuario y NUNCA aceptada del cliente (patron
   * `CierresAdminService.resolveAlcance`). Cualquier otro rol: `forbidden`.
   */
  private async resolveAlcance(actor: Actor): Promise<AlcanceResult> {
    if (esAccesoTotal(actor.rol)) return { status: "ok", alcance: { zonaId: null } };
    if (actor.rol === ROL_ADMIN_SATELITE) {
      const zonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
      if (zonaId === null) return { status: "sinZona" };
      return { status: "ok", alcance: { zonaId } };
    }
    return { status: "forbidden" };
  }

  async listarIncidentes(actor: Actor): Promise<ListarIncidentesServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    if (scope.status === "sinZona") {
      return { status: "ok", pendientes: [], historico: [], sinZona: true };
    }

    const rows = await this.repo.findByAlcance(scope.alcance);
    // R46: se firman las evidencias de TODAS las filas en UNA sola llamada (evita N round-trips).
    const urlByPath = await this.firmar(rows.flatMap((r) => r.evidenciaStoragePaths));

    // R49: dos colas. `solicitado` = pendiente de decision; el resto (aprobado/rechazado) es
    // historico de SOLO LECTURA. Mismo corte que `CierresBodegaAdminService` (40), que tambien
    // reusa `CierreEstado` y parte `solicitado` vs. resto.
    const pendientes: IncidenteAdminDTO[] = [];
    const historico: IncidenteAdminDTO[] = [];
    for (const row of rows) {
      const dto = toDTO(row, urlByPath, actor.usuarioId);
      // Feature 170 (T I.1): el corte sale de `ESTADOS_COLA_SOLICITADO`, el MISMO que el
      // repositorio escribe como WHERE al paginar el historico (R44).
      if (esColaSolicitado(row.estado)) pendientes.push(dto);
      else historico.push(dto);
    }
    return { status: "ok", pendientes, historico, sinZona: false };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — el HISTORICO de incidentes, paginado
   * en servidor.
   *
   * Reusa `resolveAlcance` sin tocarlo: el alcance por rol+zona se resuelve server-side desde
   * el usuario y NUNCA se acepta del cliente. Paginar no puede ampliar lo que ve un
   * `adminSatelite` (R44).
   *
   * Se firman SOLO las evidencias de la PAGINA, y esa es la diferencia que importa frente al
   * listado sin paginar: hoy `listarIncidentes` firma las de todo el historico en una llamada
   * que crece sin techo con el tiempo. La consulta al storage sigue siendo UNA (R46), pero
   * con N acotado por el tamano de pagina.
   *
   * `sinZona` -> pagina vacia, sin tocar la base ni el storage.
   */
  async listarHistoricoIncidentesPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarHistoricoIncidentesServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    if (scope.status === "sinZona") {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    const { items, total } = await this.repo.findHistoricoPaginado(
      scope.alcance,
      rangoDePagina(input),
    );

    // R46: una sola llamada al storage para toda la pagina (nunca una por fila).
    const urlByPath = await this.firmar(items.flatMap((r) => r.evidenciaStoragePaths));

    return {
      status: "ok",
      items: items.map((row) => toDTO(row, urlByPath, actor.usuarioId)), // mismo mapper (R51)
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54) — la COLA de incidentes PENDIENTES
   * de decision, paginada en servidor.
   *
   * Espejo del metodo del historico: MISMO `resolveAlcance` (rol + zona de la ORDEN, resuelta
   * server-side) y MISMA constante de estados, aqui con el corte invertido. R44 por
   * construccion.
   *
   * Se firman SOLO las evidencias de la PAGINA, en UNA sola llamada (R46). `esPropio` lo
   * decide el mismo `toDTO` que el listado sin paginar, con el actor de esta peticion: paginar
   * no cambia quien puede resolver que (R51).
   *
   * R49: el unico monto de esta cola es `indemnizacion`, que viaja por FILA y solo existe una
   * vez aprobado el incidente; la pantalla no deriva ningun agregado del array. El `total`
   * alimenta el contador de cabecera (R42).
   */
  async listarPendientesIncidentesPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPendientesIncidentesServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    if (scope.status === "sinZona") {
      return { status: "ok", items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    const { items, total } = await this.repo.findColaPaginada(scope.alcance, rangoDePagina(input));

    // R46: una sola llamada al storage para toda la pagina (nunca una por fila).
    const urlByPath = await this.firmar(items.flatMap((r) => r.evidenciaStoragePaths));

    return {
      status: "ok",
      items: items.map((row) => toDTO(row, urlByPath, actor.usuarioId)), // mismo mapper (R51)
      page: input.page,
      pageSize: input.pageSize,
      total, // R41/R42: el total del CONJUNTO de la cola, nunca `items.length`
    };
  }

  async verIncidente(incidenteId: string, actor: Actor): Promise<VerIncidenteServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    // Sin zona no hay alcance valido: cualquier incidente esta, por definicion, fuera (R48).
    if (scope.status === "sinZona") return { status: "no_encontrada" };

    const row = await this.repo.findByIdEnAlcance(incidenteId, scope.alcance);
    if (row === null) return { status: "no_encontrada" }; // R48: no se distingue de "no existe"

    const urlByPath = await this.firmar(row.evidenciaStoragePaths);
    return { status: "ok", incidente: toDTO(row, urlByPath, actor.usuarioId) };
  }

  /**
   * R41-R48 — reporte. Orden de las guardias, que importa: rol -> alcance -> catalogo -> subida
   * COMPENSADA de las evidencias -> una unica llamada al repo, que es quien decide con el estado
   * real de la orden dentro de su transaccion.
   *
   * La subida va ANTES de la transaccion (no se puede subir dentro de una tx de Postgres) y por
   * eso se COMPENSA: si el repo rechaza el reporte, los objetos ya subidos se borran, para que
   * R42 («sin objetos en el bucket») sea cierto y no una aspiracion. Molde EXACTO de
   * `MisAsignacionesService.gestionar`.
   */
  async reportar(
    input: ReportarIncidenteInput,
    actor: Actor,
  ): Promise<ReportarIncidenteServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    // R48: un `adminSatelite` sin zona no tiene alcance sobre ninguna orden.
    if (scope.status === "sinZona") return { status: "forbidden" };

    // Catalogo: los CINCO origenes admitidos + el destino. Se resuelve ANTES de subir nada: si
    // el seed esta incompleto, el fallo no deja basura en el bucket.
    const catalogo = await this.resolverCatalogo();
    if (catalogo === null) {
      return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } };
    }

    const subidas = await this.subirEvidencias(input.ordenId, input.evidencias);
    let resultado;
    try {
      resultado = await this.repo.reportar({
        ordenId: input.ordenId,
        causa: input.causa,
        motivo: input.motivo,
        reportadoPor: actor.usuarioId,
        origenEstatusIds: catalogo.origenIds,
        incidenteEstatusId: catalogo.incidenteId,
        evidencias: subidas.evidencias,
        alcance: scope.alcance,
      });
    } catch (error) {
      // La transaccion fallo DESPUES de subir: se borran las N evidencias (best-effort) y se
      // propaga. No queda ninguna fila persistida (lo garantiza la tx del repo).
      await this.compensar(subidas.paths);
      throw error;
    }

    if (resultado.status === "no_aplicable") {
      await this.compensar(subidas.paths); // R42: ni una foto huerfana
      return { status: "conflict", motivo: MSG_ORDEN_NO_REPORTABLE };
    }
    if (resultado.status === "duplicado") {
      await this.compensar(subidas.paths);
      return { status: "conflict", motivo: MSG_INCIDENTE_YA_EXISTE }; // R47
    }
    return { status: "ok", incidenteId: resultado.incidenteId };
  }

  /**
   * R50-R53 — aprobacion. **R51 es la guardia que define esta feature**: si el actor es el mismo
   * que reporto, se rechaza con `conflict` y SIN EFECTOS, aunque tenga acceso total. Es el doble
   * control del dinero que pidio el humano.
   */
  async aprobar(
    incidenteId: string,
    monto: string,
    actor: Actor,
  ): Promise<AprobarIncidenteServiceResult> {
    const previo = await this.cargarResoluble(incidenteId, actor);
    if (previo.status !== "ok") return previo;

    // R50 (defensa ademas del borde, patron `CierresAdminService.rechazarCierre`): el monto debe
    // ser un decimal positivo. Money-safe: se compara con `Prisma.Decimal`, nunca con parseFloat.
    if (!montoValido(monto)) {
      return { status: "validation_error", fieldErrors: { monto: [MSG_MONTO_REQUERIDO] } };
    }

    // R52: el repo escribe el monto y emite el egreso en la MISMA tx. Sin `reversion`: un
    // incidente APROBADO deja la orden en `incidente`, que es su estado terminal.
    const res = await this.repo.resolver({
      incidenteId,
      alcance: previo.alcance,
      nuevoEstado: "aprobado",
      resueltoPor: actor.usuarioId,
      monto,
      motivoRechazo: null,
    });
    if (res === "updated") return { status: "ok", incidenteId, estado: "aprobado" };
    if (res === "conflict") return { status: "conflict", motivo: MSG_INCIDENTE_YA_RESUELTO }; // R53
    return { status: "no_encontrada" };
  }

  /**
   * R54/R57-R59 — rechazo del APROBADOR: exige motivo, marca el incidente `rechazado` y devuelve
   * la orden a su estado de ORIGEN, todo en la misma transaccion. NO persiste monto y NO emite
   * ningun movimiento.
   */
  async rechazar(
    incidenteId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarIncidenteServiceResult> {
    const previo = await this.cargarResoluble(incidenteId, actor);
    if (previo.status !== "ok") return previo;

    // R54 (defensa ademas del borde): motivo no vacio ANTES de tocar el repo.
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      return {
        status: "validation_error",
        fieldErrors: { motivo: [MSG_MOTIVO_RECHAZO_REQUERIDO] },
      };
    }
    return this.cerrarSinPagar(previo.incidente, previo.alcance, actor, motivoLimpio);
  }

  /**
   * R59 — RETRACTO del propio autor mientras el incidente sigue `solicitado`. Es la otra mitad de
   * la «ventana controlada» de Q-D: el mismo efecto que el rechazo (la orden vuelve a su origen,
   * sin monto ni movimiento) pero sin motivo de aprobador, porque no hay aprobador — hay alguien
   * deshaciendo su propio error.
   */
  async retractar(incidenteId: string, actor: Actor): Promise<RetractarIncidenteServiceResult> {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    if (scope.status === "sinZona") return { status: "no_encontrada" };

    const incidente = await this.repo.findByIdEnAlcance(incidenteId, scope.alcance);
    if (incidente === null) return { status: "no_encontrada" };
    // Espejo EXACTO de R51: alli el autor NO puede resolver; aqui SOLO el autor puede retractar.
    if (incidente.reportadoPor !== actor.usuarioId) {
      return { status: "conflict", motivo: MSG_SOLO_EL_AUTOR_RETRACTA };
    }
    if (incidente.estado !== "solicitado") {
      return { status: "conflict", motivo: MSG_INCIDENTE_YA_RESUELTO }; // R59: aprobado -> NO
    }
    return this.cerrarSinPagar(incidente, scope.alcance, actor, null);
  }

  /**
   * R54/R57/R58 — cierre SIN pagar (rechazo o retracto): deriva el estado de ORIGEN del historial
   * inmutable, lo VALIDA contra el conjunto cerrado y devuelve la orden ahi. Comun a los dos
   * verbos a proposito: la unica diferencia entre ellos es quien puede invocarlos y si hay motivo.
   */
  private async cerrarSinPagar(
    incidente: IncidenteAdminRow,
    alcance: AlcanceIncidente,
    actor: Actor,
    motivoRechazo: string | null,
  ): Promise<RechazarIncidenteServiceResult> {
    const incidenteEstatusId = await this.ordenRepo.findEstatusIdByValue(ESTADO_INCIDENTE);
    if (incidenteEstatusId === null) {
      return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } };
    }

    // R57: el destino se DERIVA de una fuente persistida y auditable — la ultima transicion que
    // entro al estado actual de la orden — con el lector que la feature 149 ya dejo probado y en
    // uso (`findOrigenesReversion`). NO hay estado destino fijo escrito en el codigo.
    const origenes = await this.historialRepo.findOrigenesReversion([
      { ordenId: incidente.ordenId, estatusActualId: incidenteEstatusId },
    ]);
    const origenValue = origenes.get(incidente.ordenId) ?? null;

    // R58 (fallo CERRADO): sin fila, fila de creacion (origen NULL) o un origen que NO pertenece
    // al conjunto cerrado -> `conflict` sin mover NADA. Sin esta guardia un historial raro podria
    // mandar la orden a cualquier parte; con ella el peor caso es «no se puede deshacer».
    if (origenValue === null || !SET_ORIGENES.has(origenValue)) {
      return { status: "conflict", motivo: MSG_SIN_ORIGEN_REVERSIBLE };
    }
    const destinoEstatusId = await this.ordenRepo.findEstatusIdByValue(origenValue);
    if (destinoEstatusId === null) {
      return { status: "validation_error", fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] } };
    }

    const res = await this.repo.resolver({
      incidenteId: incidente.incidenteId,
      alcance,
      nuevoEstado: "rechazado",
      resueltoPor: actor.usuarioId,
      monto: null, // R54: un rechazo NO persiste monto
      motivoRechazo,
      reversion: {
        ordenId: incidente.ordenId,
        incidenteEstatusId,
        destinoEstatusId,
      },
    });
    if (res === "updated") {
      return { status: "ok", incidenteId: incidente.incidenteId, estado: "rechazado" };
    }
    if (res === "conflict") return { status: "conflict", motivo: MSG_INCIDENTE_YA_RESUELTO };
    return { status: "no_encontrada" };
  }

  /**
   * Guardias comunes de aprobar/rechazar: alcance -> existe -> **R51 (quien reporta no aprueba)**
   * -> sigue `solicitado`. Se resuelven ANTES de validar el dato de entrada para no revelar por
   * el orden de los errores si un incidente ajeno existe (R48).
   */
  private async cargarResoluble(
    incidenteId: string,
    actor: Actor,
  ): Promise<
    | { status: "ok"; incidente: IncidenteAdminRow; alcance: AlcanceIncidente }
    | { status: "forbidden" }
    | { status: "no_encontrada" }
    | { status: "conflict"; motivo: string }
  > {
    const scope = await this.resolveAlcance(actor);
    if (scope.status === "forbidden") return { status: "forbidden" };
    if (scope.status === "sinZona") return { status: "no_encontrada" };

    const incidente = await this.repo.findByIdEnAlcance(incidenteId, scope.alcance);
    if (incidente === null) return { status: "no_encontrada" };

    // R51: quien reporta NO aprueba (ni rechaza). Va ANTES de mirar el estado: da igual en que
    // estado este, el autor nunca es el resolutor.
    if (incidente.reportadoPor === actor.usuarioId) {
      return { status: "conflict", motivo: MSG_AUTOR_NO_RESUELVE };
    }
    // R53/R59: solo un `solicitado` se resuelve. Un `aprobado` ya movio dinero.
    if (incidente.estado !== "solicitado") {
      return { status: "conflict", motivo: MSG_INCIDENTE_YA_RESUELTO };
    }
    return { status: "ok", incidente, alcance: scope.alcance };
  }

  /** Los CINCO origenes + el destino, resueltos del catalogo. `null` si falta alguno (seed). */
  private async resolverCatalogo(): Promise<{
    origenIds: string[];
    incidenteId: string;
  } | null> {
    const incidenteId = await this.ordenRepo.findEstatusIdByValue(ESTADO_INCIDENTE);
    if (incidenteId === null) return null;
    const origenIds: string[] = [];
    for (const value of ORIGENES_INCIDENTE_ADMIN) {
      const id = await this.ordenRepo.findEstatusIdByValue(value);
      if (id === null) return null;
      origenIds.push(id);
    }
    return { origenIds, incidenteId };
  }

  /**
   * R46 — sube las N evidencias de forma SECUENCIAL y determinista, acumulando los paths ya
   * subidos para poder COMPENSAR ante cualquier fallo (molde de `MisAsignacionesService`). El
   * bucle secuencial hace la compensacion trivial: `paths` contiene EXACTAMENTE lo subido hasta
   * el fallo, sin rastrear promesas de un `Promise.all` que rechaza.
   */
  private async subirEvidencias(
    ordenId: string,
    archivos: ReadonlyArray<{ contentType: string; bytes: Uint8Array }>,
  ): Promise<{ paths: string[]; evidencias: EvidenciaIncidenteInput[] }> {
    const paths: string[] = [];
    const evidencias: EvidenciaIncidenteInput[] = [];
    try {
      for (let i = 0; i < archivos.length; i++) {
        const ev = archivos[i];
        const ext = GESTION_MIME_EXTENSION[ev.contentType as GestionMimeType] ?? "bin";
        // `-i` garantiza unicidad entre las fotos del MISMO reporte (mismo `Date.now()`). El
        // prefijo `incidente-` las distingue de las de una gestion sobre la misma orden.
        const path = `${ordenId}/incidente-${Date.now()}-${i}.${ext}`;
        const stored = await this.storage.upload({
          path,
          bytes: ev.bytes,
          contentType: ev.contentType,
        });
        paths.push(stored);
        evidencias.push({ storagePath: stored, contentType: ev.contentType, indice: i });
      }
    } catch (error) {
      await this.compensar(paths);
      throw error;
    }
    return { paths, evidencias };
  }

  private async compensar(paths: string[]): Promise<void> {
    if (paths.length > 0) await this.storage.remove(paths);
  }

  /** R46: paths crudos -> URLs firmadas de TTL acotado, en UNA llamada. */
  private async firmar(paths: string[]): Promise<Record<string, string>> {
    if (paths.length === 0) return {};
    return this.signedUrls.createSignedUrls(paths, gestionConfig.SIGNED_URL_TTL_SECONDS);
  }
}

/** R50/R55 money-safe: el monto es un decimal positivo, comparado con `Prisma.Decimal`. */
function montoValido(monto: string): boolean {
  try {
    return new Prisma.Decimal(monto.trim()).gt(0);
  } catch {
    return false;
  }
}

/**
 * Fila del repo -> DTO del service. Las dos transformaciones que importan:
 *   - las evidencias salen SOLO como URL firmada (R46): el `storage_path` crudo no cruza;
 *   - `esPropio` lo calcula el SERVIDOR (R51), para que la UI no compare ids ni tenga que
 *     conocer el id del autor. El id del autor NO viaja al cliente.
 */
function toDTO(
  row: IncidenteAdminRow,
  urlByPath: Record<string, string>,
  actorUsuarioId: string,
): IncidenteAdminDTO {
  return {
    incidenteId: row.incidenteId,
    ordenId: row.ordenId,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    destinatario: row.destinatario,
    zonaNombre: row.zonaNombre,
    estatusValue: row.estatusValue,
    causa: row.causa,
    motivo: row.motivo,
    estado: row.estado,
    indemnizacion: row.indemnizacion,
    reportadoPorNombre: row.reportadoPorNombre,
    resueltoPorNombre: row.resueltoPorNombre,
    resueltoAt: row.resueltoAt,
    motivoRechazo: row.motivoRechazo,
    createdAt: row.createdAt,
    evidenciaUrls: row.evidenciaStoragePaths
      .map((p) => urlByPath[p])
      .filter((u): u is string => typeof u === "string"),
    esPropio: row.reportadoPor === actorUsuarioId,
  };
}
