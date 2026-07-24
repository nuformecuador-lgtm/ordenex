import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecepcionBodegaCentralService,
  RecibirEnBodegaCentralServiceResult,
} from "@/lib/interfaces/services/IRecepcionBodegaCentralService";

// Estado de ORIGEN elegible (dead-end de la carga por API: la orden viaja hacia la bodega
// central sin transicion de salida) y destino (la bodega la recibio fisicamente). Cierra el
// callejon sin salida de la carga por API:
//   carga API --> en_ruta_bodega_central --(maestro/admin recibe)--> en_bodega_central
const ORIGEN_RECEPCION = "en_ruta_bodega_central"; // post-137
const ESTADO_RECIBIDA = "en_bodega_central"; // post-137

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick
// para dobles de test sin DB/HTTP (patron RecepcionOrigenService).
type RecepcionBodegaCentralRepo = Pick<
  IOrdenRepository,
  "findByNumGuiaForTransicion" | "findEstatusIdByValue" | "recibirEnBodegaCentral"
>;

/**
 * Recepcion en la BODEGA CENTRAL por escaneo del QR. Espejo de `RecepcionOrigenService`
 * cambiando el alcance por TIENDA por el alcance GLOBAL de maestro/admin (`esAccesoTotal`):
 * impone el rol, la guardia de estado y la idempotencia, y persiste la transicion via el
 * UPDATE guardado + append del historial en la misma tx (choke point de la feature 49). A
 * diferencia de la satelite/origen NO hay guardia de zona ni de tienda: la bodega central es
 * global (R11). No conoce HTTP ni Prisma.
 */
export class RecepcionBodegaCentralService implements IRecepcionBodegaCentralService {
  constructor(private readonly repo: RecepcionBodegaCentralRepo) {}

  async recibirEnBodegaCentral(
    numGuia: number,
    actor: Actor,
  ): Promise<RecibirEnBodegaCentralServiceResult> {
    // 1. Rol: solo maestro/admin (acceso total) recibe en la bodega central (R4).
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    // 2. Cargar por num_guia. `findByNumGuiaForTransicion` NO filtra borradas: aqui se
    //    distingue "no existe" de "borrada", y ambas son `no_encontrada` (R6).
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };

    // 3. Idempotencia: ya recibida -> no re-transiciona ni toca el historial (R7).
    if (row.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };

    // 4. Guardia de estado: elegible SOLO desde `en_ruta_bodega_central`. Lleva el estado
    //    actual para que la UI pueda nombrarlo (R8). SIN acotar por zona ni tienda (R11).
    if (row.estatusValue !== ORIGEN_RECEPCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    // 5. El destino debe existir en el catalogo (sembrado por seedOrderStatus).
    const destinoId = await this.repo.findEstatusIdByValue(ESTADO_RECIBIDA);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${ESTADO_RECIBIDA}`] },
      };
    }

    // 6. Transicion atomica. El UPDATE va guardado por estado + no borrada: es la defensa
    //    REAL (la comprobacion de arriba solo permite reportar mejor). R2/R3/R18.
    const transiciono = await this.repo.recibirEnBodegaCentral(row.id, destinoId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: "recepcion_bodega_central", // feature 138/R17: clasificacion propia
    });

    if (!transiciono) {
      // R9: perdio la carrera — el estado cambio entre la lectura y el UPDATE. Se re-lee para
      // distinguir "otro la recibio primero" (idempotente) de un conflicto real.
      const despues = await this.repo.findByNumGuiaForTransicion(numGuia);
      if (despues?.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };
      return { status: "conflict" };
    }

    return { status: "ok", ordenId: row.id, estado: ESTADO_RECIBIDA };
  }
}
