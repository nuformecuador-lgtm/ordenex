import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { CierreEstado } from "@/lib/types/cierre";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EvidenciaArchivo } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

// Feature 158 (T1.28/T1.29, camino del ADMIN) — contrato del servicio del incidente reportado
// por un admin. Espejo de forma de `ICierresAdminService` (38): dos colas, alcance por rol+zona
// resuelto server-side y resultados de DOMINIO (nunca excepciones) para forbidden/no_encontrada/
// conflict/validation_error.

/**
 * Un incidente tal como sale del service. Diferencias con la fila del repo, y las dos importan:
 *   - `evidenciaUrls`: URLs FIRMADAS de vigencia acotada, nunca el `storage_path` crudo (R46).
 *   - `esPropio`: si el ACTOR que consulta es quien lo reporto. Lo calcula el servidor para que
 *     la UI no tenga que comparar ids y para que la regla de R51 se exprese igual en los dos
 *     lados. El servidor la vuelve a aplicar al resolver: esto es ayuda visual, no la guardia.
 */
export interface IncidenteAdminDTO {
  incidenteId: string;
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  zonaNombre: string;
  /** Estado ACTUAL de la orden. */
  estatusValue: string;
  causa: CausaIncidente;
  motivo: string;
  estado: CierreEstado;
  /** STRING money-safe escala 2; `null` hasta que se apruebe (R50). */
  indemnizacion: string | null;
  reportadoPorNombre: string;
  resueltoPorNombre: string | null;
  resueltoAt: string | null; // ISO
  motivoRechazo: string | null;
  createdAt: string; // ISO
  evidenciaUrls: string[];
  esPropio: boolean;
}

/** R41/R45/R46: entrada del reporte, con los binarios ya leidos por el borde. */
export interface ReportarIncidenteInput {
  ordenId: string;
  causa: CausaIncidente;
  motivo: string;
  evidencias: EvidenciaArchivo[];
}

export type ListarIncidentesServiceResult =
  | {
      status: "ok";
      pendientes: IncidenteAdminDTO[];
      historico: IncidenteAdminDTO[];
      /** `adminSatelite` sin zona asignada: no hay alcance que resolver (patron 38/R3). */
      sinZona: boolean;
    }
  | { status: "forbidden" };

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA del historico de incidentes (los ya
 * resueltos) del alcance + el total del conjunto. Contrato comun de T H.2, sin campos extra:
 * `sinZona` es dato de la PANTALLA y sigue llegando por `listarIncidentes`.
 */
export type ListarHistoricoIncidentesServiceResult =
  ListarPaginadoServiceResult<IncidenteAdminDTO>;

/**
 * Feature 170 — FASE 2 (T J.1, R40/R41/R42): UNA PAGINA de la COLA de incidentes PENDIENTES de
 * decision del alcance + el total del conjunto. De ese total sale el contador de cabecera que
 * hoy dice `({pendientes.length})` (`IncidentesAdminModule.tsx:308`).
 */
export type ListarPendientesIncidentesServiceResult =
  ListarPaginadoServiceResult<IncidenteAdminDTO>;

/**
 * Feature 184 — Tanda F (T F.2, R1/R6): el HISTORICO ENTERO del alcance, sin recorte, que es del
 * que sale el archivo (listado 9). `limite_excedido` lleva SOLO conteos, jamas filas ni un
 * conjunto truncado (R6).
 */
export type ListarHistoricoIncidentesCompletoServiceResult =
  ListarCompletoServiceResult<IncidenteAdminDTO>;

/**
 * Feature 184 — Tanda F (T F.2, R1/R6): la COLA ENTERA de pendientes de decision, sin recorte,
 * para el archivo del listado 8. Mismo contrato que su hermano del historico.
 */
export type ListarPendientesIncidentesCompletoServiceResult =
  ListarCompletoServiceResult<IncidenteAdminDTO>;

export type VerIncidenteServiceResult =
  | { status: "ok"; incidente: IncidenteAdminDTO }
  | { status: "forbidden" }
  | { status: "no_encontrada" };

export type ReportarIncidenteServiceResult =
  | { status: "ok"; incidenteId: string }
  | { status: "forbidden" }
  | { status: "conflict"; motivo: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type AprobarIncidenteServiceResult =
  | { status: "ok"; incidenteId: string; estado: "aprobado" }
  | { status: "forbidden" }
  | { status: "no_encontrada" }
  | { status: "conflict"; motivo: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type RechazarIncidenteServiceResult =
  | { status: "ok"; incidenteId: string; estado: "rechazado" }
  | { status: "forbidden" }
  | { status: "no_encontrada" }
  | { status: "conflict"; motivo: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type RetractarIncidenteServiceResult = RechazarIncidenteServiceResult;

export interface IIncidenteAdminService {
  /** R49: las DOS colas del alcance («pendientes de decision» + historico de solo lectura). */
  listarIncidentes(actor: Actor): Promise<ListarIncidentesServiceResult>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): el HISTORICO del alcance (incidentes
   * ya resueltos), paginado en el servidor.
   *
   * MISMO `resolveAlcance` por rol+zona que `listarIncidentes` y MISMO corte cola/historico,
   * de modo que paginar no pueda ensanchar el alcance de nadie (R44). Las evidencias de la
   * pagina se firman en UNA sola llamada (R46). Rol invalido -> forbidden; `adminSatelite`
   * sin zona -> pagina vacia.
   */
  listarHistoricoIncidentesPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarHistoricoIncidentesServiceResult>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54): la COLA de incidentes PENDIENTES de
   * decision del alcance, paginada en el servidor.
   *
   * MISMO `resolveAlcance` (rol + zona de la ORDEN) y MISMA constante de estados que el
   * historico, con el corte invertido: la union de las dos paginas es exactamente lo que
   * devuelve `listarIncidentes` (R44). Las evidencias de la pagina se firman en UNA sola
   * llamada (R46). Rol invalido -> forbidden; `adminSatelite` sin zona -> pagina vacia, sin
   * base ni storage.
   */
  listarPendientesIncidentesPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPendientesIncidentesServiceResult>;
  /**
   * Feature 184 — Tanda F (T F.2, R1/R4/R6): el HISTORICO ENTERO del alcance, sin recorte, del
   * que sale el archivo del listado 9.
   *
   * MISMO `resolveAlcance` por rol+zona que su pagina, evaluado ANTES de tocar el repositorio, y
   * MISMO corte cola/historico, escrito en la BASE. No recibe `input`: este listado no tiene
   * filtros ni acepta su alcance por la peticion (R4). `adminSatelite` sin zona -> conjunto
   * vacio, sin tocar la base.
   *
   * **NO firma ninguna URL de evidencia**, a diferencia de su pagina: el archivo no lleva
   * evidencias (R22 de la 170, un `xlsx` reenviado con URL firmadas dentro es acceso a las fotos
   * sin sesion) y su modulo de columnas ni siquiera las lee, asi que firmarlas seria producir un
   * riesgo que nadie consume.
   */
  listarHistoricoIncidentesCompleto(
    actor: Actor,
  ): Promise<ListarHistoricoIncidentesCompletoServiceResult>;
  /**
   * Feature 184 — Tanda F (T F.2, R1/R4/R6): la COLA ENTERA de pendientes de decision, sin
   * recorte, para el archivo del listado 8. Espejo exacto del de arriba, incluida la ausencia de
   * firmas.
   */
  listarPendientesIncidentesCompleto(
    actor: Actor,
  ): Promise<ListarPendientesIncidentesCompletoServiceResult>;
  /** R46/R48: detalle con las evidencias FIRMADAS; fuera de alcance -> `no_encontrada`. */
  verIncidente(incidenteId: string, actor: Actor): Promise<VerIncidenteServiceResult>;
  /** R41-R48: reporta el incidente y transiciona la orden, en una unica transaccion. */
  reportar(input: ReportarIncidenteInput, actor: Actor): Promise<ReportarIncidenteServiceResult>;
  /** R50-R53: aprueba con monto y emite el egreso. **Quien reporta NO aprueba** (R51). */
  aprobar(
    incidenteId: string,
    monto: string,
    actor: Actor,
  ): Promise<AprobarIncidenteServiceResult>;
  /** R54/R57-R59: rechaza con motivo y devuelve la orden a su ORIGEN. Sin monto, sin egreso. */
  rechazar(
    incidenteId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarIncidenteServiceResult>;
  /** R59: el AUTOR retracta su propio incidente `solicitado`. Mismo efecto, sin motivo. */
  retractar(incidenteId: string, actor: Actor): Promise<RetractarIncidenteServiceResult>;
}
