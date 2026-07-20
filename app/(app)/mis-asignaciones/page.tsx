import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
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

  const result = await listarMisAsignaciones();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Mis asignaciones"
        description="Órdenes por recoger y en reparto"
      />
      {/* Feature 61: KPIs del portal del mensajero sobre la lista de asignaciones. */}
      <KpisMensajero kpis={result.kpis} />
      <MisAsignacionesModule
        porRecoger={result.porRecoger}
        porGestionar={result.porGestionar}
        ordenEnGestionId={result.ordenEnGestionId}
        /* Feature 93 (R30/R31): estado de la ruta y rol resueltos SERVER-SIDE y
           bajados por props; el módulo no fetchea nada del cliente. */
        ruta={result.ruta}
        rol={actor.rol}
      />
    </section>
  );
}
