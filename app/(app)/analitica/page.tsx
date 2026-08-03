import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

import { AnaliticaShell } from "./_components/AnaliticaShell";

/**
 * Feature 129: ruta y shell del tablero de analítica. El rol se resuelve SOLO
 * server-side (`resolveActorFromSession`, mismo patrón que
 * `app/(app)/incidentes/page.tsx:25-33`): el ítem de menú
 * (`lib/auth/menu-visibility.ts`) sólo decide qué se MUESTRA, la defensa real
 * es este `notFound()`.
 *
 * SOLO `maestro`/`admin` (D1, `ROLES_ACCESO_ANALITICA`): hasta que la 131 cablee
 * métricas, la página está vacía y dar la entrada a `mensajero`,
 * `adminTienda` o `adminSatelite` sería publicar un control que no lleva a
 * ninguna parte. La feature 133 amplía a esos tres roles tocando ESTA misma
 * constante (para no romper R10).
 *
 * El "prefetchea" de la ficha queda FUERA DE ALCANCE: hoy no hay ninguna
 * Server Action de analítica (126/127 siguen `pending`), así que no hay nada
 * que prefetchear sin inventar su contrato. El `async` de esta página ES el
 * punto de extensión: la 131 añade sus `await listar…()` entre el gate y el
 * `return`, y baja los resultados por las props del shell.
 */
export default async function AnaliticaPage() {
  const actor = await resolveActorFromSession();
  // `ROLES_ACCESO_ANALITICA` es una tupla literal (`readonly ["maestro","admin"]`)
  // y su `.includes` sólo acepta esos dos literales, no cualquier `RolValue`. Se
  // ensancha el tipo del ARRAY (no el de `actor.rol`) en este único punto de uso.
  const rolesConAcceso: readonly RolValue[] = ROLES_ACCESO_ANALITICA;
  if (!actor || !rolesConAcceso.includes(actor.rol)) {
    notFound();
  }

  return <AnaliticaShell />;
}
