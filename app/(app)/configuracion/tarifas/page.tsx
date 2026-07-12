import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

/**
 * Página de tarifas (Server Component). Autoriza server-side igual que
 * `/configuracion`: SOLO el rol `maestro`. Placeholder hasta que la gestión de
 * tarifas por zona se implemente.
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

  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Tarifas"
        description="Gestión de tarifas y cobros por zona"
      />
    </section>
  );
}
