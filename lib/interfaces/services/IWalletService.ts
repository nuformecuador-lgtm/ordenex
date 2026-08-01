import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  WalletBalanceDTO,
  WalletMovimientoDTO,
  ListarMovimientosCompletoInput,
  ListarMovimientosInput,
  RegistrarMovimientoManualInput,
} from "@/lib/types/wallet";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

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

/**
 * Feature 170 (T C.1) — el libro de caja SIN recorte por pagina, para la descarga.
 *
 * Forma deliberadamente distinta de `ListarMovimientosServiceResult`: aqui NO hay `data`
 * anidada ni `page`/`pageSize` (no habria que poner en ellos), y la forma es la comun a los
 * siete `listarCompleto` de la feature — lo que permite que el adaptador de cliente sea uno
 * solo. Ni `forbidden` ni `limite_excedido` viajan con filas (R17/R27).
 */
export type ListarMovimientosCompletoServiceResult =
  ListarCompletoServiceResult<WalletMovimientoDTO>;

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
  /**
   * Feature 170/R9: el MISMO libro sin recorte por pagina, para la descarga. Mismo guard de
   * rol (`esAccesoTotal`) y los MISMOS filtros que `listarMovimientos` —construidos por el
   * mismo metodo privado—, con `take: tope + 1` y el guard del tope (R27/R29).
   */
  listarMovimientosCompleto(
    input: ListarMovimientosCompletoInput,
    actor: Actor,
  ): Promise<ListarMovimientosCompletoServiceResult>;
  /** R16/R19: solo maestro; balance derivado (STRING+signo) del conjunto filtrado. */
  verBalance(input: ListarMovimientosInput, actor: Actor): Promise<VerBalanceServiceResult>;
  /** R15/R19: solo maestro; registra un movimiento manual de AJUSTE (inmutable, R3). */
  registrarMovimientoManual(
    input: RegistrarMovimientoManualInput,
    actor: Actor,
  ): Promise<RegistrarMovimientoManualServiceResult>;
}
