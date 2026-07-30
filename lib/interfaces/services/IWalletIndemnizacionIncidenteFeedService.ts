import type { PrismaClient } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 158 (design §12.5, R52/R53) — contrato del servicio que CONSTRUYE el egreso de
// indemnizacion del camino del ADMIN. Hermano de `IWalletIndemnizacionFeedService` (el del
// cierre, camino del mensajero) y de los feeds 42/43/44: corre DENTRO de la transaccion de
// aprobacion, LEE en esa misma `tx` y devuelve las filas a insertar, sin persistir nada el
// mismo (las inserta el repo de la 42).
//
// Estos DOS son los unicos emisores de `egreso_indemnizacion` en todo el codigo (R29). El guard
// estructural `tests/unit/guards/egreso-indemnizacion-emisores.test.ts` los nombra y se pone
// rojo ante un tercero.

/** Cliente de transaccion que necesita el feed: leer el incidente recien tarifado. */
export type WalletIndemnizacionIncidenteFeedTxClient = Pick<PrismaClient, "ordenIncidente">;

export interface IWalletIndemnizacionIncidenteFeedService {
  /**
   * R52 — lee `orden_incidente.indemnizacion` del incidente APROBADO y devuelve 0 o 1 movimiento
   * de egreso con `origen_tipo = orden_incidente` y `origen_id = incidenteId`.
   *
   * NO recibe el monto por parametro A PROPOSITO (design §9.3, misma filosofia que el feed del
   * cierre): LEE de la base lo que la MISMA `tx` acaba de escribir. Si el movimiento se
   * construyera con el numero del request y la escritura fallara parcialmente, el libro y el
   * incidente dirian cosas distintas sobre la misma plata. Es la leccion de la feature 69.
   *
   * Money-safe: `Prisma.Decimal` de punta a punta, salida STRING escala 2. Monto ausente o no
   * positivo -> lista VACIA: no se emite una fila en 0.00 (mismo criterio que R27).
   *
   * Tambien devuelve lista vacia si el incidente no esta `aprobado`: el egreso es consecuencia
   * de la aprobacion, no de existir.
   */
  construirEgresoIndemnizacionIncidente(
    incidenteId: string,
    tx: WalletIndemnizacionIncidenteFeedTxClient,
  ): Promise<CrearMovimientoInput[]>;
}
