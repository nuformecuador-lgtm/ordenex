// Hora de pared de Costa Rica («HH:mm») de un instante ISO.
//
// Nacio en el tablero operativo (feature 131, `app/(app)/analitica/_components/operativo/textos.ts`,
// que la sigue re-exportando) y se muda aqui en la 458-A (revision m2): la leen tambien un servicio
// (`FiltrosWalletService`, la hora del rotulo de un cierre) y `/mi-wallet`, y un servicio de `lib/`
// no importa de `app/**/_components`. Modulo PURO: solo `Intl`.

/**
 * Se delega en `Intl` con `timeZone`: cero aritmetica horaria propia (la parte de calendario la
 * resuelve `fechaCalendarioCR`, que es la unica pieza del repo que sabe del desfase).
 */
const HORA_CR = new Intl.DateTimeFormat("es-CR", {
  timeZone: "America/Costa_Rica",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** «HH:mm» de Costa Rica; `""` si el instante no es una fecha valida. */
export function horaCostaRica(corteAt: string): string {
  const instante = new Date(corteAt);
  if (Number.isNaN(instante.getTime())) return "";
  return HORA_CR.format(instante);
}
