import type { GestionResultado, MetodoPagoValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreEstado, CierreDestinoTipo } from "@/lib/types/cierre";

// Feature 37 — contrato del servicio del "Cierre del dia" del mensajero. Logica de
// negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado y resuelve `unauthenticated`. Solo el rol `mensajero`, SIEMPRE
// acotado a su `usuario.id` (R1/R2). Money-safe: los Decimal cruzan como STRING.

// Los 4 resultados posibles de una gestion (feature 36); discriminador del grupo.
export type CierreResultado = GestionResultado;

// DTO de una gestion incluida en el detalle del dia (R3/R4/R5/R6). Nombres ya
// resueltos (no IDs de catalogo). `montoRecibido` serializado a STRING (money-safe,
// R9), null salvo `entregada`. `evidenciaUrl` es la URL FIRMADA (R5), nunca el
// storage_path crudo.
export interface CierreDetalleGestion {
  gestionId: string;
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  direccion: string | null;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  producto: string;
  tiendaNombre: string;
  resultado: CierreResultado;
  montoRecibido: string | null; // Decimal->string; solo entregada (R6)
  metodoPago: MetodoPagoValue | null; // solo entregada (R6)
  motivo: string | null; // reprogramada/devuelta/rechazada (R4)
  fechaReprogramacion: string | null; // ISO date (YYYY-MM-DD); solo reprogramada (R4)
  evidenciaUrl: string | null; // URL FIRMADA (R5), nunca el storage_path
  // Feature 39/R10/R16: pago al mensajero (money-safe STRING). En la vista EN VIVO (37)
  // es DERIVADO por resultado+tarifa; en el detalle admin (38/40) es el snapshot leido.
  // `null` en cierres pre-migracion (R22). Concepto INDEPENDIENTE de montoRecibido (R21).
  pagoMensajero: string | null;
  // Feature 56/R9/R15: ingreso de bodega por rechazo (money-safe STRING). En la vista EN
  // VIVO (37) es DERIVADO por resultado+tarifa; en el detalle admin (38/40) es el snapshot
  // leido. `null` en cierres pre-migracion (R22). Concepto INDEPENDIENTE del pago al
  // mensajero (R7b) y del dinero recibido (R20). Solo `rechazada` con tarifa que aplica != 0.00.
  ingresoBodegaRechazo: string | null;
  // Feature 56/R23 (F1.4-Q6): flag derivado SERVER-SIDE. `true` SOLO cuando el resolver de
  // tarifa devolvio `null` (zona SIN tarifa capturada, incluye el caso sin zona); `false`
  // cuando existe tarifa aunque sus montos sean 0.00. Reemplaza la heuristica de frontend
  // `entregada && pago === "0.00"` de la 39, para entregas Y rechazos. En el detalle admin
  // (38/40), donde no se re-resuelve la tarifa (snapshot), es `false` por defecto.
  tarifaFaltante: boolean;
}

// Totales por metodo de pago + general (R7/R8). Decimal serializado a STRING (R9).
export interface CierreTotales {
  efectivo: string;
  simpe: string;
  transferencia: string;
  general: string;
}

// Grupos por resultado (R3): las 4 claves siempre presentes (aunque vacias).
export type CierreGrupos = Record<CierreResultado, CierreDetalleGestion[]>;

// Un cierre pasado del mensajero (R18): estado + destino + totales snapshot.
export interface CierrePasadoDTO {
  cierreId: string;
  estado: CierreEstado;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  totales: CierreTotales;
  totalPagoMensajero: string; // feature 39/R13: total snapshot del pago al mensajero (STRING)
  totalIngresoBodegaRechazos: string; // feature 56/R12: total snapshot del ingreso de bodega por rechazos (STRING)
  solicitadoAt: string; // ISO
}

// R2-R11/R17/R18: detalle del dia + totales + gate de "Solicitar cierre" +
// historico. `forbidden` si el rol no es mensajero (R1/R2). `unauthenticated` lo
// resuelve el borde (Server Action).
export type ListarCierreDiaServiceResult =
  | {
      status: "ok";
      grupos: CierreGrupos;
      totales: CierreTotales;
      totalPagoMensajero: string; // feature 39/R11: total DERIVADO del pago al mensajero (STRING), separado de `totales`
      totalIngresoBodegaRechazos: string; // feature 56/R10: total DERIVADO del ingreso de bodega por rechazos (STRING), separado de `totales` y del pago al mensajero
      puedesSolicitar: boolean; // R10/R11: false si hay pendientes o no hay gestiones
      motivoBloqueo: string | null; // texto accionable si !puedesSolicitar
      cierresPasados: CierrePasadoDTO[]; // R18
    }
  | { status: "forbidden" };

// R10-R16: solicitud de cierre. Sin input de negocio (el actor y sus gestiones lo
// determinan todo). `conflict` cubre R10 (pendientes) / R11 (vacio) / R12
// (duplicado); `validation_error` cubre R16 (sin zona).
export type SolicitarCierreServiceResult =
  | { status: "ok"; cierreId: string; totales: CierreTotales; destinoTipo: CierreDestinoTipo }
  | { status: "forbidden" } // rol != mensajero (R1)
  | { status: "conflict"; motivo: string } // R10 pendientes / R11 vacio / R12 duplicado
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R16 sin zona

export interface ICierreDiaService {
  /**
   * R2-R11/R17/R18: lista las gestiones del dia del mensajero (cierre_id IS NULL)
   * agrupadas por resultado, con totales por metodo de pago, el gate de "Solicitar
   * cierre" y el historico de cierres. Solo lectura (R17). Rol != mensajero ->
   * forbidden.
   */
  listarCierreDia(actor: Actor): Promise<ListarCierreDiaServiceResult>;
  /**
   * R10-R16: crea la solicitud de cierre (`solicitado`) agrupando TODAS las
   * gestiones pendientes del mensajero, con destino derivado por zona (R15) y
   * totales snapshot (R14). Todo-o-nada (R13).
   */
  solicitarCierre(actor: Actor): Promise<SolicitarCierreServiceResult>;
}
