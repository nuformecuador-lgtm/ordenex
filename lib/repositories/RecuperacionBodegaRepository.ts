import { type PrismaClient } from "@prisma/client";
import type {
  IRecuperacionBodegaRepository,
  RecuperarABodegaInput,
} from "@/lib/interfaces/repositories/IRecuperacionBodegaRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";

// Feature 100/#Q2: `$transaction` para que el UPDATE guardado y el append del historial compartan
// tx (R20). El `tx` del callback expone `orden` (updateMany) y `ordenHistorialEstado` (choke point).
type RecuperacionBodegaPrismaClient = Pick<PrismaClient, "orden" | "$transaction">;

/**
 * Feature 100 (design §3.1) — repositorio de la RECUPERACION a bodega. SOLO queries Prisma (sin
 * logica de negocio: el ruteo por zona y la autz por bodega responsable los decide
 * `RecuperacionBodegaService`). Molde EXACTO de `DevolucionSlaRepository.liberarDevueltaSla` (99):
 * UPDATE guardado por `estatus_id = devuelta` + limpia mensajero + enciende `prioridad` + append
 * via el choke point, en la MISMA tx. Diferencia deliberada (gate F1.4-Q2): el actor es el admin
 * que ejecuta (NO NULL) y el `origen_tipo` es `recuperacion_manual` (NO `liberacion_devuelta_sla`),
 * para no etiquetar una accion MANUAL como del cron ni perder la trazabilidad del actor. NO
 * reutiliza `liberarDevueltaSla` porque ese metodo fija actor NULL + `liberacion_devuelta_sla`.
 * Reutiliza `orden` + `orden_historial_estado`; no introduce tablas.
 */
export class RecuperacionBodegaRepository implements IRecuperacionBodegaRepository {
  constructor(private readonly prisma: RecuperacionBodegaPrismaClient) {}

  /**
   * R13/R14/R16/R17/R20/R21: UPDATE guardado por `estatus_id = devuelta` + no borrada; fija el
   * destino de bodega y limpia `mensajero_asignado_id` (+ `asignado_at`, R14). Si la orden ya salio
   * de `devuelta` (2.ª corrida / carrera con el cron SLA de la 99) afecta 0 filas -> false, sin
   * efectos. El append (actor = el admin, `origen_tipo = recuperacion_manual`) va DENTRO del
   * `if (count > 0)` de la MISMA tx.
   *
   * Feature 110 (R2/R4, gate F1.4-Q1): la recuperacion MANUAL SI enciende `orden.prioridad = true`
   * en el MISMO `data` del `updateMany` GUARDADO (invierte la decision previa de la 101/R3). La
   * orden recuperada vuelve exactamente a la misma superficie de reasignacion (`en_bodega` /
   * `en_bodega_satelite`) que la liberada por SLA, y quien recupera no es necesariamente quien
   * reasigna; el flag evita que se pierda en el backlog. Por estar dentro de la guarda por
   * `estatus_id = devuelta`, una orden que ya salio de `devuelta` (count 0) NO se toca (R3).
   */
  async recuperarABodega(input: RecuperarABodegaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusDevueltaId, // R16/R21: guarda de idempotencia/carrera
          deletedAt: null,
        },
        data: {
          estatusId: input.destinoEstatusId, // R13 (destino ya resuelto por el service)
          mensajeroAsignadoId: null, // R14: handoff limpio a la bodega (nuevo intento)
          asignadoAt: null, // R14: limpia el timestamp de asignacion
          prioridad: true, // feature 110/R2: recuperada a bodega -> reasignacion prioritaria
        },
      });
      // R16/R21: SOLO si transiciono (count 1); una re-corrida/carrera (count 0) no duplica.
      if (result.count > 0) {
        await appendCambioEstado(tx, [
          {
            ordenId: input.ordenId,
            estatusOrigenId: input.estatusDevueltaId, // origen `devuelta` (fijado por la guarda)
            estatusDestinoId: input.destinoEstatusId,
            actorUsuarioId: input.actorUsuarioId, // R17: el admin que ejecuta (auditoria)
            origenTipo: "recuperacion_manual", // R17
          },
        ]);
      }
      return result.count > 0;
    });
  }
}
