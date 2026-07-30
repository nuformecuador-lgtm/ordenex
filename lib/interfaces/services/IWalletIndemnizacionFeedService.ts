import type { PrismaClient } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 158 (design §6.3) — contrato del servicio que CONSTRUYE el egreso de indemnizacion
// de un cierre aprobado. Hermano de `IWalletMensajeroFeedService` (44) y `IWalletFeedService`
// (42): corre DENTRO de la transaccion de aprobacion, LEE en esa misma `tx` y devuelve las
// filas a insertar, sin persistir nada el mismo (las inserta el repo de la 42).

/** Cliente de transaccion que necesita el feed: leer las gestiones del cierre. */
export type WalletIndemnizacionFeedTxClient = Pick<PrismaClient, "gestionOrden">;

export interface IWalletIndemnizacionFeedService {
  /**
   * R26/R27 — suma `gestion_orden.indemnizacion` de las gestiones `incidente` del cierre y
   * devuelve 0 o 1 movimiento de egreso.
   *
   * NO recibe el monto por parametro A PROPOSITO (design §9.3): LEE de la base lo que la MISMA
   * `tx` acaba de escribir. Si el movimiento se construyera con el numero del request y la
   * escritura de `gestion_orden` fallara parcialmente, el libro y el detalle dirian cosas
   * distintas sobre la misma plata. Es la leccion de la feature 69: el cierre no pregunta al
   * mundo vivo, recuerda lo que quedo escrito.
   *
   * Money-safe: la suma se hace con `Prisma.Decimal` y el monto sale como STRING escala 2.
   * Suma 0 (cierre sin incidentes, o incidentes sin monto) -> lista VACIA: no se emite una
   * fila en 0.00 (R27).
   */
  construirEgresoIndemnizacion(
    cierreId: string,
    tx: WalletIndemnizacionFeedTxClient,
  ): Promise<CrearMovimientoInput[]>;
}
