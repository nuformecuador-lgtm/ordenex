import type { GestionCausaDevolucion } from "@prisma/client";
import { reintentosConfig } from "@/lib/config/reintentos";
import type {
  DevueltaSlaRow,
  IDevolucionSlaRepository,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  DevolucionSlaResult,
  IDevolucionSlaService,
} from "@/lib/interfaces/services/IDevolucionSlaService";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";

// Estatus destino de las transiciones del cron (valores de catalogo YA sembrados; esta feature
// NO agrega estados). Origen SIEMPRE `devuelta` (guarda de idempotencia en el repo).
const ESTATUS_DEVUELTA = "devuelta";
const ESTATUS_EN_BODEGA = "en_bodega_central"; // reintento -> bodega central
const ESTATUS_EN_BODEGA_SATELITE = "en_bodega_satelite"; // reintento -> bodega satelite
const ESTATUS_RECHAZADA = "rechazada"; // escalado (final)

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
// R6/Q3: ventanas ROLLING desde el anclaje. `not_found` = 24h; `wrong_*` = 5 dias (accion el
// dia 6). Independientes de la cadencia con la que corra el cron (horario).
const VENTANA_NOT_FOUND_MS = 24 * HORA_MS;
const VENTANA_WRONG_MS = 5 * DIA_MS;

// Metodos de repo/servicio consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
type OrdenRepo = Pick<IOrdenRepository, "findEstatusIdByValue">;
type HistorialSvc = Pick<IOrdenHistorialService, "contarIntentos">;

// Log de aviso inyectable: por defecto console.warn. NUNCA registra PII/secretos (R11): solo
// conteos agregados.
export interface DevolucionSlaLogger {
  warn(message: string): void;
}
const defaultLogger: DevolucionSlaLogger = { warn: (m) => console.warn(m) };

/**
 * Feature 99 (design §3.3, R6/R13/R14-R19/R26/R27/R28) — logica de negocio del cron SLA de
 * devoluciones diferidas. Por cada orden que REPOSA en `devuelta`, evalua su ventana ROLLING
 * desde el anclaje derivado (ultima gestion `devuelta` vigente): `not_found` a las 24h se libera
 * a bodega (reintento) si el conteo de intentos derivado (49) es menor que el umbral, o escala a
 * `rechazada` si lo alcanza; `wrong_number`/`wrong_address` escalan DIRECTO a `rechazada` a los 5
 * dias. Resiliente por orden (un fallo no aborta la corrida) e idempotente (la guarda por estado
 * del repo evita el doble efecto). No conoce HTTP ni Prisma directo; testeable con dobles y reloj
 * fijo.
 */
export class DevolucionSlaService implements IDevolucionSlaService {
  constructor(
    private readonly repo: IDevolucionSlaRepository,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly historial: HistorialSvc,
    private readonly logger: DevolucionSlaLogger = defaultLogger,
  ) {}

  async ejecutar(now: Date): Promise<DevolucionSlaResult> {
    // Resuelve los estatus una sola vez (no por orden). Guarda si falta el seed (R27).
    const [estatusDevueltaId, estatusBodegaId, estatusBodegaSateliteId, estatusRechazadaId] =
      await Promise.all([
        this.ordenRepo.findEstatusIdByValue(ESTATUS_DEVUELTA),
        this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA),
        this.ordenRepo.findEstatusIdByValue(ESTATUS_EN_BODEGA_SATELITE),
        this.ordenRepo.findEstatusIdByValue(ESTATUS_RECHAZADA),
      ]);
    if (
      estatusDevueltaId === null ||
      estatusBodegaId === null ||
      estatusBodegaSateliteId === null ||
      estatusRechazadaId === null
    ) {
      // R27: catalogo incompleto -> no actua (resultado controlado, no crash). Aviso sin PII.
      this.logger.warn(
        "[procesar-devueltas-sla] catalogo de estados incompleto (seed pendiente); no se procesa",
      );
      return { evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0 };
    }

    // R12: la clasificacion a central usa la zona central (o null: todo cae a satelite, fallback
    // seguro de `resolverDestinoCierre`).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    const umbral = reintentosConfig.MIN_INTENTOS_ENTREGA; // R15/R16

    const candidatas = await this.repo.findDevueltasSla();

    let evaluadas = 0;
    let liberadas = 0;
    let escaladas = 0;
    let omitidas = 0;

    for (const orden of candidatas) {
      try {
        // R28: sin causa en la ultima gestion vigente -> se omite (no se adivina ventana).
        if (orden.causa === null) {
          omitidas += 1;
          continue;
        }
        // R14/R13/R17 (ventana viva): aun no vence -> la orden reposa en `devuelta`, no se actua.
        if (!venceVentana(orden.causa, orden.ancladaAt, now)) {
          evaluadas += 1;
          continue;
        }

        if (orden.causa === "not_found") {
          // Q4: `contarIntentos` YA incluye la devolucion vigente (la orden reposa en `devuelta`).
          const intentos = await this.historial.contarIntentos(orden.ordenId); // R3
          if (intentos >= umbral) {
            // R16: alcanzo el umbral -> escala a `rechazada`.
            const ok = await this.escalar(orden, estatusDevueltaId, estatusRechazadaId);
            if (ok) escaladas += 1;
            else omitidas += 1; // R24/R25: guarda de estado ya no vigente
          } else {
            // R15: reintento -> bodega responsable derivada de la zona, limpia el mensajero.
            const ok = await this.liberar(
              orden,
              centralZonaId,
              estatusDevueltaId,
              estatusBodegaId,
              estatusBodegaSateliteId,
            );
            if (ok) liberadas += 1;
            else omitidas += 1;
          }
        } else {
          // R17: `wrong_number` / `wrong_address` -> escalado DIRECTO a `rechazada`, sin bucle.
          const ok = await this.escalar(orden, estatusDevueltaId, estatusRechazadaId);
          if (ok) escaladas += 1;
          else omitidas += 1;
        }
      } catch {
        // R26: un fallo por orden no aborta la corrida; se contabiliza y se continua.
        omitidas += 1;
      }
    }

    if (omitidas > 0) {
      this.logger.warn(
        `[procesar-devueltas-sla] ${omitidas} orden(es) omitida(s) en esta corrida`,
      );
    }
    return { evaluadas, liberadas, escaladas, omitidas };
  }

  /** R15: reintento -> bodega responsable derivada de la zona (reusa el ruteo 41/46). */
  private liberar(
    orden: DevueltaSlaRow,
    centralZonaId: string | null,
    estatusDevueltaId: string,
    estatusBodegaId: string,
    estatusBodegaSateliteId: string,
  ): Promise<boolean> {
    const { destinoTipo } = resolverDestinoCierre(orden.zonaId, centralZonaId);
    const destinoEstatusId =
      destinoTipo === "bodega_central" ? estatusBodegaId : estatusBodegaSateliteId;
    return this.repo.liberarDevueltaSla({
      ordenId: orden.ordenId,
      destinoEstatusId,
      estatusDevueltaId,
    });
  }

  /** R16/R17/R20-R25: escalado a `rechazada` con la gestion sintetica (Option A del dinero). */
  private escalar(
    orden: DevueltaSlaRow,
    estatusDevueltaId: string,
    estatusRechazadaId: string,
  ): Promise<boolean> {
    return this.repo.escalarDevueltaSla({
      ordenId: orden.ordenId,
      estatusDevueltaId,
      estatusRechazadaId,
      mensajeroId: orden.mensajeroId, // R22: atribuye el ingreso de bodega a este mensajero
      motivo: `escalado SLA ${orden.causa}`,
    });
  }
}

/**
 * R6/R13: vencimiento ROLLING desde el anclaje. `not_found` -> 24h; `wrong_number`/
 * `wrong_address` -> 5 dias. Funcion pura para pruebas deterministas con reloj fijo.
 */
function venceVentana(
  causa: GestionCausaDevolucion,
  ancladaAt: Date,
  now: Date,
): boolean {
  const transcurrido = now.getTime() - ancladaAt.getTime();
  if (causa === "not_found") return transcurrido >= VENTANA_NOT_FOUND_MS;
  return transcurrido >= VENTANA_WRONG_MS; // wrong_number | wrong_address
}
