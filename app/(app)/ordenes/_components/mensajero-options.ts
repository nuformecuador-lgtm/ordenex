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
// Pedido humano 2026-08-18 — SE RETIRA el deshabilitado por CIERRE ABIERTO (antes el primer
// parámetro era un `bloqueadosIds` que ganaba sobre todo lo demás). El servicio ya no rechaza
// a un mensajero por arrastrar un cierre abierto o vencido, y un selector que lo siguiera
// deshabilitando prohibiría en la UI algo que el servidor acepta — que es peor que no avisar:
// no hay forma de descubrir que la regla ya no existe.
//
// `noElegibles` (feature 157, regla de dedicación) SIGUE: repartir y recolectar son viajes
// incompatibles y el service SIGUE rechazándolo, así que cada modal pasa el suyo.
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
