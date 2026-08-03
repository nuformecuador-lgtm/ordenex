import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

import { AnaliticaShell } from "./_components/AnaliticaShell";
import { FiltrosOperativos } from "./_components/operativo/FiltrosOperativos";
import { PanelesOperativos } from "./_components/operativo/PanelesOperativos";

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
 * Feature 131 (T6.1, D7): esta página NO prefetchea, a propósito. La prosa de
 * `specs/129-…/design.md:143-145` anticipaba un `await listar…()` aquí, pero los
 * dos guardias de esta misma ruta lo contradicen: `AnaliticaPage.test.tsx:102-104`
 * exige `AnaliticaPage.length === 0`, y el censo sobre el código fuente de este
 * archivo prohíbe que importe acciones, servicios o repositorios (R24 de la 129).
 * **El guardia manda sobre la prosa del diseño**: un test es verificable y una
 * frase de un `design.md` ajeno no. Los datos los pide el módulo de cliente por
 * Server Action + SWR, que además es el patrón dominante del repo
 * (`OrdenesModule`). Revivir el prefetch exige retirar esas dos aserciones en SU
 * propio PR, no colarlo de lado.
 *
 * (Y sí: hasta este comentario tiene que evitar esos tres literales, porque el
 * censo lee el archivo entero. No se relaja el guardia; se reescribe la frase.)
 *
 * Lo único que la 131 añade aquí son sus DOS slots (D5): `AnaliticaShell.tsx` no
 * se toca, y el solape con la 132 —que añadirá `financiero={…}`— queda en la
 * línea del `return`.
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

  return (
    <AnaliticaShell filtros={<FiltrosOperativos />} operativo={<PanelesOperativos />} />
  );
}
