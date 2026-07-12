import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";

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
  if (!actor || actor.rol !== "mensajero") notFound(); // R9/R12

  const result = await listarMisAsignaciones();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  return (
    <>
      <PageHeader
        title="Mis asignaciones"
        description="Órdenes por recoger y en reparto"
      />
      <MisAsignacionesModule
        porRecoger={result.porRecoger}
        porGestionar={result.porGestionar}
        ordenEnGestionId={result.ordenEnGestionId}
      />
    </>
  );
}
