import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";

import { AnaliticaShell } from "./_components/AnaliticaShell";
import { cargarTableroFinanciero } from "./_components/financiero/cargar";
import { TableroFinanciero } from "./_components/financiero/TableroFinanciero";
import { FiltrosOperativos } from "./_components/operativo/FiltrosOperativos";
import { PanelesOperativos } from "./_components/operativo/PanelesOperativos";

/**
 * Feature 129: ruta y shell del tablero de analítica. El rol se resuelve SOLO
 * server-side (`resolveActorFromSession`, mismo patrón que
 * `app/(app)/incidentes/page.tsx:25-33`): el ítem de menú
 * (`lib/auth/menu-visibility.ts`) sólo decide qué se MUESTRA, la defensa real
 * es este `notFound()`.
 *
 * SOLO `maestro`/`admin` (D1, `ROLES_ACCESO_ANALITICA`). La feature 133 amplía a
 * `mensajero`, `adminTienda` y `adminSatelite` tocando ESTA misma constante
 * (para no romper R10).
 *
 * ─── LAS DOS REGIONES SE CABLEAN DE FORMAS DISTINTAS, Y ES DELIBERADO ────────
 *
 * Feature 131 (T6.1, D7) — la parte OPERATIVA **no** se prefetchea aquí. La
 * prosa de `specs/129-…/design.md:143-145` anticipaba un `await listar…()` en
 * esta página, pero los dos guardias de esta misma ruta lo contradicen:
 * `AnaliticaPage.test.tsx:102-104` exige `AnaliticaPage.length === 0`, y el
 * censo sobre el código fuente de este archivo prohíbe que importe las capas de
 * acceso a datos (R24 de la 129). **El guardia manda sobre la prosa del
 * diseño**: un test es verificable y una frase de un `design.md` ajeno no. Los
 * datos operativos los pide el módulo de cliente por Server Action + SWR, que
 * además es el patrón dominante del repo (`OrdenesModule`). Revivir el prefetch
 * exige retirar esas dos aserciones en SU propio PR, no colarlo de lado.
 *
 * (Y sí: hasta este comentario tiene que evitar esos tres literales de ruta,
 * porque el censo lee el archivo entero. No se relaja el guardia; se reescribe
 * la frase.)
 *
 * Feature 132 — la parte FINANCIERA sí se pre-carga aquí (R9) y baja por props
 * al shell: ningún componente de esa región hace `fetch`, usa SWR ni invoca
 * Server Actions desde el navegador. Eso NO contradice el censo de arriba: el
 * único acceso al dinero está encapsulado en `./_components/financiero/cargar`,
 * un módulo vecino, de modo que esta página sigue sin importar ninguna de las
 * capas prohibidas.
 *
 * Quién ve la región financiera: exactamente los roles que `esAccesoTotal(rol)`
 * acepta (D7 de la 135). NO se declara aquí ninguna lista de roles nueva: sería
 * la tercera constante con el mismo contenido y significados distintos (R3). Si
 * el rol no la satisface, la prop `financiero` NO SE PASA y el shell no
 * renderiza la región en absoluto — ni encabezado, ni estado vacío (R2/R7).
 *
 * La región operativa, en cambio, la ve todo el que supera el gate: sus dos
 * slots van SIEMPRE (D5 de la 131).
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

  // El pre-fetch del dinero va DESPUÉS del gate a propósito: un rol denegado no
  // debe llegar a consultarlo ni una sola vez (R9). Y va dentro de la guarda de
  // `esAccesoTotal` por el mismo motivo: un rol sin acceso total tampoco lo pide.
  if (!esAccesoTotal(actor.rol)) {
    return (
      <AnaliticaShell filtros={<FiltrosOperativos />} operativo={<PanelesOperativos />} />
    );
  }

  const paneles = await cargarTableroFinanciero();
  return (
    <AnaliticaShell
      filtros={<FiltrosOperativos />}
      operativo={<PanelesOperativos />}
      financiero={<TableroFinanciero paneles={paneles} />}
    />
  );
}
