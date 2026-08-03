import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DesgloseTiendaDTO,
  ListarMovimientosDeTiendaCompletoInput,
  ListarMovimientosDeTiendaInput,
  ListarMovimientosDeTiendaResult,
  ListarMovimientosTiendaCompletoInput,
  ListarMovimientosTiendaInput,
  SaldoTiendaDTO,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

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
  /**
   * Feature 172 (T G.2, R55) `[P5]` — los TRES importes de la cabecera de `/mi-wallet` (a
   * favor / cargos / pagado) del MISMO conjunto filtrado.
   *
   * Es el mismo `DesgloseTiendaDTO` que devuelve `listarMovimientosDeTienda` al maestro, y
   * sale de la MISMA funcion (`derivarDesgloseTienda`): la tienda y quien le paga tienen que
   * leer la misma cifra del mismo libro. No es redundante con `saldo`: aquel parte de
   * credito/debito y por eso mete el pago recibido dentro de «debitos», que es exactamente lo
   * que R55 existe para impedir.
   *
   * REQUERIDO a proposito. Opcional dejaria que la cabecera se pintara con huecos el dia que
   * un consumidor se olvidara de emitirlo, y un hueco en una pantalla de dinero se lee como
   * «no hay nada», no como «no lo se».
   */
  desglose: DesgloseTiendaDTO;
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

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41): UNA PAGINA de los saldos por tienda + el total de
 * tiendas del conjunto. Contrato comun de T H.2, sin campos extra.
 */
export type ListarSaldosTiendasPaginadoServiceResult =
  ListarPaginadoServiceResult<SaldoTiendaResumenDTO>;

/**
 * Feature 171 — desglose de UNA tienda ELEGIDA (superficie del acceso total).
 *
 * Contrapartida exacta de `listarMisMovimientos`, con el alcance invertido: alli la tienda ve
 * lo suyo y el acotado sale del ACTOR; aqui el maestro elige la tienda y el acotado sale del
 * INPUT, con el permiso fijado por el ROL. `forbidden` NUNCA viaja con `data` (R27).
 */
export type ListarMovimientosDeTiendaServiceResult =
  | { status: "ok"; data: ListarMovimientosDeTiendaResult }
  | { status: "forbidden" };

/**
 * Feature 171 (R37/R39/R40) — el MISMO desglose sin recorte por pagina, para la descarga.
 * Mismo guard de rol, los MISMOS filtros y el mismo `tiendaId`. Ni `forbidden` ni
 * `limite_excedido` viajan con filas.
 */
export type ListarMovimientosDeTiendaCompletoServiceResult =
  ListarCompletoServiceResult<WalletTiendaMovimientoDTO>;

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
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): los saldos por tienda, paginados en el
   * servidor.
   *
   * MISMA guardia de rol que `listarSaldosTiendas` (`esAccesoTotal`, R20) evaluada ANTES de
   * tocar el repositorio, y MISMA agregacion: paginar no puede ensanchar el alcance de nadie
   * (R44). Un `adminTienda` recibe `forbidden` — su superficie es `listarMisMovimientos`, que
   * acota por el actor; abrir esta le daria el saldo de su competencia.
   */
  listarSaldosTiendasPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarSaldosTiendasPaginadoServiceResult>;
  /**
   * Feature 171 (R22/R24/R26/R27/R28) — desglose de UNA tienda elegida: pagina de movimientos
   * + total del conjunto filtrado + los cuatro importes de la cabecera, en una sola respuesta.
   * SOLO acceso total, y el guard se evalua ANTES de tocar el repositorio: con el guard
   * despues, el dato ya habria salido de la base aunque la respuesta fuera un error.
   * `adminTienda` recibe `forbidden` incluso pidiendo su PROPIA tienda (su superficie es
   * `listarMisMovimientos`, que acota por el actor).
   */
  listarMovimientosDeTienda(
    input: ListarMovimientosDeTiendaInput,
    actor: Actor,
  ): Promise<ListarMovimientosDeTiendaServiceResult>;
  /**
   * Feature 171 (R37/R39/R40) — el MISMO desglose sin recorte por pagina, para la descarga.
   * Mismo guard, los MISMOS filtros, `take: tope + 1` y el guard del tope.
   */
  listarMovimientosDeTiendaCompleto(
    input: ListarMovimientosDeTiendaCompletoInput,
    actor: Actor,
  ): Promise<ListarMovimientosDeTiendaCompletoServiceResult>;
}
