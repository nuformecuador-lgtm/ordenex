import { PageHeader } from "@/components/shared/PageHeader";
import { Container } from "@/components/shared/Container";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarArbolGeografico } from "@/lib/actions/geografia";
import { listarVehiculos } from "@/lib/actions/vehiculos";
import { listarZonas } from "@/lib/actions/zonas";

import { ZonasTarifasModule } from "./_components/ZonasTarifasModule";

/**
 * Página de Tarifas (Server Component). Autoriza server-side igual que
 * `/configuracion`: SOLO el rol `maestro`. Pre-carga el catálogo geográfico, el
 * de vehículos y el listado de zonas, y los pasa al módulo cliente de "Costos
 * por zona" (lista con editar/eliminar + formulario de crear/editar).
 */
export default async function TarifasPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <>
        <PageHeader title="Tarifas" />
        <Container>
          <p role="alert" className="text-sm text-muted-foreground">
            No tienes permiso para acceder a esta sección.
          </p>
        </Container>
      </>
    );
  }

  const [arbolRes, vehiculosRes, zonasRes] = await Promise.all([
    listarArbolGeografico(),
    listarVehiculos(),
    listarZonas({ page: 1, pageSize: 100 }),
  ]);

  const provincias = arbolRes.status === "ok" ? arbolRes.provincias : [];
  const vehiculos = vehiculosRes.status === "ok" ? vehiculosRes.items : [];
  const zonas = zonasRes.status === "ok" ? zonasRes.items : [];

  return (
    <>
      <PageHeader title="Tarifas" />
      <Container>
        {arbolRes.status !== "ok" ? (
          <p role="alert" className="text-sm text-muted-foreground">
            No se pudo cargar el catálogo geográfico.
          </p>
        ) : null}

        <ZonasTarifasModule
          initialZonas={zonas}
          provincias={provincias}
          vehiculos={vehiculos}
        />
      </Container>
    </>
  );
}
