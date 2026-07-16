import type { SelectOption } from "@/components/ui/select";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T18/T19) — traduce la lista de mensajeros del loader
// `listarMensajerosParaAsignacion` (R28, TODOS los mensajeros, SIN filtro de
// zona) a las opciones del `Select` compartido. Reutilizado por
// `GenerarGuiaModal` y `AsignarBodegaModal`.
//
// `bloqueadosIds` (opcional, pedido admin_satelite): mensajeros con un cierre abierto.
// Se muestran deshabilitados y con un sufijo aclaratorio para que no se puedan asignar,
// permitiendo seguir asignando a los demás.
export function toMensajeroOptions(
  mensajeros: MensajeroLiteDTO[],
  bloqueadosIds?: Set<string>,
): SelectOption[] {
  return mensajeros.map((m) => {
    const bloqueado = bloqueadosIds?.has(m.id) ?? false;
    return {
      value: m.id,
      label: bloqueado ? `${m.nombre} (cierre abierto)` : m.nombre,
      disabled: bloqueado,
    };
  });
}
