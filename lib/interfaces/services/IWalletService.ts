import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CajaResumenDTO,
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

/**
 * Feature 173 (T D.2, design §5.2) — las DOS cifras de la caja, ya derivadas en el SERVIDOR.
 *
 * SUSTITUYE a `VerBalanceServiceResult`, que llevaba una sola cifra (`WalletBalanceDTO`) y por
 * eso no podia distinguir el dinero de Ordenex del que solo pasa por la caja. `forbidden` no
 * viaja con cifra alguna (R65).
 */
export type VerResumenCajaServiceResult =
  | { status: "ok"; resumen: CajaResumenDTO }
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
  /**
   * Feature 173 (T D.2 — R8/R64/R65): las DOS cifras de la caja («dinero en caja» y «ganancia
   * de Ordenex») derivadas del conjunto filtrado, nunca de un saldo almacenado.
   *
   * Mismo guardia de rol que el listado (`esAccesoTotal`), evaluado ANTES de tocar la base
   * (R65), y los MISMOS filtros que el listado, resueltos por el mismo metodo privado (R8).
   * Montos SIEMPRE STRING (R64).
   */
  verResumenCaja(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<VerResumenCajaServiceResult>;
  /** R15/R19: solo maestro; registra un movimiento manual de AJUSTE (inmutable, R3). */
  registrarMovimientoManual(
    input: RegistrarMovimientoManualInput,
    actor: Actor,
  ): Promise<RegistrarMovimientoManualServiceResult>;
}
