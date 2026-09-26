import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ConOrigen,
  FilaConOrigenTecnico,
  LibroWallet,
  OrigenLegibleDTO,
} from "@/lib/types/wallet-origen";

/**
 * Ficha 458-A (TA.2, design §3.3) — el origen legible de las filas de UNA pagina de un libro.
 *
 * NO autoriza: lo llaman los bordes DESPUES de que el servicio del libro devolvio `ok` para ese
 * actor, y solo sobre las filas que ese servicio devolvio. El actor decide UNICAMENTE que enlaces se
 * ofrecen (R7/R8) y cuanto se nombra (la tienda no ve el mensajero de un cierre, D2).
 */
export interface IOrigenLegibleService {
  /** Un origen por fila, en el MISMO orden. Una consulta por tipo de origen presente. */
  resolver(
    libro: LibroWallet,
    filas: readonly FilaConOrigenTecnico[],
    actor: Actor,
  ): Promise<OrigenLegibleDTO[]>;

  /** Las mismas filas con `origen` adjunto. */
  adjuntar<T extends FilaConOrigenTecnico>(
    libro: LibroWallet,
    filas: readonly T[],
    actor: Actor,
  ): Promise<ConOrigen<T>[]>;
}
