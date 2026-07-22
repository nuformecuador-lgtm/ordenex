import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IGestionOrdenRepository } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IReprogramacionTiendaService,
  ReprogramarNovedadResult,
} from "@/lib/interfaces/services/IReprogramacionTiendaService";

// Estado de ORIGEN elegible (la orden REPOSA en `devuelta`, feature 99) y destino de la
// reprogramacion. Valores de catalogo ya sembrados (`order_status`); esta feature NO agrega estados.
const ESTADO_ORIGEN = "devuelta";
const ESTADO_DESTINO = "reprogramada";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick para
// dobles de test sin DB/HTTP (patron DevolucionOrigenService).
type ReprogramacionOrdenRepo = Pick<IOrdenRepository, "findById" | "findEstatusIdByValue">;
type ReprogramacionGestionRepo = Pick<IGestionOrdenRepository, "reprogramarDesdeDevuelta">;

/**
 * Feature 100 — logica de negocio de la REPROGRAMACION por la tienda. Impone la AUTZ por tienda
 * dueña (`adminTienda` cuya `usuarioId` ES el `orden.tienda_id`, patron `NovedadesService`/
 * `OrdenService`) y la GUARDIA de estado (solo desde `devuelta`), y delega la transicion atomica +
 * la gestion sintetica al repo (choke point de la feature 49). No conoce HTTP ni Prisma; testeable
 * con dobles sin red/DB.
 */
export class ReprogramacionTiendaService implements IReprogramacionTiendaService {
  constructor(
    private readonly ordenRepo: ReprogramacionOrdenRepo,
    private readonly gestionRepo: ReprogramacionGestionRepo,
  ) {}

  async reprogramar(
    ordenId: string,
    fechaReprogramacion: string,
    motivo: string | null,
    actor: Actor,
  ): Promise<ReprogramarNovedadResult> {
    // 1. Cargar la orden; findById excluye borradas -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. Autz por tienda dueña (R6) — ANTES de cualquier escritura o de revelar el estado. Solo el
    //    adminTienda cuya identidad ES el `orden.tienda_id` (misma identidad que usa el listado de
    //    novedades). Cualquier otro rol o tienda -> forbidden, sin efectos.
    if (actor.rol !== "adminTienda" || orden.tiendaId !== actor.usuarioId) {
      return { status: "forbidden" };
    }

    // 3. Guardia de estado de origen (R7). Elegible SOLO desde `devuelta` (la orden reposa ahi bajo
    //    la feature 99). Cualquier otro estado -> conflict, sin efectos ni historial.
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 4. Resolver los estatus del catalogo (destino + guarda). Falta de seed -> config_error.
    const [estatusDevueltaId, estatusReprogramadaId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_ORIGEN),
      this.ordenRepo.findEstatusIdByValue(ESTADO_DESTINO),
    ]);
    if (estatusDevueltaId === null || estatusReprogramadaId === null) {
      return { status: "config_error" };
    }

    // 5. Transicion atomica + gestion sintetica via el choke point de la 49 (R2/R3/R5/R11/R20/R21).
    //    La guarda por `estatus_id = devuelta` del repo hace la accion idempotente frente a la
    //    carrera con el cron SLA de la 99: si perdio la carrera (count 0), el repo devuelve false.
    const ok = await this.gestionRepo.reprogramarDesdeDevuelta({
      ordenId,
      estatusDevueltaId,
      estatusReprogramadaId,
      fechaReprogramacion,
      motivo,
      actorUsuarioId: actor.usuarioId,
    });
    // R7: carrera con el cron SLA (o doble submit) -> la orden ya no estaba en `devuelta`.
    if (!ok) {
      return {
        status: "conflict",
        motivo: `la orden ya no esta en ${ESTADO_ORIGEN}`,
      };
    }
    return { status: "ok" };
  }
}
