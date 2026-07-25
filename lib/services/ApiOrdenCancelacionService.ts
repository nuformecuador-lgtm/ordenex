import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ApiOrdenCancelacionResult,
  IApiOrdenCancelacionService,
} from "@/lib/interfaces/services/IApiOrdenCancelacionService";

// Estado destino de la cancelacion: EXISTENTE en ORDER_STATUS_SEED (decision (a) del gate; NO
// se crea `cancelada`). La cancelacion de integrador se distingue de una devolucion real por el
// marcador `motivo = 'cancelada por tienda'` que el repo persiste en la bitacora.
const ESTADO_DESTINO_CANCELACION = "devolviendo_a_tienda";

// Subconjunto del repo que este service consume.
type CancelacionRepo = Pick<IOrdenRepository, "cancelarViaApi" | "findEstatusIdByValue">;

/**
 * Feature 106 (design §4) — CANCELACION del canal integrador. Resuelve `devolviendo_a_tienda` ->
 * `estatusId` y delega en el repo (transaccion atomica). Fuerza el owner = `actor.usuarioId`
 * (R4) y traduce la union del repo (`ok | not_found | conflict`) al resultado de dominio.
 */
export class ApiOrdenCancelacionService implements IApiOrdenCancelacionService {
  constructor(private readonly repo: CancelacionRepo) {}

  async cancelar(actor: Actor, numGuia: number): Promise<ApiOrdenCancelacionResult> {
    const devueltaOrigenEstatusId = await this.repo.findEstatusIdByValue(ESTADO_DESTINO_CANCELACION);
    if (!devueltaOrigenEstatusId) {
      // El estado destino esta sembrado (ORDER_STATUS_SEED); su ausencia es un fallo de infra.
      throw new Error(`estatus destino '${ESTADO_DESTINO_CANCELACION}' no existe en el catalogo`);
    }

    const result = await this.repo.cancelarViaApi({
      numGuia,
      ownerId: actor.usuarioId, // R4: owner = actor, forzado en el repo
      devueltaOrigenEstatusId,
    });

    switch (result.status) {
      case "ok":
        return {
          status: "ok",
          data: {
            numGuia,
            estadoAnterior: result.estadoAnterior,
            estado: ESTADO_DESTINO_CANCELACION,
          },
        };
      case "not_found":
        return { status: "not_found" }; // R23/R24
      case "conflict":
        return { status: "conflict" }; // R20
    }
  }
}
