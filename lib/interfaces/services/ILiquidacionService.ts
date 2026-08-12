import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  LiquidacionAnulacionTxClient,
  LiquidacionCierreTxClient,
  LiquidacionPagoTxClient,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { LiquidacionRepartoTxClient } from "@/lib/interfaces/repositories/ILiquidacionRepartoRepository";
import type { PagoMensajeroTxClient } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { WalletTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { CajaPagoTiendaTxClient } from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type {
  AnularPagoInput,
  AnularPagoResult,
  ListarPagosResult,
  RegistrarPagoMensajeroInput,
  RegistrarPagoResult,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";
import type {
  PrevisualizarRepartoInput,
  PrevisualizarRepartoResult,
  RegistrarRepartoMensajeroInput,
  RegistrarRepartoResult,
} from "@/lib/types/liquidacion-reparto";

// Feature 172 (design §3.1) — contrato del servicio de LIQUIDACION. Un solo servicio para los
// tres actos (pagar a un mensajero, pagar a una tienda, anular), no tres: el 80 % —permisos,
// candado, validacion, idempotencia, atomicidad— es identico, y lo que cambia son tres piezas
// pequeñas (contra que se compara el monto, en que libro se escribe y con que signo). Tres
// servicios serian tres copias del camino money-critical (alternativa F, descartada).

/**
 * Lo que la transaccion del pago necesita: el documento y su candado
 * (`LiquidacionPagoTxClient`), la ANULACION (`LiquidacionAnulacionTxClient`, T F.1), la LECTURA
 * del cierre (`LiquidacionCierreTxClient`, R20: la guardia se lee dentro de la transaccion) y
 * el libro del beneficiario. Los dos libros van en el tipo aunque cada operacion escriba en
 * UNO: es el mismo `tx` de Prisma y el tipo describe la transaccion, no la operacion.
 *
 * **Feature 173 (design §4): + `CajaPagoTiendaTxClient`.** El egreso del pago a tienda y su
 * reverso van en ESTA misma transaccion (R19), asi que el `tx` tiene que llevar tambien el
 * libro de la caja. Lo escribe el PUERTO ESTRECHO (`ICajaPagoTiendaFeedService`), nunca el
 * servicio: `LiquidacionService` no nombra `walletMovimiento` ni una sola vez, y hay dos tests
 * estructurales —uno en cada suite de liquidacion— que lo miden sobre su fuente. Esa es la
 * compensacion explicita del escalon que la 173 baja: de «no tiene la puerta» a «la puerta solo
 * abre a dos sitios».
 */
export type LiquidacionTx = LiquidacionPagoTxClient &
  LiquidacionAnulacionTxClient &
  LiquidacionCierreTxClient &
  WalletTiendaTxClient &
  PagoMensajeroTxClient &
  CajaPagoTiendaTxClient &
  // Feature 205 (T3.2, R20/R29): la fila del ACTO de repartir se escribe en ESTA misma
  // transaccion y la PRIMERA de todas (design §5.1), asi que el `tx` tiene que llevar tambien su
  // delegado. Es un `Pick` de un solo modelo: quien tiene el `tx` puede insertar el acto y nada
  // mas — no hay por donde editarlo ni borrarlo (R52).
  LiquidacionRepartoTxClient;

/**
 * Ejecuta `fn` dentro de UNA transaccion y revierte si lanza (R39: o quedan el documento y su
 * movimiento, o no queda ninguno).
 *
 * Se inyecta por constructor y no se importa Prisma aqui: el servicio no conoce la base, igual
 * que no conoce HTTP. En produccion es `(fn) => prisma.$transaction(fn)`; en los tests, un
 * runner en memoria con la misma semantica (incluida la reversion).
 */
export type LiquidacionTxRunner = <T>(fn: (tx: LiquidacionTx) => Promise<T>) => Promise<T>;

/**
 * Resultado de DOMINIO de registrar un pago: el mismo contrato del borde MENOS las dos ramas
 * que no son suyas. `unauthenticated` lo decide la Server Action antes de instanciar el
 * servicio (R3) y `validation_error` lo decide zod en el borde (R8-R15); el servicio nunca las
 * emite, y restarlas del tipo impide que alguien las devuelva desde aqui por descuido.
 */
export type RegistrarPagoServiceResult = Exclude<
  RegistrarPagoResult,
  { status: "validation_error" } | { status: "unauthenticated" }
>;

/**
 * Resultado de DOMINIO de listar comprobantes: `ok` con la lista o `forbidden`. Mismo recorte
 * que arriba y por el mismo motivo — la sesion y la forma son del borde, no del servicio.
 */
export type ListarPagosServiceResult = Exclude<
  ListarPagosResult,
  { status: "validation_error" } | { status: "unauthenticated" }
>;

/**
 * T F.2 — resultado de DOMINIO de anular, con el mismo recorte que los dos de arriba. `ok`
 * devuelve el comprobante YA marcado (R74) y lo que vuelve a estar disponible (R71/R79);
 * `ya_anulado` devuelve el comprobante y **no** trae restante, porque esa segunda llamada no
 * movio ni un centimo (R75).
 */
export type AnularPagoServiceResult = Exclude<
  AnularPagoResult,
  { status: "validation_error" } | { status: "unauthenticated" }
>;

/**
 * Feature 205 (T3.1) — resultado de DOMINIO de PREVISUALIZAR un reparto, con el mismo recorte
 * que los tres de arriba y por el mismo motivo: la sesion y la forma son del borde.
 */
export type PrevisualizarRepartoServiceResult = Exclude<
  PrevisualizarRepartoResult,
  { status: "validation_error" } | { status: "unauthenticated" }
>;

/** Feature 205 (T3.2) — resultado de DOMINIO de REGISTRAR un reparto, con el mismo recorte. */
export type RegistrarRepartoServiceResult = Exclude<
  RegistrarRepartoResult,
  { status: "validation_error" } | { status: "unauthenticated" }
>;

export interface ILiquidacionService {
  /**
   * R21 — registra un pago a un MENSAJERO contra un cierre APROBADO concreto. Mismo esqueleto
   * que el de la tienda (guardia de rol, candado, disponible, documento + movimiento en una
   * transaccion) con tres diferencias, y las tres importan:
   *
   *  - el candado es el del CIERRE, no el del usuario (§4.2): lo que se consume es el pendiente
   *    de UN cierre, asi que dos pagos a cierres distintos del mismo mensajero no se estorban;
   *  - hay una guardia previa: el cierre debe existir y estar `aprobado` (R20), leido DENTRO de
   *    la transaccion; los otros tres estados (`solicitado`, `vencido`, `rechazado`) devuelven
   *    `cierre_no_aprobado` sin escribir nada;
   *  - el BENEFICIARIO sale del cierre, no de la peticion (R5): el cliente dice contra que
   *    cierre paga; a quien se le paga lo decide el servidor.
   */
  registrarPagoMensajero(
    input: RegistrarPagoMensajeroInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult>;
  /**
   * R29 — registra un pago a una TIENDA contra su saldo acumulado (sin cierre, decision 4 del
   * humano). Guardia de rol ANTES de tocar datos (R1/R2/R5/R6); disponible leido BAJO CANDADO
   * (R83); documento y movimiento del libro en la MISMA transaccion (R39).
   *
   * **Feature 173 (R18/R19/R20): + una TERCERA escritura en esa misma transaccion**, el egreso
   * `egreso_pago_tienda` de la caja principal, emitido por el puerto estrecho. Sustituye a la
   * mitad-tienda de R40 de la 172 («ni una fila en la caja»), que ya no aplica: el
   * contra-entrega entra en la caja al aprobar el cierre, asi que ese dinero SI esta ahi. La
   * mitad-mensajero de R40 sigue intacta ([P2] = (a)).
   */
  registrarPagoTienda(
    input: RegistrarPagoTiendaInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult>;
  /**
   * T F.2 (R69-R71, R76, R77, R81, R82, R84) — ANULA un pago: añade el contraasiento del signo
   * opuesto por el MISMO monto, jamas borra ni edita.
   *
   * Cuatro invariantes que este contrato ya impone por su forma:
   *
   *  - **El monto no se acepta de la peticion** (R70): `AnularPagoInput` es `{ pagoId, motivo }`
   *    y nada mas. El importe del reverso sale del pago leido en el servidor. Si el cliente
   *    pudiera dictarlo, anular seria una via para escribir cualquier cifra en el libro.
   *  - **No se puede anular a medias** (R76): no hay campo por el que pedirlo.
   *  - **No se puede anular una anulacion** (R82): no existe metodo para deshacerla. Si la
   *    anulacion fue un error, la correccion es registrar el pago de nuevo (R79).
   *  - **Mismo gate que pagar** ([P3]/R81): `maestro` y `admin`. Quien no puede mover el dinero
   *    tampoco puede deshacer un movimiento.
   *
   * Toma EL MISMO bloqueo que tomaria su pago (R84/§4.2), uno solo (R85), para que una anulacion
   * y un registro simultaneos no lean el mismo disponible.
   */
  anularPago(input: AnularPagoInput, actor: Actor): Promise<AnularPagoServiceResult>;
  /**
   * Feature 205 (T3.1, R32-R38/R56/R57) — QUE PASARIA si se repartiera este importe. Solo
   * lectura y **sin efecto alguno** (R35): no abre transaccion, no toma ningun bloqueo y no
   * invoca ningun metodo de escritura. Hay un test que lo mide contando llamadas sobre los
   * dobles, no leyendo el codigo.
   *
   * Sin `monto` devuelve el conjunto imputable y sus avisos (es lo que abre el dialogo y decide
   * si el boton se habilita); con `monto`, ademas las imputaciones que produciria.
   *
   * **Es una ADVERTENCIA, no un contrato ni una reserva** (design §6.1). No congela nada, no
   * aparta ningun cierre y no vale como promesa: al confirmar, el reparto se recalcula BAJO
   * BLOQUEO (R23) y lo que se aplica puede diferir de lo que se enseño. Convertirla en una
   * reserva exigiria mantener bloqueos entre dos peticiones HTTP, que es justo lo que nadie
   * quiere en una pantalla de dinero.
   *
   * MISMO gate que registrar (`esAccesoTotal`, R1/R4): dice cuanto se le debe a una persona y por
   * que cierres — la misma superficie de dinero, no «solo lectura».
   */
  previsualizarRepartoMensajero(
    input: PrevisualizarRepartoInput,
    actor: Actor,
  ): Promise<PrevisualizarRepartoServiceResult>;
  /**
   * Feature 205 (T3.2, R14/R18-R25/R28/R29/R55/R57/R58) — REPARTE un importe entre los cierres
   * pendientes del mensajero, del mas antiguo al mas reciente, en UN solo acto.
   *
   * Cinco invariantes que este contrato impone por su FORMA, antes de mirar la implementacion:
   *
   *  - **la peticion no elige cierre** (R9): `RegistrarRepartoMensajeroInput` no tiene `cierreId`
   *    y su schema es `.strict()`. Contra que se imputa lo decide el servidor;
   *  - **un solo metodo, una sola referencia y una sola fecha** (R58): no hay forma de expresar
   *    una por cierre, asi que las N imputaciones no pueden discrepar;
   *  - **todo o nada** (R20): devuelve el reparto aplicado o no escribe nada. No existe un
   *    resultado «se pagaron 2 de 4»;
   *  - **el grano del bloqueo no cambia** (R21): se toma el MISMO bloqueo por cierre que toma el
   *    pago contra un cierre unico, uno por cada cierre que se toca, y en el orden determinista
   *    del reparto (R22) — que es lo unico que separa esto de un interbloqueo;
   *  - **no se puede editar ni borrar** (R52): no hay metodo que lo haga, ni aqui ni en el
   *    repositorio. Deshacer un reparto es anular sus pagos, uno a uno.
   */
  registrarRepartoMensajero(
    input: RegistrarRepartoMensajeroInput,
    actor: Actor,
  ): Promise<RegistrarRepartoServiceResult>;
  /**
   * R49/R56/R74 — los comprobantes de UN cierre, anulados incluidos y marcados.
   *
   * MISMO gate que registrar (`esAccesoTotal`, [P3]/R1): quien no puede mover el dinero tampoco
   * ve el detalle de como se movio. El `adminTienda` y el `mensajero` ven LO SUYO por sus
   * propias pantallas (`/mi-wallet`, `/mis-pagos`), que leen el LIBRO, no esta lista.
   *
   * Devuelve `PagoRegistradoDTO[]`: el NOMBRE de quien registro (nunca su id) y, si lo hay, el
   * bloque de anulacion con el nombre de quien anulo. Ni un identificador interno cruza (R56).
   */
  listarPagosDeCierre(cierreId: string, actor: Actor): Promise<ListarPagosServiceResult>;
  /** R50/R56/R74 — idem para una TIENDA (sus pagos van contra el saldo acumulado, sin cierre). */
  listarPagosDeTienda(tiendaId: string, actor: Actor): Promise<ListarPagosServiceResult>;
}
