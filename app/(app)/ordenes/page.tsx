import { RolValue } from "@prisma/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarLiberadasHoy } from "@/lib/actions/liberacion-reprogramada";

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

  // Feature 46 (R15/R16): pre-fetch server-side del aviso derivado "Liberadas hoy
  // (reprogramación)" para el maestro (bodega central, `en_bodega`). El loader
  // devuelve `forbidden` para roles no destinatarios (p. ej. `admin`), que degrada a
  // lista vacía. Datos por props al componente cliente (no fetch de datos sensibles).
  const liberadasResult = esMaestroOAdmin ? await listarLiberadasHoy() : null;
  const liberadasHoy =
    liberadasResult?.status === "ok" ? liberadasResult.liberadas : [];

  return (
      <section className="flex flex-1 flex-col gap-6 p-6">
        <PageHeader title="Órdenes" description="Listado y gestión de órdenes" />
        {esMaestroOAdmin ? (
          <OrdenesRevisionMaestro
            readOnly={actor?.rol === "admin"}
            liberadasHoy={liberadasHoy}
          />
        ) : (
          <OrdenesModule puedeCargarMasiva={puedeCargarMasiva} />
        )}
      </section>
    );
  }
