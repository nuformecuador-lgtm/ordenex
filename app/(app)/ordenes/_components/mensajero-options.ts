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
// `bloqueadosIds` (pedido admin_satelite): cierre abierto.
// `noElegibles` (feature 157, regla de dedicación): motivo por mensajero — repartir y
// recolectar son viajes incompatibles, así que cada modal pasa el suyo. El cierre gana
// sobre la dedicación: es la condición que hay que resolver primero.
export function toMensajeroOptions(
  mensajeros: MensajeroLiteDTO[],
  bloqueadosIds?: Set<string>,
  noElegibles?: ReadonlyMap<string, string>,
): SelectOption[] {
  return mensajeros.map((m) => {
    const porCierre = bloqueadosIds?.has(m.id) ?? false;
    const motivo = porCierre ? "cierre abierto" : noElegibles?.get(m.id);
    return {
      value: m.id,
      label: motivo ? `${m.nombre} (${motivo})` : m.nombre,
      disabled: motivo !== undefined,
    };
  });
}
