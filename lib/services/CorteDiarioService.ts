import type { ICierreDiaRepository } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ICorteDiarioRepository } from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type {
  CorteDiarioResult,
  ICorteDiarioService,
} from "@/lib/interfaces/services/ICorteDiarioService";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import { computeTotales, derivarPagos, derivarIngresoBodega } from "@/lib/utils/cierre-totales";

// Metodos de repo consumidos (Pick para dobles de test sin DB/red).
type ZonaRepo = Pick<IZonaRepository, "findCentralZonaId">;
// Feature 109 (T1.3): + `findEstatusIdByValue` para resolver los estatus ids de
// `en_reparto`/`sin_gestionar` que consume la transicion del corte (una vez por corrida).
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioVehiculoId" | "findEstatusIdByValue">;

// Feature 109 (R4): estados del catalogo que consume la transicion del corte diario.
const ESTADO_EN_REPARTO = "en_reparto";
const ESTADO_SIN_GESTIONAR = "sin_gestionar";
// Reusa la 37: gestiones pendientes del mensajero + creacion transaccional del cierre
// (parametrizada con estado='vencido', feature 41/C1).
type CierreRepo = Pick<ICierreDiaRepository, "findGestionesPendientes" | "crearCierre">;

// Log de aviso inyectable (P2): omitir mensajero sin zona. Por defecto console.warn.
// NUNCA registra PII/secretos (R24): solo el conteo agregado al final.
export interface CorteDiarioLogger {
  warn(message: string): void;
}
const defaultLogger: CorteDiarioLogger = { warn: (m) => console.warn(m) };

/**
 * Feature 41 — logica de negocio del corte diario (R6-R11). Por cada mensajero con
 * actividad del dia sin cerrar y sin `solicitado` (R7/R10), deriva su bodega responsable
 * (R1, resolverDestinoCierre), snapshotea totales/pago/ingreso money-safe (R8, mismos
 * helpers que solicitarCierre) y crea un `cierre_dia estado='vencido'` en transaccion
 * todo-o-nada. Idempotente por vinculacion de gestiones (R9). No conoce HTTP ni Prisma
 * directo; testeable con dobles sin red/DB.
 */
export class CorteDiarioService implements ICorteDiarioService {
  constructor(
    private readonly corteRepo: ICorteDiarioRepository,
    private readonly cierreRepo: CierreRepo,
    private readonly zonaRepo: ZonaRepo,
    private readonly ordenRepo: OrdenRepo,
    private readonly tarifaZonaRepo: ITarifaZonaMensajeroRepository,
    private readonly logger: CorteDiarioLogger = defaultLogger,
  ) {}

  async ejecutarCorte(): Promise<CorteDiarioResult> {
    // R1: la clasificacion a central usa la zona central (o null: fallback satelite).
    const centralZonaId = await this.zonaRepo.findCentralZonaId();
    // Feature 109 (T1.3, R4): resuelve UNA vez los estatus ids de la transicion del corte. Si el
    // catalogo aun no tiene `sin_gestionar` (seed pendiente), se omite la transicion y el corte se
    // comporta como la 41 (solo `vencido` por gestiones) — no bloquea el flujo money-critical.
    const [enRepartoEstatusId, sinGestionarEstatusId] = await Promise.all([
      this.ordenRepo.findEstatusIdByValue(ESTADO_EN_REPARTO),
      this.ordenRepo.findEstatusIdByValue(ESTADO_SIN_GESTIONAR),
    ]);
    const corteSinGestionar =
      enRepartoEstatusId !== null && sinGestionarEstatusId !== null
        ? { enRepartoEstatusId, sinGestionarEstatusId }
        : undefined;
    // R4/R7/R10: mensajeros que "debian cerrar" (gestiones sin cerrar) O que dejaron ordenes en
    // `en_reparto` al pasar de dia; sin un cierre ABIERTO (R10/R29).
    const mensajeros = await this.corteRepo.findMensajerosConActividadSinCierre();

    let vencidosCreados = 0;
    let mensajerosSinZona = 0;

    for (const m of mensajeros) {
      // P2: sin zona no se puede derivar la bodega responsable -> se omite.
      if (m.zonaId === null) {
        mensajerosSinZona += 1;
        continue;
      }

      // R7/R9: relee las gestiones aun sin cerrar (una corrida previa pudo vincularlas). Feature
      // 109 (R8): YA NO se hace `continue` si son 0 — el mensajero puede estar en la lista SOLO por
      // ordenes `en_reparto` (money-neutral). `crearCierre` decide via la guarda "algo paso": si no
      // vincula gestiones NI transiciona `sin_gestionar`, devuelve null (idempotencia R9).
      const gestiones = await this.cierreRepo.findGestionesPendientes(m.mensajeroId);

      // R1: bodega responsable derivada (misma regla que solicitarCierre).
      const { destinoTipo } = resolverDestinoCierre(m.zonaId, centralZonaId);

      // R8: snapshot money-safe con los MISMOS helpers que solicitarCierre (37/39/56).
      const vehiculoId = await this.ordenRepo.findUsuarioVehiculoId(m.mensajeroId);
      const tarifa = await this.tarifaZonaRepo.resolvePagoTarifa(m.zonaId, vehiculoId);
      const totales = computeTotales(gestiones);
      const { pagoByGestionId, total: totalPagoMensajero } = derivarPagos(gestiones, tarifa);
      const { ingresoByGestionId, total: totalIngresoBodegaRechazos } = derivarIngresoBodega(
        gestiones,
        tarifa,
      );

      // R6/R8/R23: crea el `vencido` con la MISMA tx de vinculacion + snapshot. Si vincula
      // 0 gestiones (carrera con una solicitud) devuelve null: no cuenta como creado (R9).
      const cierreId = await this.cierreRepo.crearCierre({
        mensajeroId: m.mensajeroId,
        estado: "vencido",
        destinoTipo,
        destinoZonaId: m.zonaId,
        // Feature 109 (T1.3, R4/R6): en la MISMA tx transiciona `en_reparto -> sin_gestionar` del
        // mensajero (via choke point). undefined si el catalogo no lo soporta (seed pendiente).
        corteSinGestionar,
        totales,
        pagoByGestionId,
        totalPagoMensajero,
        ingresoByGestionId,
        totalIngresoBodegaRechazos,
      });
      if (cierreId !== null) vencidosCreados += 1;
    }

    // P2: aviso agregado sin PII (R24).
    if (mensajerosSinZona > 0) {
      this.logger.warn(
        `[corte-diario] ${mensajerosSinZona} mensajero(s) con actividad pendiente omitidos por no tener zona asignada`,
      );
    }

    return { mensajerosEvaluados: mensajeros.length, vencidosCreados, mensajerosSinZona };
  }
}
