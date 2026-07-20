import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";
import { decorarMisAsignacionesSimulado } from "@/lib/actions/_ruta-mensajero-simulado";

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

  const resultReal = await listarMisAsignaciones();
  if (resultReal.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  // TODO(92): quitar junto con `_ruta-mensajero-simulado.ts`.
  // El reordenado de las cards y el `ruta` de R30 son SERVER-SIDE (§6.1): los
  // resuelve el service. Mientras la 92 no exista, el decorador simulado ocupa
  // ESE MISMO seam —aquí, en el Server Component— para poder recorrer el flujo a
  // mano. Apagado por defecto: sin `RUTA_SIMULADA=1` devuelve el resultado
  // intacto. `MisAsignacionesModule` no ordena nada, ni con el flag ni sin él.
  const result = decorarMisAsignacionesSimulado(resultReal);

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
