import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";

import { KpisMensajero } from "./_components/KpisMensajero";
import { MisAsignacionesModule } from "./_components/MisAsignacionesModule";

/**
 * Feature 36 (T14, R9/R12): módulo "Mis asignaciones" del rol `mensajero`. El rol
 * se resuelve SOLO server-side vía `resolveActorFromSession` (patrón feature
 * 17/26): cualquier rol distinto de `mensajero` (o sin sesión) NO ve el módulo
 * (`notFound`, defensa real). Pre-fetch de las asignaciones por la Server Action
 * y paso de datos a los componentes cliente por props (datos sensibles: el
 * padre valida permisos).
 */
export default async function MisAsignacionesPage() {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "mensajero") notFound(); // R9/R12

  // Feature 92 (R28/R30): `porGestionar` llega YA ORDENADO por la secuencia
  // optimizada (posición asc; las sin posición al final) y `ruta` trae el estado
  // de esa ruta. Los resuelve el service SERVER-SIDE: ni esta página ni el
  // módulo reordenan nada ni derivan el estado de la ruta por su cuenta.
  const result = await listarMisAsignaciones();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  return (
    <AppPage
      title="Mis asignaciones"
      description="Órdenes por recoger y en reparto"
    >
      {/* Feature 61: KPIs del portal del mensajero sobre la lista de asignaciones. */}
      <KpisMensajero kpis={result.kpis} />
      <MisAsignacionesModule
        porRecoger={result.porRecoger}
        porGestionar={result.porGestionar}
        ordenEnGestionId={result.ordenEnGestionId}
        ruta={result.ruta}
      />
    </AppPage>
  );
}
