import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GastoFijoCobroTxClient } from "@/lib/interfaces/repositories/IGastoFijoCobroRepository";
import type { WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  AprobarCobroGastoFijoServiceResult,
  ContarCobrosPendientesDePlantillaInput,
  ContarCobrosPendientesDePlantillaServiceResult,
  DecidirCobroGastoFijoInput,
  ListarCobrosPendientesServiceResult,
  RechazarCobroGastoFijoServiceResult,
} from "@/lib/types/gasto-fijo-cobro";

// Ficha 333 (B4, design §3/§6.3) — contrato del servicio de COBROS de gasto fijo: ver la cola,
// aprobar, rechazar y cancelar los de una plantilla que se borra. Lógica de negocio pura (sin
// HTTP ni Prisma directo); resultados de dominio.
//
// ⚠️ QUIÉN DECIDE — LA PRIMERA EXCEPCIÓN DELIBERADA A LA PARIDAD DE LA FICHA 94.
// `listarPendientes` autoriza con `esAccesoTotal` (`maestro` + `admin`): el admin VE la cola
// (R25). `aprobar` y `rechazar` autorizan con `puedeDecidirCobroGastoFijo` (`maestro` y nadie
// más, R24), que es un predicado con NOMBRE PROPIO y distinto: el camino de decisión NO debe
// autorizar con `esAccesoTotal` (R27), y lo vigila una guardia estática. Ninguna otra operación
// de wallet ni del CRUD de plantillas cambia de autorización (R28).

/**
 * FICHA 333 (D2, design §6.3) — el cliente que la transacción de APROBAR necesita: las DOS
 * tablas que esa transacción toca, y ninguna más. `gasto_fijo_cobro` (la decisión) y
 * `wallet_movimiento` (el egreso). Con este tipo, quien tenga el `tx` no puede tocar plantillas
 * ni notificaciones aunque quisiera.
 */
export type GastoFijoCobroTx = GastoFijoCobroTxClient & WalletTxClient;

/**
 * Ejecuta `fn` dentro de UNA transacción y revierte si lanza (R15: o queda el movimiento del
 * libro Y el cobro aprobado y enlazado, o no queda ninguna de las dos cosas).
 *
 * Se INYECTA por constructor y no se importa Prisma en el servicio: la lógica de negocio no
 * conoce la base, igual que no conoce HTTP. En producción es `(fn) => prisma.$transaction(fn)`;
 * en los tests, un runner en memoria con la misma semántica. Precedente literal:
 * `LiquidacionTxRunner`.
 */
export type GastoFijoCobroTxRunner = <T>(fn: (tx: GastoFijoCobroTx) => Promise<T>) => Promise<T>;

export interface IGastoFijoCobroService {
  /**
   * R25/R39/R41 — la cola de pendientes, del más antiguo al más reciente, recortada por el tope
   * del servidor, con el `total` real aparte. Guardia: `esAccesoTotal`.
   */
  listarPendientes(actor: Actor): Promise<ListarCobrosPendientesServiceResult>;
  /**
   * ⚠️ EL MÉTODO QUE MUEVE DINERO (R14/R15/R16/R17/R18/R19/R20/R24). Sigue exactamente la
   * secuencia de `design.md §6.3` dentro de UNA `$transaction`:
   *
   *   guardia de rol -> obtener -> `marcarDecidido(WHERE estado='pendiente')` -> si 0, ya_decidido
   *   -> escribir el movimiento con LA CLAVE del cobro y EL MONTO COPIADO -> releer por la clave
   *   -> enlazar -> `{ ok, yaEstabaEnElLibro: insertadas === 0 }`.
   *
   * El monto NO se lee de la plantilla: se cobra la copia del cobro aunque la plantilla haya
   * cambiado entre la generación y la aprobación (R16). `ahora` se INYECTA: un test no puede
   * depender de un `new Date()` escondido dentro del servicio.
   */
  aprobar(
    input: DecidirCobroGastoFijoInput,
    actor: Actor,
    ahora: Date,
  ): Promise<AprobarCobroGastoFijoServiceResult>;
  /**
   * R21/R23/R24 — deja el cobro en `rechazado` con quién y cuándo, y NO escribe absolutamente
   * nada en el libro. No abre transacción porque es UNA sola sentencia condicional, que ya es
   * atómica. Un cobro ya decidido responde `ya_decidido` (R23).
   */
  rechazar(
    input: DecidirCobroGastoFijoInput,
    actor: Actor,
    ahora: Date,
  ): Promise<RechazarCobroGastoFijoServiceResult>;
  /**
   * R45/R56 — cancela los cobros `pendiente` de una plantilla DENTRO de la transacción que la
   * borra, y devuelve cuántos canceló realmente. Recibe el `tx` de quien la abre (el borrado de
   * plantilla) porque la atomicidad es del conjunto: o se cancelan y la plantilla desaparece, o
   * no ocurre ninguna de las dos cosas.
   *
   * Sin guardia de rol propia: quien la llama YA autorizó el borrado (`esAccesoTotal`), y meter
   * aquí una segunda guardia haría que la misma operación se autorizara dos veces con criterios
   * que podrían divergir.
   */
  cancelarPorPlantilla(
    tx: GastoFijoCobroTxClient,
    plantillaId: string,
    actor: Actor,
    ahora: Date,
  ): Promise<number>;
  /**
   * ⚠️ FICHA 333 (D2, R55) — cuántos cobros `pendiente` tiene una plantilla, LEÍDOS EN EL
   * MOMENTO de pedir la confirmación del borrado. Es lo que permite que el usuario lea «se
   * cancelarán 2 cobros pendientes» ANTES de aceptar, y no después.
   *
   * Guardia: `esAccesoTotal`, no el predicado estrecho. Esto es una LECTURA que acompaña al
   * borrado de plantillas —cuyo guard es `esAccesoTotal` y esta ficha NO lo estrecha (R28)—, no
   * una decisión sobre un cobro.
   *
   * El número que devuelve es informativo y puede quedar obsoleto entre el aviso y la ejecución:
   * el que se REPORTA al final es el de `cancelarPorPlantilla` dentro de la transacción (R56).
   */
  contarPendientesDePlantilla(
    input: ContarCobrosPendientesDePlantillaInput,
    actor: Actor,
  ): Promise<ContarCobrosPendientesDePlantillaServiceResult>;
}
