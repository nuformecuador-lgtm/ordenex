import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ListarMovimientosTiendaCompletoInput,
  ListarMovimientosTiendaInput,
  SaldoTiendaDTO,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

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

/**
 * Feature 170 (T C.1) — el ledger de la tienda del actor SIN recorte por pagina, para la
 * descarga. Es uno de los DOS puntos calientes de R14/R15 de la feature: el conjunto lo
 * define un dato del actor (`tienda_id = actor.usuarioId`), no su rol, asi que un fallo
 * aqui no reduce el archivo: lo llena de movimientos de OTRA tienda. Ni `forbidden` ni
 * `limite_excedido` viajan con filas (R17/R27).
 */
export type ListarMisMovimientosCompletoServiceResult =
  ListarCompletoServiceResult<WalletTiendaMovimientoDTO>;

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
  /**
   * Feature 170/R9/R14/R15: el MISMO ledger sin recorte por pagina, para la descarga. Mismo
   * guard (`adminTienda`), los MISMOS filtros que la pantalla y el acotado a `tienda_id =
   * actor.usuarioId` escrito AL FINAL, con `take: tope + 1` y el guard del tope (R27/R29).
   */
  listarMisMovimientosCompleto(
    input: ListarMovimientosTiendaCompletoInput,
    actor: Actor,
  ): Promise<ListarMisMovimientosCompletoServiceResult>;
  /** R20: solo maestro; saldo a favor de TODAS las tiendas (una fila por tienda). */
  listarSaldosTiendas(actor: Actor): Promise<ListarSaldosTiendasServiceResult>;
}
