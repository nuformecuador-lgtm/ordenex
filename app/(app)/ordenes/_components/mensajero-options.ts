import type { SelectOption } from "@/components/ui/select";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T18/T19) — traduce la lista de mensajeros del loader
// `listarMensajerosParaAsignacion` (R28, TODOS los mensajeros, SIN filtro de
// zona) a las opciones del `Select` compartido.
//
// Feature 156/R30: `GenerarGuiaModal` dejó de consumirlo (generar guía ya no asigna
// mensajero). Su único consumidor en este directorio es `AsignarBodegaModal`.
//
// Un mensajero NO elegible se muestra deshabilitado y con el motivo entre paréntesis, en
// vez de desaparecer: el maestro sabe que existe y por qué no puede elegirlo ahora.
//
// ⚠️ FEATURE 271 (2026-08-23) — EL BLOQUEO POR CIERRES VUELVE, Y ESTE COMENTARIO DECÍA LO
// CONTRARIO. El 2026-08-18 se retiró el deshabilitado por cierre abierto porque el servicio había
// dejado de rechazarlo, y dejarlo habría prohibido en la UI algo que el servidor aceptaba. Desde
// la 271 el servidor SÍ lo rechaza otra vez —acumular dos cierres, o arrastrar uno que espera a
// que el mensajero lo reenvíe, bloquea también recibir trabajo nuevo—, así que la dirección del
// error se ha dado la vuelta: no marcarlos deja elegir a quien el servidor va a negar, que es
// exactamente el incidente del 18/08 al revés.
//
// CÓMO ENTRA AHORA, y por qué no vuelve a ser un parámetro propio: entra por `noElegibles`, el
// MISMO mapa que la regla de dedicación. Un selector no necesita saber cuántas reglas lo dejan
// fuera; necesita saber si puede elegirlo y por qué no. Cada modal compone su mapa con los
// motivos que le aplican, y el conjunto de bloqueados por cierres viene del servidor sin
// re-derivarse (R32: ni uno más, ni uno menos que los que va a rechazar).
/**
 * FEATURE 271 (T9.4/T9.5, R32/R46) — el motivo, en LENGUAJE CLARO y en un solo sitio: lo comparten
 * los TRES selectores de asignación (reparto central, reparto satélite y recolección) para que
 * digan lo mismo, y para que quien lo lea sepa qué tiene que pasar para poder elegirlo.
 *
 * No nombra estados del sistema («vencido», «solicitado») ni cuenta cierres: va entre paréntesis
 * en la opción de un desplegable, y ahí no cabe un párrafo. Quien tiene que leer el detalle
 * completo —cuántos arrastra y cuál toca primero— es el MENSAJERO, en su portal.
 */
export const MOTIVO_BLOQUEADO_POR_CIERRE = "tiene cierres sin resolver";

export function toMensajeroOptions(
  mensajeros: MensajeroLiteDTO[],
  noElegibles?: ReadonlyMap<string, string>,
): SelectOption[] {
  return mensajeros.map((m) => {
    const motivo = noElegibles?.get(m.id);
    return {
      value: m.id,
      label: motivo ? `${m.nombre} (${motivo})` : m.nombre,
      disabled: motivo !== undefined,
    };
  });
}
