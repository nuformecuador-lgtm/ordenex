import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IRecuperacionBodegaRepository } from "@/lib/interfaces/repositories/IRecuperacionBodegaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRecuperacionBodegaService,
  RecuperarABodegaResult,
} from "@/lib/interfaces/services/IRecuperacionBodegaService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import type { CierreDestinoTipo } from "@/lib/types/cierre";

// Estado de ORIGEN elegible (la orden REPOSA en `devuelta`, feature 99) y destinos de bodega por
// zona. Valores de catalogo ya sembrados; esta feature NO agrega estados.
const ESTADO_ORIGEN = "devuelta";
const ESTADO_EN_BODEGA = "en_bodega"; // reintento -> bodega central
const ESTADO_EN_BODEGA_SATELITE = "en_bodega_satelite"; // reintento -> bodega satelite

// Metodos de repo que consume el service (inyeccion por constructor). Se declaran como Pick para
// dobles de test sin DB/HTTP (patron DevolucionOrigenService).
type RecuperacionOrdenRepo = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findUsuarioZonaId"
>;
type RecuperacionZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;

/**
 * Feature 100 — logica de negocio de la RECUPERACION a bodega. Calcada de `DevolucionOrigenService`
 * (48): GUARDIA de estado (solo desde `devuelta`, idempotente frente al cron SLA) + AUTZ por bodega
 * responsable (maestro/admin en la central, adminSatelite de la zona de la orden), y delega la
 * transicion atomica + limpieza de mensajero al repo (molde de `liberarDevueltaSla`, con actor y
 * `origen_tipo = recuperacion_manual`, gate F1.4-Q2). Ruteo a bodega por la MISMA regla de zona del
 * cron (`resolverDestinoCierre` + `findCentralZonaId`). No conoce HTTP ni Prisma; testeable con
 * dobles sin red/DB.
 */
export class RecuperacionBodegaService implements IRecuperacionBodegaService {
  constructor(
    private readonly ordenRepo: RecuperacionOrdenRepo,
    private readonly zonaRepo: RecuperacionZonaRepo,
    private readonly recuperacionRepo: IRecuperacionBodegaRepository,
  ) {}

  async recuperar(ordenId: string, actor: Actor): Promise<RecuperarABodegaResult> {
    // 1. Cargar la orden; findById excluye borradas -> not_found.
    const orden = await this.ordenRepo.findById(ordenId);
    if (!orden) return { status: "not_found" };

    // 2. Guardia de estado de origen (R16). Elegible SOLO desde `devuelta` (la orden reposa ahi
    //    bajo la feature 99). Cualquier otro estado -> conflict, sin efectos ni historial.
    if (orden.estatusValue !== ESTADO_ORIGEN) {
      return {
        status: "conflict",
        motivo: `la orden no esta en ${ESTADO_ORIGEN} (estado actual: ${orden.estatusValue ?? "desconocido"})`,
      };
    }

    // 3. Autz por bodega responsable (R15) — ANTES de cualquier escritura. Deriva la bodega de la
    //    zona de la orden (misma regla de las features 41/48/99), con fallback seguro
    //    (centralZonaId null -> satelite; resolverDestinoCierre no lanza).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const { destinoTipo } = resolverDestinoCierre(orden.zonaId, centralZonaId);
    const autorizado = await this.esBodegaResponsable(destinoTipo, orden.zonaId, actor);
    if (!autorizado) return { status: "forbidden" }; // R15: sin efectos

    // 4. Resolver el destino de bodega por zona + su estatus del catalogo. Falta de seed ->
    //    config_error.
    const destinoValue =
      destinoTipo === "bodega_central" ? ESTADO_EN_BODEGA : ESTADO_EN_BODEGA_SATELITE;
    const [estatusDevueltaId, destinoEstatusId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_ORIGEN),
      this.ordenRepo.findEstatusIdByValue(destinoValue),
    ]);
    if (estatusDevueltaId === null || destinoEstatusId === null) {
      return { status: "config_error" };
    }

    // 5. Transicion atomica + limpieza de mensajero via el choke point de la 49 (R13/R14/R17/R20).
    //    La guarda por `estatus_id = devuelta` del repo hace la accion idempotente frente a la
    //    carrera con el cron SLA de la 99: si perdio la carrera (count 0), el repo devuelve false.
    const ok = await this.recuperacionRepo.recuperarABodega({
      ordenId,
      destinoEstatusId,
      estatusDevueltaId,
      actorUsuarioId: actor.usuarioId,
    });
    // R16: carrera con el cron SLA (o doble submit) -> la orden ya no estaba en `devuelta`.
    if (!ok) {
      return {
        status: "conflict",
        motivo: `la orden ya no esta en ${ESTADO_ORIGEN}`,
      };
    }
    return { status: "ok" };
  }

  /**
   * R15: el actor es la bodega responsable de la orden si es maestro/admin cuando la zona resuelve
   * a la bodega central, o el adminSatelite CUYA zona coincide con la de la orden cuando resuelve a
   * satelite. Cualquier otro caso (adminTienda, mensajero, adminSatelite de otra zona) NO es
   * responsable. Patron `DevolucionOrigenService.esBodegaResponsable` (feature 48).
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
