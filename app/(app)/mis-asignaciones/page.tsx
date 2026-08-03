import { redirect } from "next/navigation";

/**
 * 2026-07-31 (decisión del humano): el portal del mensajero se partió en dos pantallas
 * hermanas —`/mis-asignaciones/reparto` y `/mis-asignaciones/recoger`— con un subítem de
 * menú cada una. Esta ruta deja de renderizar nada y se convierte en un REDIRECT a
 * Reparto, que es la pantalla donde el mensajero pasa el turno.
 *
 * No se borra: `/mis-asignaciones` está en enlaces viejos, en el historial de los
 * navegadores de la calle y en la PWA ya instalada. Borrarla daría 404 a quien la tuviera
 * guardada. El gate de rol no se repite aquí (`redirect` no expone nada): lo aplica la
 * página de destino, server-side, como siempre.
 */
export default function MisAsignacionesPage() {
  redirect("/mis-asignaciones/reparto");
}
