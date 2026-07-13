import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ListarMovimientosTiendaInput,
  SaldoTiendaDTO,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

// Feature 43 (design §2.1) — contrato del servicio de lectura del ledger POR TIENDA.
// Roles: `adminTienda` ve SU saldo/movimientos (acotado a su usuarioId = tienda_id, R19);
// `maestro` ve el saldo de TODAS las tiendas (R20). Resultados de dominio (sin acoplar a
// HTTP); el borde (Server Action) los traduce. Money-safe: los DTOs exponen montos STRING.

export interface ListarMisMovimientosPayload {
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  saldo: SaldoTiendaDTO; // saldo del conjunto filtrado (R22)
}

export type VerMiSaldoServiceResult =
  | { status: "ok"; saldo: SaldoTiendaDTO }
  | { status: "forbidden" };

export type ListarMisMovimientosServiceResult =
  | { status: "ok"; data: ListarMisMovimientosPayload }
  | { status: "forbidden" };

export type ListarSaldosTiendasServiceResult =
  | { status: "ok"; tiendas: SaldoTiendaResumenDTO[] }
  | { status: "forbidden" };

export interface IWalletTiendaService {
  /** R16/R17/R19: solo adminTienda; saldo a favor total DERIVADO, acotado a su tienda_id. */
  verMiSaldo(actor: Actor): Promise<VerMiSaldoServiceResult>;
  /** R19/R22: solo adminTienda; movimientos paginados + filtros, acotados a su tienda_id en el WHERE. */
  listarMisMovimientos(
    input: ListarMovimientosTiendaInput,
    actor: Actor,
  ): Promise<ListarMisMovimientosServiceResult>;
  /** R20: solo maestro; saldo a favor de TODAS las tiendas (una fila por tienda). */
  listarSaldosTiendas(actor: Actor): Promise<ListarSaldosTiendasServiceResult>;
}
