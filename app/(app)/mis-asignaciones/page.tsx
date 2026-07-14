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
  console.log("xyz")

  const result = await listarMisAsignaciones();
  console.log("xyz 1", result)
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  console.log("xyz 2")
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
      />
    </section>
  );
}
