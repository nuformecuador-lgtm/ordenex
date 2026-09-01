import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CajaResumenDTO,
  ComposicionGananciaDTO,
  WalletMovimientoDTO,
  ListarMovimientosCompletoInput,
  ListarMovimientosDeFilaInput,
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
 *
 * Feature 231 (design §2.4, R24/R30): la rama `ok` gana `composicion` —la ganancia abierta
 * concepto por concepto—, derivada del MISMO array de filas que `resumen` y en la MISMA
 * llamada. No hay accion nueva ni segundo viaje al servidor (design §6.3): un segundo
 * `groupBy` en otro instante podria enseñar unos ingresos que no suman la ganancia que la
 * tarjeta de al lado esta mostrando. `forbidden` sigue viajando SIN datos (R30).
 */
export type VerResumenCajaServiceResult =
  | { status: "ok"; resumen: CajaResumenDTO; composicion: ComposicionGananciaDTO }
  | { status: "forbidden" };

/**
 * Ficha 339 (T3.3/T3.5, design §4.2) — los movimientos que componen UNA fila de la tarjeta de la
 * ganancia, paginados.
 *
 * Reutiliza `ListarMovimientosPayload` —`movimientos`, `total`, `page`, `pageSize`— porque es
 * literalmente un recorte del MISMO libro y ya viaja con los montos como STRING (R34). El
 * `total` es el del CONJUNTO y lo cuenta la base, nunca el largo de la pagina (R31).
 *
 * `forbidden` NO viaja con filas (R38): quien no tiene acceso total no recibe ni un movimiento.
 */
export type ListarMovimientosDeFilaServiceResult =
  | { status: "ok"; data: ListarMovimientosPayload }
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
  /**
   * Ficha 339 (T3.3, design §4.3 — R18/R20/R33/R38/R39) — el detalle de UNA fila de la tarjeta
   * de la ganancia: los movimientos que componen su importe, paginados.
   *
   * El cliente manda un TOKEN de fila y jamas una lista de categorias: el conjunto lo resuelve
   * el servidor con `categoriasDeFilaComposicion`, LA MISMA definicion con la que
   * `derivarComposicionGanancia` deriva el importe de esa fila. Si hubiera dos definiciones, el
   * importe y su detalle podrian discrepar y nadie lo veria.
   *
   * Mismo guardia de rol que el listado (`esAccesoTotal`), evaluado ANTES de tocar la base
   * (R39), y los MISMOS filtros del libro, resueltos por el mismo metodo privado (R20). Ni una
   * operacion de dinero nueva: esto LEE importes que ya estaban derivados.
   */
  listarMovimientosDeFila(
    input: ListarMovimientosDeFilaInput,
    actor: Actor,
  ): Promise<ListarMovimientosDeFilaServiceResult>;
  /** R15/R19: solo maestro; registra un movimiento manual de AJUSTE (inmutable, R3). */
  registrarMovimientoManual(
    input: RegistrarMovimientoManualInput,
    actor: Actor,
  ): Promise<RegistrarMovimientoManualServiceResult>;
}
