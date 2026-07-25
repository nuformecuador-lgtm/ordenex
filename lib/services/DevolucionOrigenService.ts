import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IDevolucionOrigenService,
  DevolverATiendaResult,
} from "@/lib/interfaces/services/IDevolucionOrigenService";

// Feature 139/R9/R15/R16 (REPURPOSE de la feature 48): el ORIGEN de "Enviar a la tienda" pasa de
// `rechazada` a `por_devolver_a_tienda`. Con la 139 la UNICA salida de `rechazada` es la APROBACION
// DEL CIERRE (R9): se RETIRA la transicion manual directa `rechazada -> devolviendo_a_tienda`. La
// accion manual de envio a la tienda se corre una etapa mas adelante, sobre `por_devolver_a_tienda`
// (estado SIEMPRE fisicamente en la central), y la ejecuta maestro/admin (bodega central), por lote.
//   por_devolver_a_tienda --(maestro/admin central)--> devolviendo_a_tienda --(tienda)--> devuelta_a_tienda
const ESTADO_ORIGEN = "por_devolver_a_tienda";
const ESTADO_DESTINO = "devolviendo_a_tienda";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick para
// dobles de test sin DB/HTTP. Ya NO necesita `findUsuarioZonaId` (la autz dejo de ser por-zona).
type DevolucionOrdenRepo = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "update"
>;

/**
 * Feature 48 (repurposada por la 139) — logica de negocio del ENVIO central -> tienda. Impone la
 * GUARDIA de estado (solo desde `por_devolver_a_tienda`, idempotente en `devolviendo_a_tienda`) y la
 * AUTZ CENTRAL DIRECTA (maestro/admin), y persiste la transicion via el choke point de la feature 49
 * (`OrdenRepository.update`, `origen_tipo = ajuste_estado`) en su misma tx. No conoce HTTP ni Prisma;
 * testeable con dobles sin red/DB.
 */
export class DevolucionOrigenService implements IDevolucionOrigenService {
  constructor(private readonly ordenRepo: DevolucionOrdenRepo) {}

  async devolverATienda(ordenId: string, actor: Actor): Promise<DevolverATiendaResult> {
    // 1. Cargar la orden; findById excluye borradas -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. Guardia de estado de origen (R22). Elegible SOLO desde `por_devolver_a_tienda`.
    if (orden.estatusValue === ESTADO_DESTINO) {
      // R15: ya en devolviendo_a_tienda -> idempotente, no re-transiciona ni toca el historial.
      return { status: "ok" };
    }
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      // R9: en particular `rechazada` YA NO es elegible aqui -> conflict (su unica salida es el cierre).
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 3. Autz CENTRAL DIRECTA (R16) — ANTES de cualquier escritura. `por_devolver_a_tienda` es, por
    //    construccion, un estado SIEMPRE fisicamente en la central (las satelite llegan solo tras la
    //    recepcion central), asi que NO se usa `esBodegaResponsable` por-zona (daria el actor
    //    equivocado para una orden de zona satelite ya recibida en central). Solo maestro/admin.
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    // 4. Transicion atomica via el choke point de la feature 49 (R23). El destino debe existir en el
    //    catalogo.
    const destinoId = await this.ordenRepo.findEstatusIdByValue(ESTADO_DESTINO);
    if (destinoId === null) return { status: "config_error" };

    // Feature 49/#11: OrdenRepository.update hace UPDATE (guardado por id + no borrada) + append del
    // historial (origen_tipo = ajuste_estado, actor = el admin central) en la MISMA tx, con el origen
    // PRE-LEIDO dentro de esa tx. La guardia de estado la impone el pre-check del service.
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
