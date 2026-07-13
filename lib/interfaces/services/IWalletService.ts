import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  WalletBalanceDTO,
  WalletMovimientoDTO,
  ListarMovimientosInput,
  RegistrarMovimientoManualInput,
} from "@/lib/types/wallet";

// Feature 42 (design §2.1) — contrato del servicio de la wallet (libro + balance +
// manual). Rol autorizado: maestro (R19). Resultados de dominio (sin acoplar a HTTP);
// el borde (Server Action) los traduce. Money-safe: los DTOs exponen montos como STRING.

export interface ListarMovimientosPayload {
  movimientos: WalletMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export type ListarMovimientosServiceResult =
  | { status: "ok"; data: ListarMovimientosPayload }
  | { status: "forbidden" };

export type VerBalanceServiceResult =
  | { status: "ok"; balance: WalletBalanceDTO }
  | { status: "forbidden" };

export type RegistrarMovimientoManualServiceResult =
  | { status: "ok"; movimiento: WalletMovimientoDTO }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export interface IWalletService {
  /** R19/R20: solo maestro; lista el libro paginado con filtros. Forbidden sin exponer datos. */
  listarMovimientos(input: ListarMovimientosInput, actor: Actor): Promise<ListarMovimientosServiceResult>;
  /** R16/R19: solo maestro; balance derivado (STRING+signo) del conjunto filtrado. */
  verBalance(input: ListarMovimientosInput, actor: Actor): Promise<VerBalanceServiceResult>;
  /** R15/R19: solo maestro; registra un movimiento manual de AJUSTE (inmutable, R3). */
  registrarMovimientoManual(
    input: RegistrarMovimientoManualInput,
    actor: Actor,
  ): Promise<RegistrarMovimientoManualServiceResult>;
}
