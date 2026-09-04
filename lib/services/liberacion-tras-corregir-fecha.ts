// FICHA 371 — EL TIMBRE DE LA CORRECCIÓN: corregir la fecha a HOY suelta la orden en el acto, sin
// esperar al cron de medianoche.
//
// POR QUÉ ESTE ARCHIVO EXISTE Y NO SE LLAMA AL SERVICIO DIRECTAMENTE DESDE
// `CorreccionFechaReprogramacionService`: aquel es lógica de negocio de la corrección y no tiene por
// qué conocer ni el reloj (`hoyCR`) ni el contrato de la liberación. Aquí se resuelven las dos cosas
// —la fecha CR de hoy y la llamada— y se entrega al servicio de la corrección UNA función de una
// línea de firma, con DEFAULT NO-OP. Mismo patrón (y mismo motivo) que
// `lib/services/liberacion-al-aprobar-cierre.ts`, que hace exactamente esto para la aprobación de un
// cierre: una suite que instancie el servicio con dobles no puede mover órdenes de verdad.
//
// ⚠️ UNA DIFERENCIA CON EL DE LA 315, Y ES LA IMPORTANTE: allí el resultado se tira (la aprobación
// del cierre no cambia por lo que pase con la liberación). AQUÍ EL RESULTADO ES PARTE DE LA
// RESPUESTA: la pantalla tiene que poder decir si la orden quedó liberada o si sigue esperando la
// aprobación de su cierre. Por eso esta función devuelve el desenlace y no `void`.
//
// EL FALLO NO PROPAGA, PERO NUNCA ES MUDO. La corrección ya está escrita y confirmada cuando esto
// corre; revertirla porque una orden no pudo cambiar de estado sería perder el arreglo que el
// coordinador acaba de hacer. Y se puede absorber sin drama porque la red sigue puesta: la corrida
// de las 00:00 CR (`ejecutarLiberacion`) recoge lo que quede.
import type { ILiberacionReprogramadaService } from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import type { DesenlaceLiberacion } from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";
import type { LiberacionLogger } from "@/lib/services/LiberacionReprogramadaService";
import { startOfDayCR } from "@/lib/utils/fecha-cr";

/** Firma que ve `CorreccionFechaReprogramacionService`: «esta orden acaba de quedar corregida». */
export type LiberarTrasCorregirFecha = (ordenId: string) => Promise<DesenlaceLiberacion>;

/**
 * DEFAULT del constructor: no libera nada y lo dice. Un servicio construido sin cablear esto
 * —típicamente un doble de test— no mueve ni una orden, y el desenlace que devuelve es el honesto:
 * «no se liberó ahora».
 */
export const liberarTrasCorregirFechaNoOp: LiberarTrasCorregirFecha = async () => "espera_fecha";

/** Prefijo de los avisos de este camino, alineado con `ETIQUETA_CORRECCION` del servicio. */
const ETIQUETA = "liberar-tras-corregir-fecha";

const defaultLogger: LiberacionLogger = { warn: (m) => console.warn(m) };

/**
 * El camino REAL, con sus dependencias inyectadas. Es la función que cablea el composition root
 * (`lib/actions/corregir-fecha-reprogramacion.ts`) y la MISMA que ejercitan los tests, sólo que con
 * dobles.
 *
 * `now` es inyectable para que la fecha CR sea determinista en las pruebas; en producción es el
 * reloj. `startOfDayCR` es la MISMA conversión que usan el cron (90/R22) y el camino del cierre
 * (315): si aquí se usara `new Date()` a secas, una orden corregida a HOY quedaría fuera durante las
 * horas de la mañana, porque `fecha_reprogramacion` es `@db.Date` a medianoche.
 *
 * ⚠️ LA TRADUCCIÓN DE LOS CONTADORES AL DESENLACE VIVE AQUÍ, en un solo sitio y con su motivo:
 *   · `liberadas >= 1`      → `liberada`. La orden volvió a bodega en esta misma llamada.
 *   · `esperandoCierre >= 1`→ `espera_cierre`. La puerta de la 276 la retuvo: su gestión nace de una
 *                             visita real y su cierre no está aprobado.
 *   · resto                 → `espera_fecha`. Cubre el caso normal (se corrigió a un día futuro, así
 *                             que ni siquiera es candidata) y el residual de una carrera u `omitida`
 *                             —donde lo único cierto es que la orden no salió AHORA, y la corrida de
 *                             medianoche es la red—. Se resuelve por lo que la base dice, no por lo
 *                             que el llamador supone.
 */
export function liberarTrasCorregirFechaCon(
  service: Pick<ILiberacionReprogramadaService, "liberarOrdenCorregida">,
  now: () => Date = () => new Date(),
  logger: LiberacionLogger = defaultLogger,
): LiberarTrasCorregirFecha {
  return async (ordenId) => {
    try {
      const resultado = await service.liberarOrdenCorregida(ordenId, startOfDayCR(now()));
      if ((resultado.liberadas ?? 0) >= 1) return "liberada";
      if ((resultado.esperandoCierre ?? 0) >= 1) return "espera_cierre";
      return "espera_fecha";
    } catch (error) {
      // No es un `catch` vacío (docs/conventions.md): se registra con su causa. Lo que no se hace es
      // propagarlo, porque la corrección ya está escrita y la corrida de medianoche es la red. El
      // aviso NO lleva el id de la orden: mismo criterio sin PII que el resto de los logs de la
      // liberación (R19/R38).
      logger.warn(
        `[${ETIQUETA}] la liberacion tras corregir fallo; queda para la corrida de las 00:00 CR: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return "espera_fecha";
    }
  };
}
