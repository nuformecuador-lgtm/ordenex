import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";
import type {
  IRecepcionBodegaCentralService,
  RecibirEnBodegaCentralServiceResult,
} from "@/lib/interfaces/services/IRecepcionBodegaCentralService";

// Feature 138 + 139 (STATE-AWARE): UN solo escaner en la bodega central resuelve el par
// ORIGEN->DESTINO por el estado de ORIGEN de la orden:
//   - en_ruta_bodega_central     -> en_bodega_central       (caso 138: cierra el dead-end de la carga API)
//   - devolviendo_a_bodega_central -> por_devolver_a_tienda  (caso 139: retorno satelite en transito a central)
// Ambos casos registran `origen_tipo = recepcion_bodega_central` (mismo evento fisico: recepcion en
// la central) y autorizan SOLO a maestro/admin, sin acotar por zona ni tienda (R11).
type DestinoRecepcionCentral = "en_bodega_central" | "por_devolver_a_tienda";
const TRANSICIONES: Record<
  string,
  { destino: DestinoRecepcionCentral; origenTipo: OrdenHistorialOrigenTipo }
> = {
  en_ruta_bodega_central: { destino: "en_bodega_central", origenTipo: "recepcion_bodega_central" },
  devolviendo_a_bodega_central: {
    destino: "por_devolver_a_tienda",
    origenTipo: "recepcion_bodega_central",
  },
};
// Destinos = estados "recibida" para la idempotencia: si la orden ya esta en cualquiera de ellos, la
// recepcion es no-op (`ya_recibida`), venga del caso 138 o del 139.
const ESTADOS_RECIBIDA = new Set<string>(Object.values(TRANSICIONES).map((t) => t.destino));

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick
// para dobles de test sin DB/HTTP (patron RecepcionOrigenService).
type RecepcionBodegaCentralRepo = Pick<
  IOrdenRepository,
  "findByNumGuiaForTransicion" | "findEstatusIdByValue" | "recibirEnBodegaCentral"
>;

/**
 * Recepcion en la BODEGA CENTRAL por escaneo del QR (STATE-AWARE, feature 138 + 139). Espejo de
 * `RecepcionOrigenService` cambiando el alcance por TIENDA por el alcance GLOBAL de maestro/admin
 * (`esAccesoTotal`): impone el rol, la guardia de estado y la idempotencia, y persiste la transicion
 * via el UPDATE guardado + append del historial en la misma tx (choke point de la feature 49). UN
 * solo escaner resuelve el par ORIGEN->DESTINO por el estado de origen: `en_ruta_bodega_central ->
 * en_bodega_central` (138) o `devolviendo_a_bodega_central -> por_devolver_a_tienda` (139). A
 * diferencia de la satelite/origen NO hay guardia de zona ni de tienda: la bodega central es global
 * (R11). No conoce HTTP ni Prisma.
 */
export class RecepcionBodegaCentralService implements IRecepcionBodegaCentralService {
  constructor(private readonly repo: RecepcionBodegaCentralRepo) {}

  async recibirEnBodegaCentral(
    numGuia: number,
    actor: Actor,
  ): Promise<RecibirEnBodegaCentralServiceResult> {
    // 1. Rol: solo maestro/admin (acceso total) recibe en la bodega central (R4/R17).
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

    // 2. Cargar por num_guia. `findByNumGuiaForTransicion` NO filtra borradas: aqui se
    //    distingue "no existe" de "borrada", y ambas son `no_encontrada` (R6).
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };

    // 3. Idempotencia: ya en cualquiera de los destinos (en_bodega_central / por_devolver_a_tienda)
    //    -> no re-transiciona ni toca el historial (R7).
    if (ESTADOS_RECIBIDA.has(row.estatusValue)) return { status: "ya_recibida" };

    // 4. Guardia de estado STATE-AWARE: resuelve el par ORIGEN->DESTINO por el estado actual. Si no
    //    es un origen valido de la recepcion central, `estado_invalido` con el estado actual para que
    //    la UI lo nombre (R8). SIN acotar por zona ni tienda (R11).
    const transicion = TRANSICIONES[row.estatusValue];
    if (!transicion) return { status: "estado_invalido", estado: row.estatusValue };

    // 5. El destino resuelto debe existir en el catalogo (sembrado por seedOrderStatus).
    const destinoId = await this.repo.findEstatusIdByValue(transicion.destino);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${transicion.destino}`] },
      };
    }

    // 6. Transicion atomica. El UPDATE va guardado por el estado de ORIGEN resuelto + no borrada: es
    //    la defensa REAL (la comprobacion de arriba solo permite reportar mejor). R2/R3/R17/R18.
    const transiciono = await this.repo.recibirEnBodegaCentral(row.id, row.estatusValue, destinoId, {
      actorUsuarioId: actor.usuarioId,
      origenTipo: transicion.origenTipo, // recepcion_bodega_central (ambos casos)
    });

    if (!transiciono) {
      // R9: perdio la carrera — el estado cambio entre la lectura y el UPDATE. Se re-lee para
      // distinguir "otro la recibio primero" (idempotente, ya en un destino) de un conflicto real.
      const despues = await this.repo.findByNumGuiaForTransicion(numGuia);
      if (despues && ESTADOS_RECIBIDA.has(despues.estatusValue)) return { status: "ya_recibida" };
      return { status: "conflict" };
    }

    return { status: "ok", ordenId: row.id, estado: transicion.destino };
  }
}
