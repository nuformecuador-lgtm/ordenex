import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";
import type {
  CierreGrupos,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 38 — contrato del servicio "Cierres del dia" del admin (maestro /
// adminSatelite). Logica de negocio pura (sin HTTP ni Prisma); el borde (Server
// Action) la traduce a resultado tipado y resuelve `unauthenticated`. Solo lectura +
// la transicion aprobar/rechazar. Money-safe: los Decimal cruzan como STRING (R9).
// REUSA CierreTotales / CierreGrupos (grupos por resultado) de la feature 37.

// Cabecera de un cierre dentro del alcance del admin (cola + historico, R2-R5/R8).
// Nombres ya resueltos (no IDs crudos). `totales` = snapshot money-safe (R8/R9).
export interface CierreAdminResumen {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  estado: CierreEstado; // solicitado | aprobado | rechazado
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  destinoZonaNombre: string;
  totales: CierreTotales; // snapshot (money-safe string, R8/R9)
  totalPagoMensajero: string; // feature 39/R17: snapshot total del pago al mensajero (STRING), separado de `totales`
  totalIngresoBodegaRechazos: string; // feature 56/R16: snapshot total del ingreso de bodega por rechazos (STRING), separado de `totales` y del pago al mensajero
  solicitadoAt: string; // ISO
  resueltoAt: string | null; // ISO; null si solicitado (F1.4-e)
  motivoRechazo: string | null; // solo rechazado (F1.4-e)
}

// R2-R5/R8/R9: cola de `solicitado` (pendientes) + historico (aprobado/rechazado)
// del alcance del actor. `sinZona` = adminSatelite sin zona (R3). `forbidden` = rol
// != maestro/adminSatelite (R1). `unauthenticated` lo resuelve el borde.
export type ListarCierresAdminServiceResult =
  | {
      status: "ok";
      pendientes: CierreAdminResumen[]; // estado=solicitado (R4)
      historico: CierreAdminResumen[]; // aprobado/rechazado (R5)
      sinZona: boolean; // adminSatelite sin zona (R3)
    }
  | { status: "forbidden" }; // rol != maestro/adminSatelite (R1)

// R6-R9/R13: detalle completo de UN cierre. Reusa CierreGrupos (grupos por
// resultado) de la 37. `no_encontrada` = id inexistente o fuera de alcance (R13, no
// se distingue). `forbidden` = rol invalido (R1).
export type CierreDetalleAdminServiceResult =
  | {
      status: "ok";
      cierre: CierreAdminResumen;
      grupos: CierreGrupos; // por resultado (reuso 37)
      // Totales por concepto del ingreso de Ordenex del cierre, derivados del snapshot.
      totalesIngreso: TotalesIngresoOrdenex;
      // Feature 102/R4-R8/R10: desglose money-safe (STRING escala 2) del ingreso de bodega por
      // rechazos, particionado por origen. `sla` = escalados del cron SLA (99); `manual` =
      // rechazos del mensajero; `total` = el SNAPSHOT `cierre.totalIngresoBodegaRechazos` (leido,
      // NO recomputado, R6). Por construccion `sla + manual === total` (R5). Solo en el DETALLE
      // (Q4); llega igual al alcance satelite por el mismo camino (R10).
      desgloseIngresoBodegaRechazos: { sla: string; manual: string; total: string };
      // DERIVADO: `totalesIngreso.total` - `cierre.totalPagoMensajero` (STRING money-safe).
      // Lo que le queda a Ordenex del cierre. Puede ser NEGATIVO.
      ganancia: string;
      // DERIVADO: `cierre.totales.general` - `fleteConIva` - `comisionConIva` (STRING
      // money-safe). Lo que se le paga a la tienda. Puede ser NEGATIVO.
      pagoTienda: string;
    }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" }; // id inexistente o de otra bodega/zona (R13)

// R10/R12-R14: aprobar un cierre `solicitado` del alcance.
export type AprobarCierreServiceResult =
  | { status: "ok"; cierreId: string; estado: "aprobado" }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" } // id inexistente / otra bodega-zona (R13)
  | { status: "conflict" }; // ya no esta `solicitado` (R12)

// R11-R14: rechazar un cierre `solicitado` del alcance; motivo obligatorio (R11).
export type RechazarCierreServiceResult =
  | { status: "ok"; cierreId: string; estado: "rechazado" }
  | { status: "forbidden" } // rol invalido (R1)
  | { status: "no_encontrada" } // id inexistente / otra bodega-zona (R13)
  | { status: "conflict" } // ya no esta `solicitado` (R12)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // motivo vacio (R11)

export interface ICierresAdminService {
  /**
   * R2-R5/R8/R9: lista los cierres del alcance del actor (rol+zona), partidos en
   * pendientes (`solicitado`) e historico (`aprobado`/`rechazado`), con totales
   * snapshot. Solo lectura (R16). Rol invalido -> forbidden; adminSatelite sin zona
   * -> sinZona.
   */
  listarCierresAdmin(actor: Actor): Promise<ListarCierresAdminServiceResult>;
  /**
   * R6-R9/R13/R16: detalle completo de un cierre del alcance (gestiones agrupadas
   * por resultado, evidencias firmadas). Solo lectura. Fuera de alcance ->
   * no_encontrada.
   */
  verCierreDetalle(cierreId: string, actor: Actor): Promise<CierreDetalleAdminServiceResult>;
  /**
   * R10/R12-R15: aprueba un cierre `solicitado` del alcance (transicion guardada).
   * Ya resuelto -> conflict; fuera de alcance -> no_encontrada.
   */
  aprobarCierre(cierreId: string, actor: Actor): Promise<AprobarCierreServiceResult>;
  /**
   * R11-R15: rechaza un cierre `solicitado` del alcance con motivo obligatorio
   * (transicion guardada). Motivo vacio -> validation_error; ya resuelto ->
   * conflict; fuera de alcance -> no_encontrada.
   */
  rechazarCierre(
    cierreId: string,
    motivo: string,
    actor: Actor,
  ): Promise<RechazarCierreServiceResult>;
}
