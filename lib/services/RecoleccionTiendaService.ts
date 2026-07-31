import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecoleccionTiendaService,
  RecolectarEnTiendaServiceResult,
} from "@/lib/interfaces/services/IRecoleccionTiendaService";

// Feature 157 — RECOLECCION EN TIENDA por el mensajero (arista #43, declarada por la 154 y sin
// productor hasta aqui). El mensajero va a la tienda, escanea el QR de la etiqueta y la orden
// pasa `por_recolectar_en_tienda -> en_ruta_bodega_central`, donde empalma con el tramo que ya
// existe: la bodega central la recibe por QR (feature 138) y queda en `en_bodega_central`.
//
// Espejo estructural de `RecepcionBodegaCentralService` con tres diferencias:
//   - el rol autorizado es `mensajero` (el acto fisico es suyo), no acceso total;
//   - hay guardia de PROPIEDAD: solo la recolecta el mensajero asignado (R30);
//   - hay guardia de BLOQUEO por cierre pendiente (R31), la misma que `MisAsignacionesService`.
// El par ORIGEN->DESTINO es UNICO, asi que no hay tabla state-aware que resolver.

// Feature 157 (ampliada 2026-07-31): se recolecta lo que ALGUIEN tiene asignado, y eso es
// `recolectando`. Una orden en `por_recolectar_en_tienda` no tiene mensajero, asi que la
// guardia de propiedad la rechazaria igualmente: el origen y el dueño van de la mano.
const ORIGEN_RECOLECCION = "recolectando";
const DESTINO_RECOLECCION = "en_ruta_bodega_central";

// Feature 111/R1: mismo texto que usa `MisAsignacionesService` para el bloqueo total. Mientras
// el mensajero tenga un cierre `solicitado`/`vencido` sin resolver no mueve ninguna guia, y
// recolectar es mover una.
const MSG_BLOQUEADO =
  "Tenes un cierre pendiente sin resolver; resolvelo antes de gestionar tus guias.";

// Motivo del `conflict` cuando la escritura guardada no afecto ninguna fila (R34).
const MSG_CARRERA = "la orden cambio de estado durante la recoleccion";

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick
// para dobles de test sin DB/HTTP (patron `RecepcionBodegaCentralService`).
type RecoleccionTiendaRepo = Pick<
  IOrdenRepository,
  | "findByNumGuiaForTransicion"
  | "findEstatusIdByValue"
  | "recolectarEnTienda"
  | "findMensajerosBloqueados"
>;

export class RecoleccionTiendaService implements IRecoleccionTiendaService {
  constructor(private readonly repo: RecoleccionTiendaRepo) {}

  async recolectarEnTienda(
    numGuia: number,
    actor: Actor,
  ): Promise<RecolectarEnTiendaServiceResult> {
    // 1. Rol: solo el mensajero recolecta (R29). Maestro/admin NO tienen camino aqui.
    if (actor.rol !== "mensajero") return { status: "forbidden" };

    // 2. Bloqueo por cierre pendiente, ANTES de leer la orden (R31): mismo orden que `gestionar`,
    //    de modo que un mensajero bloqueado no llega siquiera a saber si la guia existe.
    const bloqueados = await this.repo.findMensajerosBloqueados([actor.usuarioId]);
    if (bloqueados.has(actor.usuarioId)) {
      return { status: "conflict", motivo: MSG_BLOQUEADO };
    }

    // 3. Cargar por num_guia. `findByNumGuiaForTransicion` NO filtra borradas: aqui se
    //    distingue "no existe" de "borrada", y ambas son `no_encontrada` (R30).
    const row = await this.repo.findByNumGuiaForTransicion(numGuia);
    if (!row || row.deletedAt !== null) return { status: "no_encontrada" };

    // 4. PROPIEDAD (R30): la orden de otro mensajero es indistinguible de una inexistente. Un
    //    status propio para la ajena filtraria su existencia a quien escanee una etiqueta suelta.
    if (row.mensajeroAsignadoId !== actor.usuarioId) return { status: "no_encontrada" };

    // 5. Idempotencia: ya recolectada -> no re-transiciona ni toca el historial (R32). Escanear
    //    dos veces la misma etiqueta es lo normal en una recoleccion de decenas de paquetes.
    if (row.estatusValue === DESTINO_RECOLECCION) return { status: "ya_recolectada" };

    // 6. Guardia de estado: fuera del origen no hay recoleccion que confirmar. Lleva el estado
    //    actual para que la UI pueda nombrarlo (R33).
    if (row.estatusValue !== ORIGEN_RECOLECCION) {
      return { status: "estado_invalido", estado: row.estatusValue };
    }

    // 7. El destino debe existir en el catalogo (sembrado por seedOrderStatus).
    const destinoId = await this.repo.findEstatusIdByValue(DESTINO_RECOLECCION);
    if (destinoId === null) {
      return {
        status: "validation_error",
        fieldErrors: { estatus: [`el catalogo no tiene ${DESTINO_RECOLECCION}`] },
      };
    }

    // 8. Transicion atomica. El UPDATE va guardado por estado de ORIGEN + no borrada + MENSAJERO:
    //    esa es la defensa REAL (los pasos 4-6 solo permiten reportar mejor). R26/R28/R34.
    const transiciono = await this.repo.recolectarEnTienda(
      row.id,
      ORIGEN_RECOLECCION,
      destinoId,
      actor.usuarioId,
      { actorUsuarioId: actor.usuarioId, origenTipo: "recoleccion_tienda" },
    );

    if (!transiciono) {
      // 9. R34: perdio la carrera. Se re-lee para distinguir "ya estaba recolectada" (idempotente)
      //    de un conflicto real.
      const despues = await this.repo.findByNumGuiaForTransicion(numGuia);
      if (despues && despues.estatusValue === DESTINO_RECOLECCION) {
        return { status: "ya_recolectada" };
      }
      return { status: "conflict", motivo: MSG_CARRERA };
    }

    return { status: "ok", ordenId: row.id, estado: DESTINO_RECOLECCION };
  }
}
