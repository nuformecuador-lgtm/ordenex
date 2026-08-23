import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

import { KpisMensajero } from "../_components/KpisMensajero";
import { RepartoModule } from "../_components/RepartoModule";

/**
 * Feature 36 (T14, R9/R12) — pantalla de REPARTO del rol `mensajero`, mitad del portal
 * que hasta 2026-07-31 vivía junto con "Por recoger" en `/mis-asignaciones`. Conserva
 * TODO lo que ya tenía ese apartado: KPIs, ruta/mapa, panel de gestión, modo foco,
 * buscador, filtro cantón/distrito y el conmutador mosaico/detalle.
 *
 * El rol se resuelve SOLO server-side vía `resolveActorFromSession` (patrón feature
 * 17/26): cualquier rol distinto de `mensajero` (o sin sesión) NO ve el módulo
 * (`notFound`, defensa real). Pre-fetch por Server Action y paso por props (datos
 * sensibles: el padre valida permisos).
 */
export default async function RepartoPage() {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "mensajero") notFound(); // R9/R12

  // Feature 92 (R28/R30): `porGestionar` llega YA ORDENADO por la secuencia
  // optimizada (posición asc; las sin posición al final) y `ruta` trae el estado
  // de esa ruta. Los resuelve el service SERVER-SIDE: ni esta página ni el
  // módulo reordenan nada ni derivan el estado de la ruta por su cuenta.
  const result = await listarMisAsignaciones();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  // Feature 111/R12/R14 -> FEATURE 271: el DETALLE del bloqueo, DERIVADO server-side por la
  // regla N/V (libre si arrastra un cierre a lo sumo y ninguno espera a que él lo reenvíe). El
  // bloqueo es TOTAL —gestionar, cobrar y recibir trabajo nuevo—: el módulo muestra el aviso, que
  // dice cuántos cierres arrastra y cuál toca primero, y desactiva los controles de
  // gestionar/escoger (defensa suave; el backend R25 es la defensa real).
  //
  // Si la acción degrada (sin sesión), baja `SIN_BLOQUEO` y no se bloquea nada: un fallo de
  // LECTURA no puede dejar al mensajero sin trabajar, y la escritura la sigue gateando el
  // servidor.
  const estado = await estadoBloqueoMensajero();
  const bloqueo = estado.status === "ok" ? estado.bloqueo : SIN_BLOQUEO;

  return (
    <AppPage title="Reparto" description="Órdenes en reparto por gestionar">
      {/* Feature 61: KPIs del portal del mensajero sobre la lista de asignaciones. Viven
          en Reparto y no en "Por recoger" (decisión del humano): resumen el turno, y el
          turno se trabaja aquí. */}
      <KpisMensajero kpis={result.kpis} />
      <RepartoModule
        porGestionar={result.porGestionar}
        // Feature 235 (R18): la tercera lista llega YA SEPARADA del servidor; el módulo no vuelve
        // a decidir el corte.
        conAyuda={result.conAyuda}
        ordenEnGestionId={result.ordenEnGestionId}
        ruta={result.ruta}
        bloqueo={bloqueo}
      />
    </AppPage>
  );
}
