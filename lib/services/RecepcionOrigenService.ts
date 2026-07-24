import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecepcionOrigenService,
  RecibirEnOrigenServiceResult,
} from "@/lib/interfaces/services/IRecepcionOrigenService";

// Estado de ORIGEN elegible (la orden viaja de vuelta a la tienda) y destino
// (la tienda la recibio fisicamente). Cierra el flujo de devolucion:
//   rechazada --(adminSatelite)--> devolviendo_a_tienda --(adminTienda)--> devuelta_a_tienda
const ORIGEN_RECEPCION = "devolviendo_a_tienda";
const ESTADO_RECIBIDA = "devuelta_a_tienda";

// Solo la TIENDA recibe de vuelta su propio paquete. Para el adminTienda su
// `usuarioId` ES el `tiendaId` de la orden (misma identidad que usa
// `OrdenService.listar`: `where.tiendaId = actor.usuarioId`).
const ROL_AUTORIZADO = "adminTienda";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran
// como Pick para dobles de test sin DB/HTTP (patron RecepcionSateliteService).
type RecepcionOrigenRepo = Pick<
  IOrdenRepository,
  "findByNumGuiaForTransicion" | "findEstatusIdByValue" | "recibirEnOrigen"
>;

/**
 * Recepcion en la tienda de ORIGEN por escaneo del QR. Espejo de
 * `RecepcionSateliteService.recibir` cambiando el alcance de ZONA por el de TIENDA:
 * impone el rol, el alcance por tienda, la guardia de estado y la idempotencia, y
 * persiste la transicion via el UPDATE guardado + append del historial en la misma
 * tx (choke point de la feature 49). No conoce HTTP ni Prisma.
 */
export class RecepcionOrigenService implements IRecepcionOrigenService {
  constructor(private readonly repo: RecepcionOrigenRepo) {}

  async recibirEnOrigen(
    numGuia: number,
    actor: Actor,
  ): Promise<RecibirEnOrigenServiceResult> {
    // 1. Rol: solo el adminTienda recibe de vuelta en la tienda.
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" };

    // 2. Cargar por num_guia. `findByNumGuiaForTransicion` NO filtra borradas: aqui
    //    se distingue "no existe" de "borrada", y ambas son `no_encontrada`.
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };

    // 3. Alcance por TIENDA — ANTES de las guardias de estado (igual que el satelite
    //    pone `zona_ajena` antes de `ya_recibida`): una orden ajena nunca revela en
    //    que estado esta, ni siquiera para decir "ya estaba recibida".
    if (row.tiendaId !== actor.usuarioId) return { status: "tienda_ajena" };

    // 4. Idempotencia: ya recibida -> no re-transiciona ni toca el historial.
    if (row.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };

    // 5. Guardia de estado: elegible SOLO desde `devolviendo_a_tienda`. Lleva el estado
    //    actual para que la UI pueda nombrarlo.
    if (row.estatusValue !== ORIGEN_RECEPCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    // 6. El destino debe existir en el catalogo (sembrado por seedOrderStatus).
    const destinoId = await this.repo.findEstatusIdByValue(ESTADO_RECIBIDA);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${ESTADO_RECIBIDA}`] },
      };
    }

    // 7. Transicion atomica. El UPDATE va guardado por estado + tienda + no borrada:
    //    es la defensa REAL (la comprobacion de arriba solo permite reportar mejor).
    const transiciono = await this.repo.recibirEnOrigen(row.id, actor.usuarioId, destinoId, {
      actorUsuarioId: actor.usuarioId,
      // Misma marca que la transicion ANTERIOR de este flujo (DevolucionOrigenService):
      // no se agrega un valor al enum nativo `orden_historial_origen_tipo`, que en
      // Postgres no admite DROP VALUE (seria irreversible).
      origenTipo: "ajuste_estado",
    });

    if (!transiciono) {
      // Perdio la carrera: el estado cambio entre la lectura y el UPDATE. Se re-lee
      // para distinguir "otro la recibio primero" (idempotente) de un conflicto real.
      const despues = await this.repo.findByNumGuiaForTransicion(numGuia);
      if (despues?.estatusValue === ESTADO_RECIBIDA) return { status: "ya_recibida" };
      return { status: "conflict" };
    }

    return { status: "ok", ordenId: row.id, estado: ESTADO_RECIBIDA };
  }
}
