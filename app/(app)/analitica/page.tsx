import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

import { AnaliticaShell } from "./_components/AnaliticaShell";
import { cargarTableroFinanciero } from "./_components/financiero/cargar";
import { TableroFinanciero } from "./_components/financiero/TableroFinanciero";

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
 * Feature 132: el "prefetchea" de la ficha YA ESTÁ EN ALCANCE — la 127 (borde
 * financiero) está `done`, así que este Server Component pre-carga aquí, antes
 * de renderizar, todos los datos del tablero financiero (R9) y los baja por
 * props al shell. Ningún componente de la región hace `fetch`, usa SWR ni
 * invoca Server Actions desde el navegador. Lo que sigue pendiente es la parte
 * OPERATIVA: la 126 sigue `pending` y la 131 añadirá sus `await` operativos en
 * este mismo hueco, entre el gate y el `return`.
 *
 * Esta página sigue sin importar ninguna capa de acciones, servicios ni
 * repositorios (hay un test que lo censa sobre este mismo fuente): el único
 * acceso al dinero está encapsulado en `./_components/financiero/cargar`, que
 * es quien habla con el borde de la 127.
 *
 * Quién ve la región financiera: exactamente los roles que `esAccesoTotal(rol)`
 * acepta (D7 de la 135). NO se declara aquí ninguna lista de roles nueva: sería
 * la tercera constante con el mismo contenido y significados distintos (R3). Si
 * el rol no la satisface, la prop `financiero` NO SE PASA y el shell no
 * renderiza la región en absoluto — ni encabezado, ni estado vacío (R2/R7).
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

  // El pre-fetch va DESPUÉS del gate a propósito: un rol denegado no debe llegar
  // a consultar el dinero ni una sola vez (R9).
  if (!esAccesoTotal(actor.rol)) {
    return <AnaliticaShell />;
  }

  const paneles = await cargarTableroFinanciero();
  return <AnaliticaShell financiero={<TableroFinanciero paneles={paneles} />} />;
}
