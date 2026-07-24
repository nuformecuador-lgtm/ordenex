import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IDevolucionOrigenService,
  DevolverATiendaResult,
} from "@/lib/interfaces/services/IDevolucionOrigenService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import type { CierreDestinoTipo } from "@/lib/types/cierre";

// Estado de ORIGEN elegible (final del proceso de entrega) y destino del retorno
// (paquete fisico de vuelta en la tienda). La elegibilidad es por ESTADO
// (`rechazada`), agnostica del camino (rechazo directo 36 o escalado 47), R1/R2.
const ESTADO_ORIGEN = "rechazada";
const ESTADO_DESTINO = "devolviendo_a_tienda";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran
// como Pick para dobles de test sin DB/HTTP (patron RecepcionSateliteService).
type DevolucionOrdenRepo = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findUsuarioZonaId" | "update"
>;
type DevolucionZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;

/**
 * Feature 48 — logica de negocio del RETORNO a la tienda de origen. Impone la GUARDIA
 * de estado (solo desde `rechazada`, idempotente en `devolviendo_a_tienda`) y la AUTZ por
 * bodega responsable (maestro/admin en la central, adminSatelite de la zona de la
 * orden), y persiste la transicion via el choke point de la feature 49
 * (`OrdenRepository.update`, #11, `origen_tipo = ajuste_estado`) en su misma tx. No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB.
 */
export class DevolucionOrigenService implements IDevolucionOrigenService {
  constructor(
    private readonly ordenRepo: DevolucionOrdenRepo,
    private readonly zonaRepo: DevolucionZonaRepo,
  ) {}

  async devolverATienda(ordenId: string, actor: Actor): Promise<DevolverATiendaResult> {
    // 1. Cargar la orden; findById excluye borradas (R34) -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. Guardia de estado de origen (R5). Elegible SOLO desde `rechazada`; la
    //    orden REPOSA ahi (R3). Agnostica del camino que la trajo (R1/R2): no exige
    //    ningun dato extra, solo el estado.
    if (orden.estatusValue === ESTADO_DESTINO) {
      // R5: ya devuelta -> idempotente, no re-transiciona ni toca el historial.
      return { status: "ok" };
    }
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      // R5: cualquier otro estado no es elegible (no modifica estado ni historial).
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 3. Autz por bodega responsable (R10/R11) — ANTES de cualquier escritura. Deriva
    //    la bodega de la zona de la orden (misma regla de la feature 41), con fallback
    //    seguro (centralZonaId null -> satelite; resolverDestinoCierre no lanza).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const { destinoTipo } = resolverDestinoCierre(orden.zonaId, centralZonaId);
    const autorizado = await this.esBodegaResponsable(destinoTipo, orden.zonaId, actor);
    if (!autorizado) return { status: "forbidden" }; // R11: sin efectos

    // 4. Transicion atomica via el choke point de la feature 49 (R4/R7/R8). El destino
    //    debe existir en el catalogo (R4).
    const destinoId = await this.ordenRepo.findEstatusIdByValue(ESTADO_DESTINO);
    if (destinoId === null) return { status: "config_error" };

    // Feature 49/#11: OrdenRepository.update hace UPDATE de estado + appendCambioEstado
    // (origen_tipo = ajuste_estado, actor = el admin de la bodega) en la MISMA tx (R7/R8).
    const actualizada = await this.ordenRepo.update(
      ordenId,
      { estatusId: destinoId },
      { actorUsuarioId: actor.usuarioId, origenTipo: "ajuste_estado" },
    );
    // Carrera: la orden se borro entre la lectura y la escritura -> not_found.
    if (!actualizada) return { status: "not_found" };
    return { status: "ok" };
  }

  /**
   * R10/R11: el actor es la bodega responsable de la orden si es maestro/admin cuando la
   * zona resuelve a la bodega central, o el adminSatelite CUYA zona coincide con la de la
   * orden cuando resuelve a satelite. Cualquier otro caso (adminTienda, mensajero,
   * adminSatelite de otra zona) NO es responsable.
   */
  private async esBodegaResponsable(
    destinoTipo: CierreDestinoTipo,
    ordenZonaId: string,
    actor: Actor,
  ): Promise<boolean> {
    if (destinoTipo === "bodega_central") {
      return actor.rol === "maestro" || actor.rol === "admin";
    }
    // bodega_satelite: solo el adminSatelite de la zona de la orden.
    if (actor.rol !== "adminSatelite") return false;
    const actorZonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    return actorZonaId !== null && actorZonaId === ordenZonaId;
  }
}
