import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IGestionOrdenRepository } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
// FEATURE 273 (Q2, FIRMADA el 2026-08-24) — la TERCERA via hacia la circulacion se bloquea aqui,
// con el MISMO motivo unico de R20 y el MISMO umbral de configuracion.
import { MSG_TOPE_INTENTOS_ASIGNACION } from "@/lib/services/mensajes-bloqueo";
import { reintentosConfig } from "@/lib/config/reintentos";
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
 * 💰 FEATURE 273 (Q2) — el derivador de intentos. REQUERIDO: opcional, un composition root que se
 * lo olvidara dejaria abierta la tercera via en silencio.
 */
type ReprogramacionHistorialSvc = Pick<IOrdenHistorialService, "contarIntentos">;

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
    private readonly historial: ReprogramacionHistorialSvc,
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

    // 💰 3-bis. FEATURE 273 (Q2, FIRMADA el 2026-08-24) — LA TERCERA VIA HACIA LA CIRCULACION.
    //
    //    `devuelta -> reprogramada` es la puerta de la tienda, y el encargo original de la 273 no
    //    la enumeraba. Sin esta guarda la REGLA se cumpliria igual —la orden acabaria en bodega y
    //    R18 le negaria la asignacion—, pero el paquete quedaria en un CALLEJON SIN SALIDA y la
    //    tienda no se enteraria hasta TRES PASOS DESPUES. Se bloquea en el momento en que lo
    //    intenta, que es cuando la persona todavia puede decidir otra cosa.
    //
    //    `>= umbral` (no `umbral - 1`): aqui no se registra un intento nuevo —la gestion sintetica
    //    de la 100 NO es visita real y no cuenta—, asi que la pregunta es la MISMA que la de la
    //    asignacion: ¿esta orden ya agoto sus intentos? Por eso comparte el motivo (R20) y el
    //    umbral, y por eso NO usa `alcanzaElTope`, que responde otra pregunta (¿la gestion que se
    //    registre AHORA es la que alcanza el umbral?).
    //
    //    VA DESPUES de la guardia de estado y ANTES de resolver el catalogo y de escribir: sin
    //    gestion sintetica, sin transicion y sin fila de historial.
    //
    //    Lo que NO se bloquea (Q3, firmada): la RECUPERACION MANUAL a bodega. Es un movimiento
    //    FISICO que la bodega necesita registrar aunque la orden ya no se pueda repartir, y R18
    //    impide igualmente que salga.
    const intentos = await this.historial.contarIntentos(ordenId);
    if (intentos >= reintentosConfig.MIN_INTENTOS_ENTREGA) {
      return { status: "conflict", motivo: MSG_TOPE_INTENTOS_ASIGNACION };
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
