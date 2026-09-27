import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularCobroRechazoTiendaInput,
  AnularCobroRechazoTiendaResult,
} from "@/lib/types/wallet-anulacion";
import type { RechazoTiendaCobroTxClient } from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import type { WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { WalletTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  AprobarCobroRechazoTiendaServiceResult,
  DecidirCobroRechazoTiendaInput,
  ListarCobrosRechazoTiendaServiceResult,
  RechazarCobroRechazoTiendaServiceResult,
} from "@/lib/types/rechazo-tienda-cobro";

// 💰 FICHA 337 (segunda mitad) — contrato del servicio de COBROS POR RECHAZO DESDE NOVEDADES:
// ver la cola, aprobar y rechazar. Logica de negocio pura (sin HTTP ni Prisma directo);
// resultados de dominio.
//
// ⚠️ QUIEN DECIDE: `esAccesoTotal` (maestro + admin), y esto es una DECISION EXPLICITA, no una
// omision. La ficha 333 introdujo `puedeDecidirCobroGastoFijo` (maestro y nadie mas) porque
// aquello autoriza dinero que SALE de la caja de Ordenex. Esto es lo contrario: cobrar a una
// tienda por un servicio ya prestado —el retorno del paquete—, y es operacion diaria. Estrechar
// el guard aqui pondria la caja diaria a esperar al maestro. Si el humano lo quiere solo-maestro,
// es una linea en `lib/auth/acceso-total.ts` y su predicado propio.

/**
 * El cliente que la transaccion de APROBAR necesita: las TRES tablas que esa transaccion toca, y
 * ninguna mas. `rechazo_tienda_cobro` (la decision), `wallet_movimiento` (la caja de Ordenex) y
 * `wallet_tienda_movimiento` (el libro de la tienda). Con este tipo, quien tenga el `tx` no puede
 * tocar gestiones, ordenes ni tarifas aunque quisiera.
 */
export type RechazoTiendaCobroTx = RechazoTiendaCobroTxClient &
  WalletTxClient &
  WalletTiendaTxClient &
  // Ficha 458-B (D7): la constancia de la ANULACION va en la misma transaccion que sus reversos.
  Pick<PrismaClient, "rechazoTiendaCobroAnulacion">;

/**
 * Ficha 458-B (D7, R63–R68) — resultado de DOMINIO de anular un cobro por rechazo aprobado. La
 * sesion y la forma son del borde.
 */
export type AnularCobroRechazoTiendaServiceResult = Exclude<
  AnularCobroRechazoTiendaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

/**
 * Ejecuta `fn` dentro de UNA transaccion y revierte si lanza: o quedan los apuntes de los DOS
 * libros Y el cobro aprobado, o no queda ninguna de las tres cosas.
 *
 * Se INYECTA por constructor y no se importa Prisma en el servicio: la logica de negocio no
 * conoce la base, igual que no conoce HTTP. En produccion es `(fn) => prisma.$transaction(fn)`;
 * en los tests, un runner en memoria con la misma semantica. Precedente literal:
 * `GastoFijoCobroTxRunner` (333) y `LiquidacionTxRunner`.
 */
export type RechazoTiendaCobroTxRunner = <T>(
  fn: (tx: RechazoTiendaCobroTx) => Promise<T>,
) => Promise<T>;

export interface IRechazoTiendaCobroService {
  /**
   * La cola de pendientes, del mas antiguo al mas reciente, recortada por el tope del servidor,
   * con el `total` real aparte. Guardia: `esAccesoTotal`.
   */
  listarPendientes(actor: Actor): Promise<ListarCobrosRechazoTiendaServiceResult>;
  /**
   * ⚠️ EL METODO QUE MUEVE DINERO. Dentro de UNA `$transaction`:
   *
   *   guardia de rol -> obtener -> `marcarDecidido(WHERE estado='pendiente')` -> si 0, ya_decidido
   *   -> los DOS ingresos en la caja de Ordenex con `origen = (gestion_orden, gestionId)`
   *   -> los DOS debitos espejo en el libro de la tienda CONGELADA
   *   -> `{ ok, yaEstabaEnElLibro: insertadas === 0 }`.
   *
   * Los apuntes son EXACTAMENTE los que hoy emite la aprobacion del cierre para una `rechazada`
   * (`WalletFeedService` + `WalletTiendaFeedService`): `ingreso_flete_devolucion` y
   * `ingreso_iva_flete_devolucion` en la caja, `flete_devolucion` e `iva_flete_devolucion` como
   * debitos de la tienda. No se inventa ninguna categoria.
   *
   * Los importes NO se recalculan: se cobra la COPIA que el cobro congelo, aunque la tarifa haya
   * cambiado entre el rechazo y la aprobacion. `ahora` se INYECTA: un test no puede depender de
   * un `new Date()` escondido dentro del servicio.
   */
  aprobar(
    input: DecidirCobroRechazoTiendaInput,
    actor: Actor,
    ahora: Date,
  ): Promise<AprobarCobroRechazoTiendaServiceResult>;
  /**
   * Deja el cobro en `rechazado` con quien y cuando, y NO escribe absolutamente nada en ningun
   * libro. No abre transaccion porque es UNA sola sentencia condicional, que ya es atomica. Un
   * cobro ya decidido responde `ya_decidido`.
   *
   * El «no» es durable: el cobro rechazado conserva su `gestion_id`, asi que la clave unica
   * impide que ese mismo rechazo vuelva a darse de alta.
   */
  rechazar(
    input: DecidirCobroRechazoTiendaInput,
    actor: Actor,
    ahora: Date,
  ): Promise<RechazarCobroRechazoTiendaServiceResult>;
  /**
   * ⚠️ FICHA 458-B (D7, R63–R68, R73) — ANULA un cobro YA APROBADO. Tambien mueve dinero, y la
   * decision atomica de arriba no se toca: esto no «des-aprueba» (el estado sigue `aprobado`, R73),
   * registra una constancia y los contra-asientos. Dentro de UNA transaccion:
   *
   *   guardia de rol (antes de leer) -> el cobro, que tiene que estar `aprobado`
   *   -> sus lineas ORIGINALES en los dos libros (sin la del flete en la caja: `no_anulable`)
   *   -> constancia (`skipDuplicates`: `0` ⇒ `ya_anulado`, sin escribir nada mas)
   *   -> los reversos de cargo en la caja (flete e IVA, cada uno por el monto de SU linea)
   *   -> los creditos espejo en la tienda SOLO por los debitos que existen.
   *
   * `ahora` se INYECTA y es el MISMO instante en los dos libros (R64).
   */
  anular(
    input: AnularCobroRechazoTiendaInput,
    actor: Actor,
    ahora: Date,
  ): Promise<AnularCobroRechazoTiendaServiceResult>;
}
