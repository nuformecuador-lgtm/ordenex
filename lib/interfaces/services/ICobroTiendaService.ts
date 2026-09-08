import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CobroTiendaTxClient } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  RegistrarCobroTiendaInput,
  SaldoTiendaDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 381 — contrato del servicio que COBRA UN COSTO A UNA TIENDA.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE HACE, en una frase y con las palabras del humano (2026-09-07): «mas que marcar como
// ingreso es QUITAR DEL DINERO DISPONIBLE de esa tienda». Una fila de debito en el libro de esa
// tienda, y ninguna en la caja de Ordenex.
//
// Resultados de DOMINIO, sin acoplar a HTTP: `unauthenticated` lo decide la Server Action antes de
// instanciar nada, y `validation_error` de FORMA lo decide zod en el borde. Money-safe: los importes
// cruzan la frontera como STRING.

/**
 * El ejecutor de la transaccion, inyectado por constructor. En produccion es
 * `(fn) => prisma.$transaction(fn)`; en los tests, un runner en memoria con la misma semantica
 * (incluida la reversion). El servicio no importa Prisma: no conoce la base, igual que no conoce
 * HTTP. Espejo exacto de `LiquidacionTxRunner`.
 */
export type CobroTiendaTxRunner = <T>(fn: (tx: CobroTiendaTxClient) => Promise<T>) => Promise<T>;

/**
 * ⚠️ TRES RAMAS Y NI UNA MAS. En particular NO existe `sin_saldo` ni `excede`, y es la decision
 * central de la ficha (R27, firmada por el humano): un cobro NO se compara contra ningun disponible.
 * Si la tienda no tiene dinero pendiente, el saldo queda NEGATIVO y se cobra mas adelante, cuando la
 * gestion vuelva a generar dinero a su favor. Recortarlo a cero, esconderlo o rechazarlo seria
 * exactamente lo contrario de lo que se pidio.
 *
 * `saldo` es el de la tienda DESPUES del cobro, con su `signo` ya derivado EN EL SERVIDOR: asi la
 * pantalla puede decir «el saldo de X quedo en −₡15.000,00» sin comparar ni convertir nada.
 */
export type RegistrarCobroTiendaServiceResult =
  | { status: "ok"; cobro: WalletTiendaMovimientoDTO; saldo: SaldoTiendaDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" };

export interface ICobroTiendaService {
  /**
   * R12/R17/R19/R20/R21/R23/R24/R25/R26/R27 — registra UN cobro manual a UNA tienda.
   *
   * ⚠️ NO HAY, Y NO DEBE HABER, NINGUN METODO PARA EDITAR, BORRAR NI REVERSAR UN COBRO (R22). El
   * ledger es append-only por diseño y la correccion de un cobro erroneo es un credito
   * compensatorio, que esta ficha deja fuera de alcance por decision del humano (D3). La ausencia de
   * superficie ES el requisito, no un olvido.
   */
  registrarCobro(
    input: RegistrarCobroTiendaInput,
    actor: Actor,
  ): Promise<RegistrarCobroTiendaServiceResult>;
}
