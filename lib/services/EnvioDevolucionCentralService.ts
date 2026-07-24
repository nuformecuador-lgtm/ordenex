import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IEnvioDevolucionCentralService,
  EnviarACentralResult,
} from "@/lib/interfaces/services/IEnvioDevolucionCentralService";

// Estado de ORIGEN elegible (la orden satelite quedo lista para devolver tras aprobar el cierre)
// y destino (en transito a la bodega central). El primer tramo del retorno satelite: la devolucion
// pasa OBLIGATORIAMENTE por la central antes de volver a la tienda.
//   por_devolver --(adminSatelite de la zona)--> devolviendo_a_bodega_central
const ESTADO_ORIGEN = "por_devolver";
const ESTADO_DESTINO = "devolviendo_a_bodega_central";

// Solo el adminSatelite de la zona de la orden envia a central (R14). `por_devolver` es, por
// construccion, un estado SIEMPRE de una orden de zona satelite (una rechazada de la central va
// directo a `por_devolver_a_tienda` al aprobar el cierre, nunca a `por_devolver`), asi que la autz
// es la rama satelite del molde `esBodegaResponsable`: rol adminSatelite + su zona == la de la orden.
const ROL_AUTORIZADO = "adminSatelite";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick para
// dobles de test sin DB/HTTP (patron DevolucionOrigenService).
type EnvioDevolucionCentralRepo = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findUsuarioZonaId" | "update"
>;

/**
 * Feature 139 — logica de negocio del ENVIO satelite -> bodega CENTRAL. Impone la GUARDIA de estado
 * (solo desde `por_devolver`, idempotente en `devolviendo_a_bodega_central`) y la AUTZ por zona
 * (adminSatelite cuya zona coincide con la de la orden), y persiste la transicion via el choke point
 * de la feature 49 (`OrdenRepository.update`, `origen_tipo = ajuste_estado`) en su misma tx. No
 * conoce HTTP ni Prisma; testeable con dobles sin red/DB. Molde de `DevolucionOrigenService`.
 */
export class EnvioDevolucionCentralService implements IEnvioDevolucionCentralService {
  constructor(private readonly ordenRepo: EnvioDevolucionCentralRepo) {}

  async enviarACentral(ordenId: string, actor: Actor): Promise<EnviarACentralResult> {
    // 1. Cargar la orden; findById excluye borradas -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. Guardia de estado de origen (R22). Elegible SOLO desde `por_devolver`.
    if (orden.estatusValue === ESTADO_DESTINO) {
      // Ya en transito -> idempotente, no re-transiciona ni toca el historial.
      return { status: "ok" };
    }
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 3. Autz por zona (R14) — ANTES de cualquier escritura. Solo el adminSatelite cuya zona
    //    coincide con la de la orden; cualquier otro (maestro/admin/adminTienda/mensajero/
    //    adminSatelite de otra zona) -> forbidden sin efectos.
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" };
    const actorZonaId = await this.ordenRepo.findUsuarioZonaId(actor.usuarioId);
    if (actorZonaId === null || actorZonaId !== orden.zonaId) return { status: "forbidden" };

    // 4. Transicion atomica via el choke point de la feature 49 (R23). El destino debe existir en
    //    el catalogo.
    const destinoId = await this.ordenRepo.findEstatusIdByValue(ESTADO_DESTINO);
    if (destinoId === null) return { status: "config_error" };

    // Feature 49/#11: OrdenRepository.update hace UPDATE (guardado por id + no borrada) + append
    // del historial (origen_tipo = ajuste_estado, actor = el adminSatelite) en la MISMA tx, con el
    // origen PRE-LEIDO dentro de esa tx. Mismo patron que DevolucionOrigenService: la guardia de
    // estado la impone el pre-check del service (R22 best-effort, sin re-guardar por estatus_id).
    const actualizada = await this.ordenRepo.update(
      ordenId,
      { estatusId: destinoId },
      { actorUsuarioId: actor.usuarioId, origenTipo: "ajuste_estado" },
    );
    // Carrera: la orden se borro entre la lectura y la escritura -> not_found.
    if (!actualizada) return { status: "not_found" };
    return { status: "ok" };
  }
}
