import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { TotalesIngresoOrdenex } from "@/lib/interfaces/services/ICierreDiaService";

// Feature 40 — contrato del servicio "Cierres de bodega" del maestro (aprobar /
// rechazar). Espejo de ICierresAdminService (feature 38), aplicado a CierreBodega.
// Logica de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado y resuelve `unauthenticated`. Solo el rol `maestro` (R2; sin filtro
// de zona: todo va a la central). Money-safe: los Decimal cruzan como STRING (R13).
// REUSA CierreBodegaResumen / CierreBodegaDetalleCierre (que a su vez reusan
// CierreTotales / CierreGrupos de la 37, R11).

// R2/R15: cola de `solicitado` (pendientes) + historico (aprobado/rechazado). Todos
// los cierres de bodega van a la central: sin filtro de zona. `forbidden` = rol !=
// maestro (R2). `unauthenticated` lo resuelve el borde.
export type ListarCierresBodegaAdminServiceResult =
  | {
      status: "ok";
      pendientes: CierreBodegaResumen[]; // estado=solicitado (R15)
      historico: CierreBodegaResumen[]; // aprobado/rechazado (R15)
    }
  | { status: "forbidden" }; // rol != maestro (R2)

// R2/R11-R13/R19: detalle agregado de UN cierre de bodega (por cada cierre_dia, su
// detalle por resultado reuso 37 + totales). `no_encontrada` = id inexistente (R19).
// `forbidden` = rol != maestro (R2).
export type CierreBodegaDetalleServiceResult =
  | {
      status: "ok";
      cierre: CierreBodegaResumen; // cabecera + totales agregados snapshot (R13)
      cierres: CierreBodegaDetalleCierre[]; // un elemento por cierre_dia incluido (R11)
      // Ingreso de Ordenex AGREGADO de todo el cierre de bodega (suma de los cierre_dia).
      totalesIngreso: TotalesIngresoOrdenex;
      // DERIVADO: `totalesIngreso.total` - `cierre.totalPagoMensajero` (STRING money-safe).
      // Lo que le queda a Ordenex de toda la bodega. Puede ser NEGATIVO.
      ganancia: string;
    }
  | { status: "forbidden" } // rol != maestro (R2)
  | { status: "no_encontrada" }; // id inexistente (R19)

// R2/R16/R18-R20: aprobar un cierre de bodega `solicitado`.
export type AprobarCierreBodegaServiceResult =
  | { status: "ok"; cierreBodegaId: string; estado: "aprobado" } // R16
  | { status: "forbidden" } // rol != maestro (R2)
  | { status: "no_encontrada" } // id inexistente (R19)
  | { status: "conflict" }; // ya no esta `solicitado` (R18)

// R2/R17-R20: rechazar un cierre de bodega `solicitado`; motivo obligatorio (R17).
export type RechazarCierreBodegaServiceResult =
  | { status: "ok"; cierreBodegaId: string; estado: "rechazado" } // R17
  | { status: "forbidden" } // rol != maestro (R2)
  | { status: "no_encontrada" } // id inexistente (R19)
  | { status: "conflict" } // ya no esta `solicitado` (R18)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // motivo vacio (R17)

export interface ICierresBodegaAdminService {
  /**
   * R2/R15: lista los cierres de bodega partidos en pendientes (`solicitado`) e
   * historico (`aprobado`/`rechazado`), con totales agregados snapshot. Solo lectura
   * (R23). Rol != maestro -> forbidden.
   */
  listarCierresBodegaAdmin(actor: Actor): Promise<ListarCierresBodegaAdminServiceResult>;
  /**
   * R2/R11-R13/R19: detalle agregado de un cierre de bodega (cada cierre_dia con sus
   * gestiones por resultado, evidencias firmadas). Solo lectura. Inexistente ->
   * no_encontrada.
   */
  verCierreBodegaDetalle(
    cierreBodegaId: string,
    actor: Actor,
  ): Promise<CierreBodegaDetalleServiceResult>;
  /**
   * R2/R16/R18-R20: aprueba un cierre de bodega `solicitado` (transicion guardada).
   * Ya resuelto -> conflict; inexistente -> no_encontrada.
   */
  aprobarCierreBodega(
    cierreBodegaId: string,
    actor: Actor,
  ): Promise<AprobarCierreBodegaServiceResult>;
  /**
   * R2/R17-R20: rechaza un cierre de bodega `solicitado` con motivo obligatorio
   * (transicion guardada). Motivo vacio -> validation_error; ya resuelto -> conflict;
   * inexistente -> no_encontrada.
   */
  rechazarCierreBodega(
    cierreBodegaId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreBodegaServiceResult>;
}
