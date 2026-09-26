import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CobroTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  AnularCobroTiendaInput,
  AnularCobroTiendaResult,
  RegistrarCobroTiendaInput,
  SaldoTiendaDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 381 → 461 — contrato del servicio con el que ORDENEX LE COBRA A UNA TIENDA.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE HACE, en una frase (461, HD1, firmada por el humano el 2026-09-25): un cobro se DESCUENTA
// del saldo a favor de la tienda y pasa a ser GANANCIA de Ordenex. Escribe el debito en el libro de
// esa tienda, UNA linea en la caja de naturaleza propia y liquidez «cargo» por el mismo monto, y la
// fila del historial — las tres en una transaccion (R1). No es dinero que entra: se toma del que
// Ordenex ya le guardaba a la tienda, asi que la ganancia sube, «De las tiendas» baja y «Entro» no
// cambia (R4). Con la 381 el cobro era «una fila de debito en el libro de esa tienda, y ninguna en
// la caja de Ordenex»; esa frase queda SUPERADA por HD1.
//
// Resultados de DOMINIO, sin acoplar a HTTP: `unauthenticated` lo decide la Server Action antes de
// instanciar nada, y `validation_error` de FORMA lo decide zod en el borde. Money-safe: los importes
// cruzan la frontera como STRING.

/**
 * El ejecutor de la transaccion, inyectado por constructor. En produccion es
 * `(fn) => prisma.$transaction(fn)`; en los tests, un runner en memoria con la misma semantica
 * (incluida la reversion). El servicio no importa Prisma: no conoce la base, igual que no conoce
 * HTTP. Espejo exacto de `LiquidacionTxRunner`.
 *
 * FICHA 461: el cliente que entrega (`CobroTiendaTxClient`) expone tambien `walletMovimiento` y
 * `cobroTiendaAnulacion`, para que el cargo, el reverso y la constancia viajen en la MISMA transaccion.
 */
export type CobroTiendaTxRunner = <T>(fn: (tx: CobroTiendaTxClient) => Promise<T>) => Promise<T>;

/**
 * ⚠️ TRES RAMAS Y NI UNA MAS. En particular NO existe `sin_saldo` ni `excede`, y es la decision
 * central de la 381 (R27, firmada por el humano) que la 461 hereda (R5): un cobro NO se compara
 * contra ningun disponible. Si la tienda no tiene dinero pendiente, el saldo queda NEGATIVO y se
 * cobra mas adelante, cuando la gestion vuelva a generar dinero a su favor. Recortarlo a cero,
 * esconderlo o rechazarlo seria exactamente lo contrario de lo que se pidio.
 *
 * `saldo` es el de la tienda DESPUES del cobro, con su `signo` ya derivado EN EL SERVIDOR: asi la
 * pantalla puede decir «el saldo de X quedo en −₡15.000,00» sin comparar ni convertir nada.
 */
export type RegistrarCobroTiendaServiceResult =
  | { status: "ok"; cobro: WalletTiendaMovimientoDTO; saldo: SaldoTiendaDTO }
  /** Ficha 461 (R68): la MISMA clave ya tenia su cobro; se devuelve ese y no se escribio nada. */
  | { status: "ya_registrado"; cobro: WalletTiendaMovimientoDTO; saldo: SaldoTiendaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" };

/** Resultados de DOMINIO de la anulacion: `unauthenticated` y `validation_error` son del borde. */
export type AnularCobroTiendaServiceResult = Exclude<
  AnularCobroTiendaResult,
  { status: "unauthenticated" } | { status: "validation_error" }
>;

export interface ICobroTiendaService {
  /**
   * R1–R9 — registra UN cobro de Ordenex a UNA tienda: el debito, la linea de caja y el historial, en
   * una transaccion; el saldo resultante con su signo (puede ser negativo, R5).
   */
  registrarCobro(
    input: RegistrarCobroTiendaInput,
    actor: Actor,
  ): Promise<RegistrarCobroTiendaServiceResult>;
  /**
   * R10–R18 — ANULA un cobro con motivo: constancia (motivo, quien, cuando), credito compensatorio
   * a la tienda por el monto DEL COBRO y reverso del cargo en la caja, fechados con el MISMO instante
   * del dia de la anulacion, mas el historial; todo en una transaccion. Nada se edita ni se borra
   * (R11). Un cobro reclasificado por la 459 o sin linea de caja responde `no_anulable` (R17).
   *
   * ⚠️ HD1 de la 461 REABRE lo que la 381 cerro (su R22: «no hay ni debe haber ningun metodo para
   * editar, borrar ni reversar un cobro»): la correccion de un cobro erroneo es esta anulacion, con
   * contra-asientos en los dos libros. Lo que SIGUE sin existir —y no debe existir— es editar un cobro
   * o deshacer su anulacion (R19): son estos DOS metodos y ni uno mas.
   */
  anular(input: AnularCobroTiendaInput, actor: Actor): Promise<AnularCobroTiendaServiceResult>;
}
