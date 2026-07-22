import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarCierreDia, estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";

import { CierreDiaModule } from "./_components/CierreDiaModule";

/**
 * Feature 37 (T14, R1): módulo "Cierre del día" del rol `mensajero`. El rol se
 * resuelve SOLO server-side vía `resolveActorFromSession` (patrón feature 36):
 * cualquier rol distinto de `mensajero` (o sin sesión) NO ve el módulo
 * (`notFound`, defensa real). Pre-fetch del detalle+totales por la Server Action
 * y paso de los datos a los componentes cliente por props (datos sensibles: el
 * padre valida permisos).
 */
export default async function CierreDiaPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "mensajero") notFound(); // R1

  const result = await listarCierreDia();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  // Feature 41 (R21): flag DERIVADO server-side de si el mensajero está bloqueado
  // (cierre `solicitado`/`vencido` pendiente) para recibir nuevas asignaciones. Se
  // pasa por props al componente cliente, que muestra el aviso accionable. Si la
  // acción degrada (unauthenticated), no se muestra el aviso (defensa suave).
  const bloqueo = await estadoBloqueoMensajero();
  const bloqueado = bloqueo.status === "ok" && bloqueo.bloqueado;

  return (
    <AppPage
      title="Cierre del día"
      description="Detalle de lo gestionado, totales por método de pago y solicitud de cierre"
    >
      <CierreDiaModule
        grupos={result.grupos}
        totales={result.totales}
        totalPagoMensajero={result.totalPagoMensajero}
        puedesSolicitar={result.puedesSolicitar}
        motivoBloqueo={result.motivoBloqueo}
        cierresPasados={result.cierresPasados}
        bloqueado={bloqueado}
        // Feature 111/R13: habilita el CTA diferenciado del cierre vencido (derivado
        // server-side de `cierresPasados`; `undefined` en cierres pre-migración → false).
        tieneVencido={result.tieneVencido ?? false}
      />
    </AppPage>
  );
}
