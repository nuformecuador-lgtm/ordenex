import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { CierreEstado } from "@/lib/types/cierre";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EvidenciaArchivo } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

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
