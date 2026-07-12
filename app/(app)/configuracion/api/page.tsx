import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

/**
 * Página de API (Server Component). Autoriza server-side igual que
 * `/configuracion`: SOLO el rol `maestro`. Placeholder hasta que la gestión de
 * credenciales/integraciones de API se implemente.
 */
export default async function ApiPage() {
  const actor = await resolveActorFromSession();

  if (actor?.rol !== "maestro") {
    return (
      <>
        <PageHeader title="API" />
        <p role="alert" className="text-sm text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </>
    );
  }

  return (
      <PageHeader
        title="API"
        description="Credenciales e integraciones de API"
      />
  );
}
