import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado } from "@/lib/types/cierre";
import type {
  CierreGrupos,
  CierreTotales,
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
}

// Un cierre_dia incluido, con su detalle de gestiones (reuso 37) + su total snapshot.
// R14/F1.4-f: NO incluye pago al mensajero (feature 39).
export interface CierreBodegaDetalleCierre {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales; // snapshot del cierre_dia (money-safe)
  totalPagoMensajero: string; // feature 39/R20: snapshot del pago al mensajero del cierre_dia (STRING)
  grupos: CierreGrupos; // por resultado (reuso CierreDetalleGestion de la 37, R11)
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
      puedesSolicitar: boolean; // R6/R7
      motivoBloqueo: string | null; // texto accionable si !puedesSolicitar
      cierresBodegaPasados: CierreBodegaResumen[]; // historico propio de la zona (F1.4-h)
      sinZona: boolean; // adminSatelite sin zona (R4)
    }
  | { status: "forbidden" }; // rol != adminSatelite (R1)

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
   * R1/R4/R6-R10: crea la solicitud de cierre de bodega (`solicitado`) consolidando
   * TODOS los cierre_dia aprobados de la zona, con snapshot de totales agregados
   * (R10) y vinculo atomico (R9). Precondiciones R6/R7/R8.
   */
  solicitarCierreBodega(actor: Actor): Promise<SolicitarCierreBodegaServiceResult>;
}
