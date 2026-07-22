import { type PrismaClient } from "@prisma/client";
import type {
  DevueltaSlaRow,
  EscalarDevueltaSlaInput,
  IDevolucionSlaRepository,
  LiberarDevueltaSlaInput,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";

// Estatus de ORIGEN del cron (una orden en `devuelta`) y `resultado` de la gestion que ancla la
// ventana. Valores de catalogo ya sembrados (ORDER_STATUS_SEED / gestion_resultado); esta
// feature NO agrega estados.
const ESTATUS_DEVUELTA = "devuelta";
const RESULTADO_DEVUELTA = "devuelta";

// Feature 49/#10: `$transaction` para que el UPDATE guardado, el INSERT de la gestion sintetica
// y el append del historial compartan tx (R18/R20). El `tx` del callback expone
// `ordenHistorialEstado` (choke point) y `gestionOrden`.
type DevolucionSlaPrismaClient = Pick<PrismaClient, "orden" | "gestionOrden" | "$transaction">;

/**
 * Feature 99 (design §3.4) — repositorio del cron SLA de devoluciones diferidas. SOLO queries
 * Prisma (sin logica de negocio: la ventana, el ruteo a bodega y la decision reintento/escalado
 * las decide `DevolucionSlaService`). Reutiliza `orden` + `gestion_orden`; no introduce tablas.
 * Toda transicion pasa por el choke point `appendCambioEstado` en su MISMA tx (R18), NUNCA
 * escribe `orden.estatus_id` por fuera.
 */
export class DevolucionSlaRepository implements IDevolucionSlaRepository {
  constructor(private readonly prisma: DevolucionSlaPrismaClient) {}

  /**
   * R5: ordenes en `devuelta` + no borradas, con su gestion `devuelta` VIGENTE mas reciente
   * (`orderBy createdAt desc`, `take 1`, `anulada_at IS NULL`). Deriva el anclaje de la ventana
   * (causa + `created_at`) y el mensajero de esa gestion. Filtra en memoria las ordenes SIN
   * gestion vigente (patron `findOrdenesLiberables`); las que la tienen con `causa` null SI
   * salen (el service las omite, R28).
   */
  async findDevueltasSla(): Promise<DevueltaSlaRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: {
        deletedAt: null, // R5
        estatus: { value: ESTATUS_DEVUELTA }, // R5
      },
      select: {
        id: true,
        zonaId: true,
        gestiones: {
          // gestion vigente = la mas reciente NO anulada (feature 67).
          where: { resultado: RESULTADO_DEVUELTA, anuladaAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { mensajeroId: true, causaDevolucion: true, createdAt: true },
        },
      },
    });

    const candidatas: DevueltaSlaRow[] = [];
    for (const r of rows) {
      const g = r.gestiones[0];
      // Sin gestion `devuelta` vigente -> anomalia sin anclaje: se ignora (no se cuenta).
      if (!g) continue;
      candidatas.push({
        ordenId: r.id,
        zonaId: r.zonaId,
        mensajeroId: g.mensajeroId,
        causa: g.causaDevolucion, // puede ser null (R28: el service la omite)
        ancladaAt: g.createdAt,
      });
    }
    return candidatas;
  }

  /**
   * R15/R18/R19/R24/R25: UPDATE guardado por `estatus_id = devuelta` + no borrada; fija el
   * destino de bodega y limpia `mensajero_asignado_id` (+ `asignado_at`). Si la orden ya salio
   * de `devuelta` (2.ª corrida / carrera) afecta 0 filas -> false. El append (actor NULL,
   * `origen_tipo = liberacion_devuelta_sla`) va DENTRO del `if (count > 0)` de la MISMA tx.
   *
   * Feature 101 (R2/R4, gate F1.4-Q5): enciende `prioridad = true` en el MISMO `data` del
   * `updateMany` GUARDADO. Por estar dentro de la guarda por `estatus_id = devuelta`, una orden
   * que ya salio de `devuelta` (count 0) NO se toca -> el flag no cambia (R4, idempotencia).
   * Solo la liberacion por SLA lo enciende: `escalarDevueltaSla` (-> rechazada) y la recuperacion
   * MANUAL de la feature 100 NO tocan `prioridad` (R3).
   */
  async liberarDevueltaSla(input: LiberarDevueltaSlaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusDevueltaId, // R24/R25: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.destinoEstatusId, // R15 (destino ya resuelto por el service)
          mensajeroAsignadoId: null, // R15: handoff limpio a la bodega (nuevo intento)
          asignadoAt: null, // limpia el timestamp de asignacion (defensivo, patron 46)
          prioridad: true, // feature 101/R2: liberada por SLA -> reasignacion prioritaria
        },
      });
      // R24/R25: SOLO si transiciono (count 1); una re-corrida/carrera (count 0) no duplica.
      if (result.count > 0) {
        await appendCambioEstado(tx, [
          {
            ordenId: input.ordenId,
            estatusOrigenId: input.estatusDevueltaId, // R18: origen `devuelta` (fijado por la guarda)
            estatusDestinoId: input.destinoEstatusId,
            actorUsuarioId: null, // R19: sistema/cron
            origenTipo: "liberacion_devuelta_sla", // R19
          },
        ]);
      }
      return result.count > 0;
    });
  }

  /**
   * R16/R17/R18/R19/R20-R25 (Option A del dinero): UPDATE guardado por `estatus_id = devuelta`
   * -> `rechazada` (NO toca el mensajero: paridad con un rechazo directo). Si count 0 -> false
   * (ya salio de `devuelta`: R21/R24/R25, sin efectos). Si count 1: crea en la MISMA tx una
   * gestion sintetica `resultado = rechazada` (`cierre_id NULL`, del `mensajeroId` de la gestion
   * `devuelta` vigente, R22) para que el ingreso de bodega por rechazo (56) lo snapshotee el
   * PROXIMO cierre SIN codigo monetario nuevo (R20/R23) y sin descuadrar cierres cerrados; el
   * append (actor NULL, `origen_tipo = escalado_devuelta_sla`) enlaza esa gestion.
   */
  async escalarDevueltaSla(input: EscalarDevueltaSlaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusDevueltaId, // R21/R24/R25: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.estatusRechazadaId, // R16/R17: escalado final
          // NO toca `mensajeroAsignadoId` (paridad con un rechazo directo del mensajero, 47/48).
        },
      });
      // R21/R24/R25: la orden ya salio de `devuelta` -> NO crea gestion ni append (sin doble dinero).
      if (result.count === 0) return false;

      // R20/R22/R23 (Option A): gestion sintetica `rechazada` del mensajero atribuido,
      // `cierre_id NULL` -> entra al PROXIMO cierre; `derivarIngresoBodega`/
      // `ingresoBodegaPorResultado` (56) la cobran desde `resultado`, sin aritmetica nueva.
      const gestionSintetica = await tx.gestionOrden.create({
        data: {
          ordenId: input.ordenId,
          mensajeroId: input.mensajeroId, // R22
          resultado: "rechazada", // R20: dispara el snapshot 56 + el feed de wallet 42/69
          motivo: input.motivo,
          cierreId: null, // entra al proximo cierre (sin descuadrar cierres cerrados)
          // sin evidencia ni causa: es un escalado del sistema, no una gestion del mensajero.
        },
        select: { id: true },
      });
      // R18: la transicion pasa por el choke point, en la MISMA tx, enlazando la gestion.
      await appendCambioEstado(tx, [
        {
          ordenId: input.ordenId,
          estatusOrigenId: input.estatusDevueltaId, // R18: origen `devuelta` (fijado por la guarda)
          estatusDestinoId: input.estatusRechazadaId,
          actorUsuarioId: null, // R19: sistema/cron
          origenTipo: "escalado_devuelta_sla", // R19
          gestionOrdenId: gestionSintetica.id,
        },
      ]);
      return true;
    });
  }
}
