import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarArbolGeografico } from "@/lib/actions/geografia";
import { listarVehiculos } from "@/lib/actions/vehiculos";
import { listarZonas } from "@/lib/actions/zonas";

import { DescargarCoberturaButton } from "./_components/DescargarCoberturaButton";
import { ZonasTarifasModule } from "./_components/ZonasTarifasModule";

/**
 * Página de Tarifas (Server Component). Autoriza server-side igual que
 * `/configuracion`: SOLO el rol `maestro`. Pre-carga el catálogo geográfico, el
 * de vehículos y el listado de zonas, y los pasa al módulo cliente de "Costos
 * por zona" (lista con editar/eliminar + formulario de crear/editar).
 *
 * Ficha 465 (R1) — bloque «Cobertura» con la descarga del Excel de cobertura por distrito. Solo
 * llega aquí el maestro; la action vuelve a autorizar por su cuenta (R2/R3).
 */
export default async function TarifasPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <AppPage title="Tarifas">
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </AppPage>
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
    <AppPage title="Tarifas">
      {arbolRes.status !== "ok" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar el catálogo geográfico.
        </p>
      ) : null}

      <section
        aria-labelledby="tarifas-cobertura-titulo"
        className="flex flex-col gap-2"
      >
        <h2 id="tarifas-cobertura-titulo" className="text-base font-semibold">
          Cobertura
        </h2>
        <DescargarCoberturaButton />
      </section>

      <ZonasTarifasModule
        initialZonas={zonas}
        provincias={provincias}
        vehiculos={vehiculos}
      />
    </AppPage>
  );
}
