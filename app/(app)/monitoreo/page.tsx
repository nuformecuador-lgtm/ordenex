import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { TableroDiaModule } from "./_components/TableroDiaModule";

// Feature 192 (F1.1, design.md §7.1, R11) — LA RUTA del tablero del día.
//
// Server Component y nada más: resuelve el actor, cierra la puerta y monta el módulo de
// cliente. **No fetchea datos** ni importa repositorios, servicios o `lib/db`: los conteos los
// pide el módulo por Server Action + SWR, que es el patrón del repo para lectura con refresco
// (design.md §7.1, alternativa 6) y lo que permite el refresco de 30 s sin recargar la página.
//
// El ítem de menú (`lib/auth/menu-visibility.ts`) sólo decide qué se MUESTRA. **La defensa real
// es este `notFound()`** (R11): un `adminTienda` que teclee `/monitoreo` a mano, o que reciba
// el enlace compartible de R50, se encuentra un 404 y no una versión recortada del tablero.
// Mismo patrón que `app/(app)/analitica/page.tsx` y `app/(app)/incidentes/page.tsx`.
//
// Y no es la única puerta: el servicio vuelve a resolver el alcance en CADA lectura (R40), así
// que aunque esta guarda se cayera, las Server Actions seguirían denegando. Dos puertas a las
// mismas filas, a propósito.

const TITULO = "Monitoreo";
const DESCRIPCION =
  "El pulso del día en curso: cuántas órdenes lleva hoy cada mensajero y en qué terminó cada una";

/**
 * R1 — los tres roles que entran, y ninguno más. Es la MISMA lista que la del ítem "Monitoreo"
 * del menú, y un test lo comprueba contra `SIDEBAR_ITEMS` para que no puedan divergir: una
 * pantalla que se ve en el menú y responde 404 (o al revés) es peor que cualquiera de las dos.
 *
 * No es una segunda tabla de ALCANCE (R8): el recorte de filas lo sigue resolviendo
 * `resolverAlcance` en el servicio. Esto sólo decide quién ve la pantalla.
 */
const ROLES_CON_ACCESO: readonly RolValue[] = ["admin", "maestro", "adminSatelite"];

export default async function MonitoreoPage() {
  const actor = await resolveActorFromSession();
  if (!actor || !ROLES_CON_ACCESO.includes(actor.rol)) {
    notFound(); // R11
  }

  return (
    <AppPage title={TITULO} description={DESCRIPCION}>
      <TableroDiaModule />
    </AppPage>
  );
}
