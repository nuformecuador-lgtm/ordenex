import type { SelectOption } from "@/components/ui/select";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T18/T19) — traduce la lista de mensajeros del loader
// `listarMensajerosParaAsignacion` (R28, TODOS los mensajeros, SIN filtro de
// zona) a las opciones del `Select` compartido. Reutilizado por
// `GenerarGuiaModal` y `AsignarBodegaModal`.
export function toMensajeroOptions(
  mensajeros: MensajeroLiteDTO[],
): SelectOption[] {
  return mensajeros.map((m) => ({ value: m.id, label: m.nombre }));
}
