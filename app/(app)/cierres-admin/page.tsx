import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarCierresAdmin } from "@/lib/actions/cierres-admin";

import { CierresAdminModule } from "./_components/CierresAdminModule";

/**
 * Feature 38 (T12, R1/R3): módulo "Cierres del día" del admin de bodega. El rol se
 * resuelve SOLO server-side vía `resolveActorFromSession` (patrón features 33/36/37):
 * cualquier rol distinto de `maestro`/`adminSatelite` (o sin sesión) NO ve el módulo
 * (`notFound`, defensa real). Pre-fetch de pendientes+histórico por la Server Action
 * y paso de los datos a los componentes cliente por props (datos sensibles: el padre
 * valida permisos). Si el adminSatelite no tiene zona, `sinZona` (R3) lo maneja el
 * módulo con un aviso accionable, sin exponer tablas de acción.
 */
export default async function CierresAdminPage() {
  const actor = await resolveActorFromSession();
  if (!actor || (actor.rol !== "maestro" && actor.rol !== "adminSatelite")) {
    notFound(); // R1
  }

  const result = await listarCierresAdmin();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Cierres del día"
        description="Revisá el detalle de cada cierre solicitado por tus mensajeros y aprobalo o rechazalo"
      />
      <CierresAdminModule
        pendientes={result.pendientes}
        historico={result.historico}
        sinZona={result.sinZona}
      />
    </section>
  );
}
