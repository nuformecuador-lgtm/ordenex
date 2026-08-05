import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreBodegaDetalleCierre,
  CierreBodegaResumen,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { TotalesIngresoOrdenex } from "@/lib/interfaces/services/ICierreDiaService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

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

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA del historico de cierres de bodega
 * (los ya resueltos) + el total del conjunto. Contrato comun de T H.2, sin campos extra.
 */
export type ListarHistoricoCierresBodegaServiceResult =
  ListarPaginadoServiceResult<CierreBodegaResumen>;

/**
 * Feature 170 — FASE 2 (T J.1, R40/R41/R42): UNA PAGINA de la COLA de cierres de bodega
 * PENDIENTES + el total del conjunto. De ese total sale el contador de cabecera que hoy dice
 * `({pendientes.length})` (`CierresBodegaAdminModule.tsx:220`).
 */
export type ListarPendientesCierresBodegaServiceResult =
  ListarPaginadoServiceResult<CierreBodegaResumen>;

/**
 * Feature 184 — Tanda E (T E.2, R1/R6) — el HISTORICO ENTERO de cierres de bodega, sin recorte:
 * el conjunto del que sale el archivo del listado 5.
 *
 * `limite_excedido` lleva SOLO conteos, nunca filas ni un conjunto truncado (R6). No hay
 * `sinZona`: este listado es de acceso total y no se acota por zona.
 */
export type ListarHistoricoCierresBodegaCompletoServiceResult =
  ListarCompletoServiceResult<CierreBodegaResumen>;

/**
 * Feature 184 — Tanda E (T E.2, R1/R6) — la COLA ENTERA de cierres de bodega pendientes, sin
 * recorte: el conjunto del que sale el archivo del listado 4.
 */
export type ListarPendientesCierresBodegaCompletoServiceResult =
  ListarCompletoServiceResult<CierreBodegaResumen>;

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
      // DERIVADO: `cierre.totales.general` - `fleteConIva` - `comisionConIva` (STRING
      // money-safe). Lo que se le paga a las tiendas. Puede ser NEGATIVO.
      pagoTienda: string;
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
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): el HISTORICO (cierres de bodega ya
   * resueltos), paginado en el servidor.
   *
   * MISMA guardia de rol que `listarCierresBodegaAdmin` (`esAccesoTotal`, R2) evaluada ANTES
   * de tocar el repositorio, y MISMO corte cola/historico: paginar no puede ensanchar el
   * alcance de nadie (R44). Rol distinto -> forbidden, sin filas y sin total.
   */
  listarHistoricoCierresBodegaPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarHistoricoCierresBodegaServiceResult>;
  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54): la COLA de cierres de bodega
   * PENDIENTES, paginada en el servidor.
   *
   * MISMA guardia de rol, evaluada ANTES del repositorio (la cabecera de un cierre de bodega
   * es dinero agregado de una zona entera), y MISMA constante de estados que el historico con
   * el corte invertido. Rol distinto de acceso total -> forbidden, sin filas y sin total.
   */
  listarPendientesCierresBodegaPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarPendientesCierresBodegaServiceResult>;
  /**
   * Feature 184 — Tanda E (T E.2, R1/R4/R6): el HISTORICO ENTERO de cierres de bodega, sin
   * recorte, que es del que sale el archivo (listado 5).
   *
   * MISMA guardia de rol que su pagina (`esAccesoTotal`, R2/R4) evaluada ANTES de tocar el
   * repositorio, y MISMO corte cola/historico, escrito en la BASE. No recibe `input`: este
   * listado no tiene filtros ni acepta su alcance por la peticion.
   */
  listarHistoricoCierresBodegaCompleto(
    actor: Actor,
  ): Promise<ListarHistoricoCierresBodegaCompletoServiceResult>;
  /**
   * Feature 184 — Tanda E (T E.2, R1/R4/R6): la COLA ENTERA de cierres de bodega pendientes, sin
   * recorte, para el archivo (listado 4). Espejo exacto del de arriba.
   */
  listarPendientesCierresBodegaCompleto(
    actor: Actor,
  ): Promise<ListarPendientesCierresBodegaCompletoServiceResult>;
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
