import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { LiquidacionPagoTxClient } from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { PagoMensajeroTxClient } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { WalletTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { RegistrarPagoResult, RegistrarPagoTiendaInput } from "@/lib/types/liquidacion";

// Feature 172 (design §3.1) — contrato del servicio de LIQUIDACION. Un solo servicio para los
// tres actos (pagar a un mensajero, pagar a una tienda, anular), no tres: el 80 % —permisos,
// candado, validacion, idempotencia, atomicidad— es identico, y lo que cambia son tres piezas
// pequeñas (contra que se compara el monto, en que libro se escribe y con que signo). Tres
// servicios serian tres copias del camino money-critical (alternativa F, descartada).

/**
 * Lo que la transaccion del pago necesita: el documento y su candado
 * (`LiquidacionPagoTxClient`) y el libro del beneficiario. Los dos libros van en el tipo aunque
 * cada operacion escriba en UNO: es el mismo `tx` de Prisma y el tipo describe la transaccion,
 * no la operacion.
 */
export type LiquidacionTx = LiquidacionPagoTxClient & WalletTiendaTxClient & PagoMensajeroTxClient;

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

export interface ILiquidacionService {
  /**
   * R29 — registra un pago a una TIENDA contra su saldo acumulado (sin cierre, decision 4 del
   * humano). Guardia de rol ANTES de tocar datos (R1/R2/R5/R6); disponible leido BAJO CANDADO
   * (R83); documento y movimiento del libro en la MISMA transaccion (R39); ni una fila en la
   * caja principal (R40, [P2]).
   */
  registrarPagoTienda(
    input: RegistrarPagoTiendaInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult>;
}
