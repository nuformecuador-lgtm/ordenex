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

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * «Lunes 5 de octubre de 2026», del dia calendario de Costa Rica. Tablas fijas, sin `Intl`
 * (determinista). Nacio en el PDF de transito (475); la 476 la comparte.
 */
export function fechaLargaCR(instante: Date): string {
  const [anio, mes, dia] = fechaCalendarioCR(instante).split("-").map((n) => Number.parseInt(n, 10));
  const semana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return `${DIAS_SEMANA[semana]} ${dia} de ${MESES[mes - 1]} de ${anio}`;
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «5 oct 2026», del dia calendario de Costa Rica (pie del PDF de picking, 476). */
export function fechaCortaCR(instante: Date): string {
  const [anio, mes, dia] = fechaCalendarioCR(instante).split("-").map((n) => Number.parseInt(n, 10));
  return `${dia} ${MESES_CORTOS[mes - 1]} ${anio}`;
}
