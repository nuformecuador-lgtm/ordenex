import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarArbolGeografico } from "@/lib/actions/geografia";
import { listarVehiculos } from "@/lib/actions/vehiculos";

import { GeografiaSelector } from "./_components/GeografiaSelector";
import { CobroVehiculoTarifas } from "./_components/CobroVehiculoTarifas";

/**
 * Página de Tarifas (Server Component). Autoriza server-side igual que
 * `/configuracion`: SOLO el rol `maestro`. Aquí se gestionarán las zonas.
 * Pre-carga en el servidor el catálogo geográfico global (provincia → cantón →
 * distrito) y el catálogo de vehículos, y los pasa a los componentes cliente:
 * el selector geográfico (accordion) y la configuración de cobro por vehículo.
 */
export default async function TarifasPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <section className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader title="Tarifas" />
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </section>
    );
  }

  const [arbolRes, vehiculosRes] = await Promise.all([
    listarArbolGeografico(),
    listarVehiculos(),
  ]);

  const provincias = arbolRes.status === "ok" ? arbolRes.provincias : [];
  const vehiculos = vehiculosRes.status === "ok" ? vehiculosRes.items : [];

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Tarifas"
        description="Gestión de zonas: selecciona provincias, cantones y distritos"
      />
      {arbolRes.status === "ok" ? (
        <GeografiaSelector provincias={provincias} />
      ) : (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el catálogo geográfico.
        </p>
      )}

      <CobroVehiculoTarifas vehiculos={vehiculos} />
    </section>
  );
}
