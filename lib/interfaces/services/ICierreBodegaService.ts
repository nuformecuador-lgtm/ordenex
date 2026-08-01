import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado } from "@/lib/types/cierre";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";
import type {
  CierreGrupos,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 40 — contrato del servicio del "Cierre de bodega" (lado adminSatelite:
// consolidar + solicitar). Espejo de ICierreDiaService (feature 37), un nivel arriba.
// Logica de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado y resuelve `unauthenticated`. Solo el rol `adminSatelite`, SIEMPRE
// acotado a SU zona (R1/R3). Money-safe: los Decimal cruzan como STRING (R13). REUSA
// CierreTotales / CierreGrupos de la feature 37 (R11) — NO se define DTO de detalle
// nuevo. Ningun DTO expone el pago al mensajero (R14, es la feature 39).

// Cabecera de un cierre de bodega (cola/historico maestro + historico adminSatelite).
// Nombres ya resueltos (no IDs crudos). `totales` = snapshot agregado money-safe (R13).
export interface CierreBodegaResumen {
  cierreBodegaId: string;
  zonaId: string;
  zonaNombre: string;
  solicitadoPorId: string;
  solicitadoPorNombre: string; // resuelto (no id crudo)
  estado: CierreEstado; // solicitado | aprobado | rechazado
  totales: CierreTotales; // snapshot agregado (money-safe string, R13)
  totalPagoMensajero: string; // feature 39/R19/R20: snapshot agregado del pago a mensajeros (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R19: snapshot agregado del ingreso de bodega por rechazos (STRING)
  cantidadCierres: number; // # de cierre_dia incluidos
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO; null si solicitado (R20)
  motivoRechazo: string | null; // solo rechazado (R17)
}

// Cabecera de un `cierre_dia` consolidable (aprobado, sin cierre de bodega): mensajero
// + totales snapshot. Lo que ve el adminSatelite antes de solicitar (R5).
export interface CierreBodegaResumenLite {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (money-safe)
  totalPagoMensajero: string; // feature 39/R18: snapshot del pago al mensajero del cierre_dia (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R17: snapshot del ingreso de bodega por rechazos del cierre_dia (STRING)
}

// Un cierre_dia incluido, con su detalle de gestiones (reuso 37) + su total snapshot.
// R14/F1.4-f: NO incluye pago al mensajero (feature 39).
export interface CierreBodegaDetalleCierre {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (money-safe)
  totalPagoMensajero: string; // feature 39/R20: snapshot del pago al mensajero del cierre_dia (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R19: snapshot del ingreso de bodega por rechazos del cierre_dia (STRING)
  grupos: CierreGrupos; // por resultado (reuso CierreDetalleGestion de la 37, R11)
  // Totales por concepto del ingreso de Ordenex de ESTE cierre_dia (derivados del snapshot).
  totalesIngreso: TotalesIngresoOrdenex;
  // DERIVADO: `totalesIngreso.total` - `totalPagoMensajero` de ESTE cierre_dia (STRING).
  // Lo que le queda a Ordenex del dia de ese mensajero. Puede ser NEGATIVO.
  ganancia: string;
  // DERIVADO: `totales.general` - `fleteConIva` - `comisionConIva` de ESTE cierre_dia
  // (STRING money-safe). Lo que se le paga a la tienda. Puede ser NEGATIVO.
  pagoTienda: string;
}

// R1/R3-R7: consolidacion pendiente + totales agregados + gate de "Solicitar" +
// historico propio de la zona. `forbidden` si el rol no es adminSatelite (R1);
// `sinZona` si el adminSatelite no tiene zona (R4). `unauthenticated` lo resuelve el
// borde.
export type ListarConsolidacionServiceResult =
  | {
      status: "ok";
      consolidables: CierreBodegaResumenLite[]; // cierre_dia aprobados sin cierre de bodega (R5)
      totalesAgregados: CierreTotales; // suma de los consolidables (R10)
      totalPagoMensajeroAgregado: string; // feature 39/R18: suma snapshot del pago a mensajeros (STRING)
      totalIngresoBodegaRechazosAgregado: string; // feature 56/R17: suma snapshot del ingreso de bodega por rechazos (STRING)
      totalNetoAgregado: string; // DERIVADO: totalesAgregados.general - lo EFECTIVAMENTE pagado a mensajeros (STRING)
      totalCentralDebeAgregado: string; // DERIVADO: pago a mensajeros que el efectivo NO alcanzo a cubrir (STRING; "0.00" si alcanzo)
      puedesSolicitar: boolean; // R6/R7
      motivoBloqueo: string | null; // texto accionable si !puedesSolicitar
      cierresBodegaPasados: CierreBodegaResumen[]; // historico propio de la zona (F1.4-h)
      sinZona: boolean; // adminSatelite sin zona (R4)
    }
  | { status: "forbidden" }; // rol != adminSatelite (R1)

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA de los cierres de bodega SOLICITADOS por
 * la zona del adminSatelite + el total del conjunto. Contrato comun de T H.2, sin campos
 * extra: `sinZona` sigue siendo dato de la PANTALLA y llega por `listarConsolidacion`.
 */
export type ListarCierresBodegaSolicitadosServiceResult =
  ListarPaginadoServiceResult<CierreBodegaResumen>;

// R1/R4/R6-R10: solicitud del cierre de bodega. Sin input de negocio (el actor y su
// zona lo determinan todo). `conflict` cubre R6 (pendientes) / R7 (vacio) / R8
// (duplicado); `validation_error` cubre R4 (sin zona).
export type SolicitarCierreBodegaServiceResult =
  | { status: "ok"; cierreBodegaId: string; totales: CierreTotales }
  | { status: "forbidden" } // rol != adminSatelite (R1)
  | { status: "conflict"; motivo: string } // R6 pendientes / R7 vacio / R8 duplicado
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R4 sin zona

export interface ICierreBodegaService {
  /**
   * R1/R3-R7: lista los cierre_dia `aprobado` consolidables de la zona del
   * adminSatelite (cierre_bodega_id IS NULL), con sus totales agregados, el gate de
   * "Solicitar cierre de bodega" y el historico propio. Solo lectura (R23). Rol !=
   * adminSatelite -> forbidden; sin zona -> sinZona.
   */
  listarConsolidacion(actor: Actor): Promise<ListarConsolidacionServiceResult>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): los cierres de bodega SOLICITADOS por
   * la zona del actor, paginados en el servidor.
   *
   * PUNTO CALIENTE de este listado: el alcance no lo fija el ROL sino un DATO derivado del
   * actor —la zona del `adminSatelite`— y ese dato se resuelve server-side con el MISMO
   * `findUsuarioZonaId` que usa `listarConsolidacion`, jamas se acepta de la peticion. Un
   * fallo aqui no devuelve menos filas: devuelve el historico de dinero de OTRA bodega.
   * Rol distinto de `adminSatelite` -> forbidden; sin zona -> pagina vacia (no hay alcance
   * que consultar), exactamente lo que ve hoy.
   */
  listarCierresBodegaSolicitadosPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarCierresBodegaSolicitadosServiceResult>;
  /**
   * R1/R4/R6-R10: crea la solicitud de cierre de bodega (`solicitado`) consolidando
   * TODOS los cierre_dia aprobados de la zona, con snapshot de totales agregados
   * (R10) y vinculo atomico (R9). Precondiciones R6/R7/R8.
   */
  solicitarCierreBodega(actor: Actor): Promise<SolicitarCierreBodegaServiceResult>;
}
