import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularPremioInput,
  ListarPremiosDelDiaInput,
  PremioPodioDTO,
  RegistrarPremioInput,
} from "@/lib/types/premio-ranking-devengo";

// Feature 293 (design §7) — contrato del servicio del PREMIO DEL RANKING. Logica de negocio: no
// conoce HTTP, no conoce `next/*` y no conoce Prisma (la transaccion se le inyecta).

/**
 * El `tx` que la escritura necesita: los DOS libros de dinero que toca, y ninguno mas.
 *
 * Es un `Pick` de dos modelos a proposito (criterio de `LiquidacionTx`): quien tiene este `tx` no
 * puede tocar el cierre, ni el snapshot del ranking, ni el ledger por tienda. Y el servicio ni
 * siquiera usa los delegados directamente —se los pasa al repositorio y al puerto de la caja, que
 * son los unicos escritores (censo de `caja-173-alcance.guardia.test.ts`)—.
 */
export type PremioTx = Pick<PrismaClient, "pagoMensajeroMovimiento" | "walletMovimiento">;

/**
 * Ejecuta `fn` dentro de UNA transaccion y revierte si lanza (R20: o quedan el devengo y su
 * egreso de caja, o no queda ninguno).
 *
 * Se inyecta por constructor y no se importa Prisma aqui, igual que en `LiquidacionTxRunner`: en
 * produccion es `(fn) => prisma.$transaction(fn)`; en los tests, un runner en memoria con la
 * misma semantica, incluida la reversion.
 */
export type PremioTxRunner = <T>(fn: (tx: PremioTx) => Promise<T>) => Promise<T>;

/** R2/R4/R6 — el podio de una fecha con el estado de cada premio, o `forbidden`. */
export type ListarPremiosDelDiaResult =
  | { status: "ok"; fecha: string; hayPodio: boolean; filas: PremioPodioDTO[] }
  | { status: "forbidden" };

/**
 * R10-R20 — el desenlace de registrar. Cada rama es un HECHO distinto y tiene su texto en
 * pantalla; ninguna es un error generico (R11/R12 lo exigen literalmente).
 *
 * `ya_registrado` y `anulado` son las DOS lecturas posibles de «el indice unico rechazo la fila»,
 * y se distinguen releyendo el libro: la pantalla tiene que poder decir la verdad (R32).
 */
export type RegistrarPremioResult =
  | { status: "ok"; monto: string; cierreId: string }
  | { status: "ya_registrado" }
  | { status: "anulado" }
  | { status: "sin_premio" }
  /**
   * Feature 297 — la fila congelada tiene CERO entregas ese dia. Desde la 297 nadie asi ocupa
   * podio, pero los snapshots ya congelados NO se reescriben (son historia): el 26/08 sigue
   * teniendo a Andres 1.o con sus 5.000, y esta rama es lo UNICO que impide cobrarlo.
   *
   * Es un rechazo de DOMINIO con nombre propio, como `sin_cierre` o `cierre_no_aprobado`: el
   * maestro ve el boton, lo pulsa y le tienen que decir POR QUE, no «no se pudo».
   */
  | { status: "sin_entregas" }
  | { status: "sin_cierre" }
  | { status: "cierre_no_aprobado"; estado: string }
  | { status: "no_encontrado" }
  | { status: "forbidden" };

/** R29-R33 — el desenlace de anular. `ya_anulado` NO es un error (R31). */
export type AnularPremioResult =
  | { status: "ok" }
  | { status: "ya_anulado" }
  | { status: "no_registrado" }
  | { status: "no_encontrado" }
  | { status: "forbidden" };

export interface IPremioRankingDevengoService {
  /**
   * R2/R4/R5/R6/R9 — el podio CONGELADO de esa fecha con el estado derivado de cada fila.
   * `hayPodio: false` cuando la fecha no tiene snapshot (R6). El gate de rol va ANTES de leer
   * nada: sin acceso total no se expone ni un nombre ni un monto (R2).
   */
  listarPremiosDelDia(
    input: ListarPremiosDelDiaInput,
    actor: Actor,
  ): Promise<ListarPremiosDelDiaResult>;
  /**
   * R10-R23 — imputa el premio de UNA fila del podio al cierre del dia de ese mensajero y emite
   * su egreso de caja, en la MISMA transaccion.
   *
   * Del input solo se usa `filaId` (R16): monto, mensajero, fecha y cierre salen del servidor.
   */
  registrarPremio(input: RegistrarPremioInput, actor: Actor): Promise<RegistrarPremioResult>;
  /**
   * R29-R33 — escribe el movimiento COMPENSATORIO y el reverso de caja, en la misma transaccion,
   * sin tocar las filas originales (R21). El motivo queda en la descripcion (R30).
   */
  anularPremio(input: AnularPremioInput, actor: Actor): Promise<AnularPremioResult>;
}
