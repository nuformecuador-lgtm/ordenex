import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarVehiculos } from "@/lib/actions/vehiculos";

import { VehiculosModule } from "./_components/VehiculosModule";

/**
 * Página del catálogo de vehículos (Server Component). Autoriza server-side igual
 * que el resto de `/configuracion`: SOLO el rol `maestro`. Pre-carga el catálogo y
 * se lo pasa al módulo cliente, que hace el CRUD.
 */
export default async function VehiculosPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Vehículos">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
    );
  }

  const res = await listarVehiculos();
  const vehiculos = res.status === "ok" ? res.items : [];

  return (
    <AppPage title="Vehículos">
      {res.status !== "ok" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el catálogo de vehículos.
        </p>
      ) : null}

      <VehiculosModule initialVehiculos={vehiculos} />
    </AppPage>
  );
}
