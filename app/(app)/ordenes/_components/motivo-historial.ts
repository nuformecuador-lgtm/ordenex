import { ESTADO_RETIRADO, nombreDeEstado } from "@/lib/types/order-status";

// FICHA 455 (2026-09-24, recorrido T3.2 F10) — el MOTIVO de una transición, tal como se presenta.
//
// Las migraciones que retiraron estados escribieron su motivo como texto técnico, con el código crudo
// dentro («migracion 454: retiro de <codigo>», y lo mismo la 155). Las migraciones NO se editan (son
// historia aplicada), y la fila tampoco se reescribe:
// se traduce AL PINTARLA, como un snapshot (R23). El estado retirado se nombra con el formato de R11
// («<nombre histórico> (estado retirado)»), leído de la fuente única. Cualquier otro motivo sale tal cual.

const MOTIVO_RETIRO_MIGRACION = /^migracion \d+: retiro de ([a-z_]+)$/;

/** El motivo que ve la persona; `null`/vacío se queda igual (el componente no pinta la línea). */
export function motivoVisible(motivo: string | null | undefined): string | null | undefined {
  if (!motivo) return motivo;
  const m = MOTIVO_RETIRO_MIGRACION.exec(motivo);
  if (m === null || !Object.hasOwn(ESTADO_RETIRADO, m[1])) return motivo;
  return `Migración: retiro de ${nombreDeEstado(m[1])}`;
}
