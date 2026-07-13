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
type OrdenRepo = Pick<IOrdenRepository, "findUsuarioVehiculoId">;
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
    // R7/R10: mensajeros que "debian cerrar y no solicitaron".
    const mensajeros = await this.corteRepo.findMensajerosConActividadSinCierre();

    let vencidosCreados = 0;
    let mensajerosSinZona = 0;

    for (const m of mensajeros) {
      // P2: sin zona no se puede derivar la bodega responsable -> se omite.
      if (m.zonaId === null) {
        mensajerosSinZona += 1;
        continue;
      }

      // R7/R9: relee las gestiones aun sin cerrar (una corrida previa pudo vincularlas).
      const gestiones = await this.cierreRepo.findGestionesPendientes(m.mensajeroId);
      if (gestiones.length === 0) continue; // idempotencia (R9): ya no hay actividad pendiente

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
