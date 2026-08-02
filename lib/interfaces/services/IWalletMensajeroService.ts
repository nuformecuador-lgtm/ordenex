import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CuentaPorPagarDTO,
  CuentaPorPagarResumenDTO,
  ListarMisPagosCompletoInput,
  ListarPagosDeMensajeroCompletoInput,
  ListarPagosDeMensajeroInput,
  ListarPagosDeMensajeroResult,
  ListarPagosMensajeroInput,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

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

/**
 * Feature 170 (T C.1) — los pagos PROPIOS del mensajero, sin recorte por pagina.
 *
 * El otro punto caliente de R14/R15 (junto al ledger de la tienda): el conjunto lo define
 * `mensajero_id = actor.usuarioId`, un DATO del actor. Un fallo aqui entrega en un `xlsx`
 * los pagos de otro mensajero. Ni `forbidden` ni `limite_excedido` viajan con filas.
 */
export type ListarMisPagosCompletoServiceResult =
  ListarCompletoServiceResult<PagoMensajeroMovimientoDTO>;

/**
 * Feature 170 (T C.1) — el desglose de UN mensajero elegido, sin recorte por pagina. A
 * diferencia del anterior, el `mensajeroId` viene del INPUT: es la vista de los roles de
 * acceso total, que no estan acotados a si mismos. El guard `esAccesoTotal` es lo unico que
 * separa las dos superficies, y por eso es el mismo que el del listado.
 */
export type ListarPagosDeMensajeroCompletoServiceResult =
  ListarCompletoServiceResult<PagoMensajeroMovimientoDTO>;

export interface IWalletMensajeroService {
  /** R16/R20: solo mensajero; cuenta por pagar total DERIVADA, acotada a su mensajero_id. */
  verMiCuentaPorPagar(actor: Actor): Promise<VerMiCuentaPorPagarServiceResult>;
  /** R20/R22: solo mensajero; movimientos paginados + filtros, acotados a su mensajero_id en el WHERE. */
  listarMisPagos(
    input: ListarPagosMensajeroInput,
    actor: Actor,
  ): Promise<ListarMisPagosServiceResult>;
  /**
   * Feature 170/R9/R14/R15: los MISMOS pagos propios sin recorte por pagina, para la
   * descarga. Mismo guard (`mensajero`), los MISMOS filtros que la pantalla y el acotado a
   * `mensajero_id = actor.usuarioId` escrito AL FINAL, con `take: tope + 1` (R27/R29).
   */
  listarMisPagosCompleto(
    input: ListarMisPagosCompletoInput,
    actor: Actor,
  ): Promise<ListarMisPagosCompletoServiceResult>;
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
