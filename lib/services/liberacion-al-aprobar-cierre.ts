// FICHA 315 — EL TIMBRE QUE FALTABA: aprobar un cierre libera, en el acto, las ordenes
// reprogramadas de ESE cierre cuya fecha ya vencio.
//
// POR QUE ESTE ARCHIVO EXISTE Y NO SE LLAMA AL SERVICIO DIRECTAMENTE DESDE `CierresAdminService`:
// aquel es logica de negocio de los cierres y no tiene por que conocer ni el reloj (`hoyCR`) ni el
// contrato de la liberacion. Aqui se resuelven las dos cosas —la fecha CR de hoy y la llamada— y se
// entrega al servicio de cierres UNA funcion de una linea de firma, con DEFAULT NO-OP. Mismo patron
// (y mismo motivo) que `MensajeroBloqueadoNotificador` en ese mismo constructor: trece suites
// instancian `CierresAdminService` contra una base local COMPARTIDA, y con el camino real por
// defecto cualquiera de ellas moveria ordenes de verdad.
//
// EL FALLO NO PROPAGA, PERO NUNCA ES MUDO. La aprobacion de un cierre ya emitio dinero y confirmo su
// transaccion antes de que esto corra; revertirla porque una orden no pudo cambiar de estado seria
// cambiar un retraso por una perdida contable. Y se puede absorber sin drama porque la red sigue
// puesta: la corrida de las 00:00 CR (`ejecutarLiberacion`) recoge lo que quede.
import type { ILiberacionReprogramadaService } from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import type { LiberacionLogger } from "@/lib/services/LiberacionReprogramadaService";
import { startOfDayCR } from "@/lib/utils/fecha-cr";

/**
 * Firma que ve `CierresAdminService`: «este cierre quedo aprobado». Ni fecha, ni contadores, ni
 * promesa de exito — el resultado de la liberacion no cambia nada de la aprobacion.
 */
export type LiberarAlAprobarCierre = (cierreId: string) => Promise<void>;

/**
 * DEFAULT del constructor: no hace nada. Un `CierresAdminService` construido sin cablear esto
 * —tipicamente un doble de test— no mueve ni una orden.
 */
export const liberarAlAprobarCierreNoOp: LiberarAlAprobarCierre = async () => {};

/** Prefijo de los avisos de este camino, alineado con `ETIQUETA_CIERRE` del servicio. */
const ETIQUETA = "liberar-al-aprobar-cierre";

const defaultLogger: LiberacionLogger = { warn: (m) => console.warn(m) };

/**
 * El camino REAL, con sus dependencias inyectadas. Es la funcion que cablea el composition root
 * (`lib/actions/cierres-admin.ts`) y la MISMA que ejercitan los tests, solo que con dobles.
 *
 * `now` es inyectable para que la fecha CR sea determinista en las pruebas; en produccion es el
 * reloj. `startOfDayCR` es la MISMA conversion que usa el handler del cron (90/R22): si aqui se
 * usara `new Date()` a secas, una orden con `fecha_reprogramacion` de HOY quedaria fuera durante
 * las horas de la manana, porque esa columna es `@db.Date` a medianoche.
 *
 * El aviso NO lleva el id del cierre ni el de ninguna orden: mismo criterio sin PII que el resto de
 * los logs de la liberacion (R19/R38). Lleva la causa por `cause`, que es donde vive el detalle.
 */
export function liberarAlAprobarCierreCon(
  service: Pick<ILiberacionReprogramadaService, "liberarPorCierreAprobado">,
  now: () => Date = () => new Date(),
  logger: LiberacionLogger = defaultLogger,
): LiberarAlAprobarCierre {
  return async (cierreId) => {
    try {
      await service.liberarPorCierreAprobado(cierreId, startOfDayCR(now()));
    } catch (error) {
      // No es un `catch` vacio (docs/conventions.md): se registra con su causa. Lo que no se hace
      // es propagarlo, porque la aprobacion ya termino y la corrida de medianoche es la red.
      logger.warn(
        `[${ETIQUETA}] la liberacion tras aprobar fallo; queda para la corrida de las 00:00 CR: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
