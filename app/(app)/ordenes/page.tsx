import { RolValue } from "@prisma/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { Container } from "@/components/shared/Container";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { OrdenesModule } from "./_components/OrdenesModule";
import { OrdenesRevisionMaestro } from "./_components/OrdenesRevisionMaestro";

/**
 * Feature 17 (R15/R16, design.md §4): el rol se resuelve SOLO server-side vía
 * `resolveActorFromSession` (patrón `app/(app)/page.tsx`, feature 23/26).
 * `maestro`/`admin` ven la vista de revisión con los 4 apartados por estado;
 * `admin` en solo-lectura (R12-UI, sin checkboxes ni botones). Cualquier otro
 * rol (incl. `adminTienda`, `mensajero`) conserva el listado plano previo
 * (feature 6/7/8), SIN regresión.
 */
export default async function OrdenesPage() {
  const actor = await resolveActorFromSession();
  const puedeCargarMasiva = actor?.rol === RolValue.adminTienda;
  const esMaestroOAdmin = actor?.rol === "maestro" || actor?.rol === "admin";

  return (
      <>
        <PageHeader title="Órdenes" description="Listado y gestión de órdenes" />
        <Container>
          {esMaestroOAdmin ? (
            <OrdenesRevisionMaestro readOnly={actor?.rol === "admin"} />
          ) : (
            <OrdenesModule puedeCargarMasiva={puedeCargarMasiva} />
          )}
        </Container>
      </>
    );
  }
