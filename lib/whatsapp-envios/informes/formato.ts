// Ficha 474 — fecha y hora de PARED de Costa Rica tal como las leen los informes («05/10/2026»,
// «05:00»). Sin aritmetica horaria propia: se delega en `fecha-cr` y `hora-cr`.
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { horaCostaRica } from "@/lib/utils/hora-cr";

/** `DD/MM/YYYY` del dia calendario CR de `instante`. */
export function fechaCRLegible(instante: Date): string {
  const [anio, mes, dia] = fechaCalendarioCR(instante).split("-");
  return `${dia}/${mes}/${anio}`;
}

/** `HH:mm` de pared CR de `instante`. */
export function horaCRLegible(instante: Date): string {
  return horaCostaRica(instante.toISOString());
}
