import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CuentaPorPagarResumenDTO,
  ListarCuentasPorPagarCompletoInput,
  ListarCuentasPorPagarPaginadoInput,
  ListarPagosDeMensajeroCompletoInput,
  ListarPagosDeMensajeroInput,
  ListarPagosDeMensajeroResult,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 44 (design §2.1) — contrato del servicio de lectura del LIBRO del pago por mensajero.
// Rol: `maestro` (acceso total) ve las cuentas por pagar de TODOS los mensajeros (R18/R19).
// Resultados de dominio (sin acoplar a HTTP); el borde (Server Action) los traduce. Money-safe:
// DTOs con montos STRING.
//
// Ficha 336 (2026-08-30): se retiraron las TRES lecturas de la vista propia del mensajero
// (`verMiCuentaPorPagar`, `listarMisPagos`, `listarMisPagosCompleto`) con sus tipos de resultado
// y `ListarMisPagosPayload`. Su unica superficie era `/mis-pagos`, borrada por decision humana.
// `CuentaPorPagarDTO` sigue VIVO en `lib/types/wallet-mensajero.ts` (lo usan
// `DesglosePagosMensajero` y `lib/utils/cuenta-por-pagar.ts`); lo que se va de AQUI es el import,
// que se quedo sin ninguna firma que lo nombrara.

export type ListarCuentasPorPagarServiceResult =
  | { status: "ok"; mensajeros: CuentaPorPagarResumenDTO[] }
  | { status: "forbidden" };

export type ListarPagosDeMensajeroServiceResult =
  | { status: "ok"; data: ListarPagosDeMensajeroResult }
  | { status: "forbidden" };

/**
 * Feature 170 — FASE 2 (T L.1, R40/R41): la PAGINA del listado del maestro, con el total del
 * conjunto que casa la busqueda. Contrato comun de T H.2, sin un solo campo extra.
 *
 * `forbidden` NUNCA viaja con filas ni con el total: un conteo de cuentas por pagar tambien es
 * informacion del conjunto.
 */
export type ListarCuentasPorPagarPaginadoServiceResult =
  ListarPaginadoServiceResult<CuentaPorPagarResumenDTO>;

/**
 * Feature 170 — FASE 2 (T M.1, cierre de Q-L2): el MISMO listado del maestro sin recorte por
 * pagina, para la descarga (R52).
 *
 * Es el hermano de la pagina, el par `listar` / `listarCompleto` que T H.2 dejo escrito como
 * las DOS lecturas de un mismo listado. Sin el, la pantalla paginada tenia que releer el
 * listado ENTERO sin busqueda y volver a filtrarlo en el navegador: el conjunto completo
 * cruzaba igual y el criterio de busqueda vivia escrito dos veces, en dos capas.
 *
 * `limite_excedido` se decide AQUI (R29): el tope es del servidor, y devolver el conjunto
 * entero para que el cliente lo cuente es exactamente lo que R29 prohibe.
 */
export type ListarCuentasPorPagarCompletoServiceResult =
  ListarCompletoServiceResult<CuentaPorPagarResumenDTO>;

/**
 * Feature 170 (T C.1) — el desglose de UN mensajero elegido, sin recorte por pagina. A
 * diferencia del anterior, el `mensajeroId` viene del INPUT: es la vista de los roles de
 * acceso total, que no estan acotados a si mismos. El guard `esAccesoTotal` es lo unico que
 * separa las dos superficies, y por eso es el mismo que el del listado.
 */
export type ListarPagosDeMensajeroCompletoServiceResult =
  ListarCompletoServiceResult<PagoMensajeroMovimientoDTO>;

export interface IWalletMensajeroService {
  /** R18/R19: solo maestro; cuenta por pagar de TODOS los mensajeros (una fila por mensajero). */
  listarCuentasPorPagar(actor: Actor): Promise<ListarCuentasPorPagarServiceResult>;
  /**
   * Feature 170 — FASE 2 (T L.1, R40/R41/R45/R51): el MISMO listado, en paginas y con la
   * busqueda por nombre resuelta en el SERVIDOR. Mismo guard (`esAccesoTotal`) y mismo
   * conjunto: lo unico que cambia es que la pantalla deja de recibirlo entero.
   */
  listarCuentasPorPagarPaginado(
    input: ListarCuentasPorPagarPaginadoInput,
    actor: Actor,
  ): Promise<ListarCuentasPorPagarPaginadoServiceResult>;
  /**
   * Feature 170 — FASE 2 (T M.1, cierre de Q-L2): el MISMO listado sin recorte por pagina,
   * para la descarga. Mismo guard (`esAccesoTotal`), MISMA busqueda que la pantalla tiene
   * puesta y el tope de filas aplicado en el SERVIDOR (R26/R27/R29).
   */
  listarCuentasPorPagarCompleto(
    input: ListarCuentasPorPagarCompletoInput,
    actor: Actor,
  ): Promise<ListarCuentasPorPagarCompletoServiceResult>;
  /**
   * R18/R22: solo maestro; DESGLOSE por cierre de UN mensajero ARBITRARIO (paginado, mas reciente
   * primero) con filtros server-side por fecha/cierre. El saldo (cuenta por pagar) refleja el
   * CONJUNTO FILTRADO. El `mensajeroId` viene del input (el maestro elige), no del actor: es lo
   * que lo separaba de `listarMisPagos`, la vista propia que la ficha 336 retiro.
   */
  listarPagosDeMensajero(
    input: ListarPagosDeMensajeroInput,
    actor: Actor,
  ): Promise<ListarPagosDeMensajeroServiceResult>;
  /**
   * Feature 170/R9: el MISMO desglose de UN mensajero sin recorte por pagina, para la
   * descarga. Mismo guard (`esAccesoTotal`) y los MISMOS filtros que la pantalla, con
   * `take: tope + 1` y el guard del tope (R27/R29).
   */
  listarPagosDeMensajeroCompleto(
    input: ListarPagosDeMensajeroCompletoInput,
    actor: Actor,
  ): Promise<ListarPagosDeMensajeroCompletoServiceResult>;
}
