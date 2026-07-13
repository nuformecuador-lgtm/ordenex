import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CuentaPorPagarDTO,
  CuentaPorPagarResumenDTO,
  ListarPagosDeMensajeroInput,
  ListarPagosDeMensajeroResult,
  ListarPagosMensajeroInput,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (design §2.1) — contrato del servicio de lectura del LIBRO del pago por mensajero.
// Roles: `mensajero` ve SU cuenta por pagar/movimientos (acotado a su usuarioId = mensajero_id,
// R20); `maestro` ve las cuentas por pagar de TODOS los mensajeros (R18/R19). Resultados de
// dominio (sin acoplar a HTTP); el borde (Server Action) los traduce. Money-safe: DTOs con
// montos STRING.

export interface ListarMisPagosPayload {
  movimientos: PagoMensajeroMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  cuenta: CuentaPorPagarDTO; // cuenta por pagar del conjunto filtrado (R22)
}

export type VerMiCuentaPorPagarServiceResult =
  | { status: "ok"; cuenta: CuentaPorPagarDTO }
  | { status: "forbidden" };

export type ListarMisPagosServiceResult =
  | { status: "ok"; data: ListarMisPagosPayload }
  | { status: "forbidden" };

export type ListarCuentasPorPagarServiceResult =
  | { status: "ok"; mensajeros: CuentaPorPagarResumenDTO[] }
  | { status: "forbidden" };

export type ListarPagosDeMensajeroServiceResult =
  | { status: "ok"; data: ListarPagosDeMensajeroResult }
  | { status: "forbidden" };

export interface IWalletMensajeroService {
  /** R16/R20: solo mensajero; cuenta por pagar total DERIVADA, acotada a su mensajero_id. */
  verMiCuentaPorPagar(actor: Actor): Promise<VerMiCuentaPorPagarServiceResult>;
  /** R20/R22: solo mensajero; movimientos paginados + filtros, acotados a su mensajero_id en el WHERE. */
  listarMisPagos(
    input: ListarPagosMensajeroInput,
    actor: Actor,
  ): Promise<ListarMisPagosServiceResult>;
  /** R18/R19: solo maestro; cuenta por pagar de TODOS los mensajeros (una fila por mensajero). */
  listarCuentasPorPagar(actor: Actor): Promise<ListarCuentasPorPagarServiceResult>;
  /**
   * R18/R22: solo maestro; DESGLOSE por cierre de UN mensajero ARBITRARIO (paginado, mas reciente
   * primero) con filtros server-side por fecha/cierre. El saldo (cuenta por pagar) refleja el
   * CONJUNTO FILTRADO. A diferencia de `listarMisPagos`, el `mensajeroId` viene del input (el
   * maestro elige), no del actor.
   */
  listarPagosDeMensajero(
    input: ListarPagosDeMensajeroInput,
    actor: Actor,
  ): Promise<ListarPagosDeMensajeroServiceResult>;
}
