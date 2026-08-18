import type { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";

import { recorteDePresentacion } from "@/lib/analytics/presentacion";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_ACCESO_ANALITICA } from "@/lib/auth/menu-visibility";
import {
  FiltroSeccionesProvider,
  SeccionFiltrable,
} from "@/app/(app)/_components/filtro-secciones";
import { FiltrosEntregas } from "@/app/(app)/_components/FiltrosEntregas";
import { ContenedorSeccion } from "@/components/shared/ContenedorSeccion";

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
 * Entran los roles de `ROLES_ACCESO_ANALITICA`: los lectores del dominio de la
 * analítica (D1 de la 133) MENOS los que la decisión del 2026-08-12 dejó fuera
 * —hoy el `mensajero`, que conserva su alcance en el catálogo pero ya no tiene
 * puerta—. El ítem de menú consume esa misma constante, así que las dos capas no
 * pueden divergir (R10 de la 129).
 *
 * ─── FEATURE 133: EL RECORTE DE PRESENTACIÓN ─────────────────────────────────
 *
 * `recorteDePresentacion(actor)` decide, EN EL SERVIDOR, qué CONTROL se dibuja:
 * las facetas de filtro que la barra ofrece y el tipo de alcance que rotula el
 * tablero. Devuelve enums y arrays de strings — ni filas, ni ids, ni nombres —,
 * de modo que lo que cruza la frontera RSC son props planas y serializables.
 *
 * NO es el recorte de DATOS. Ese lo aplica el borde de la 122 antes de tocar la
 * base, y sigue aplicándose igual aunque estas props dijeran otra cosa: un panel
 * que no se pinta no es un dato que no se filtra.
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
/**
 * Textos del encabezado del bloque operativo. Fuera del JSX y en una sola
 * constante, como el resto de la analítica, para que la región quede lista para
 * i18n sin tocar el árbol.
 *
 * NO repiten el nombre accesible de la región del shell («Tablero operativo»):
 * dos rótulos idénticos en el mismo subárbol se leen como una duplicación, no
 * como una jerarquía.
 */
const TITULO_ENTREGAS = "Entregas";
const TITULO_OPERATIVO = "Indicadores operativos";
const DESCRIPCION_OPERATIVO =
  "Los paneles se calculan sobre el rango y los filtros seleccionados arriba.";

export default async function AnaliticaPage() {
  const actor = await resolveActorFromSession();
  // `ROLES_ACCESO_ANALITICA` es un array de literales de rol —los del dominio de
  // analítica, del que deriva restando (D1 de la 133 + la decisión del 2026-08-12)—
  // y su `.includes` sólo acepta esos literales, no cualquier `RolValue`. Se
  // ensancha el tipo del ARRAY (no el de `actor.rol`) en este único punto de uso.
  //
  // Ojo con lo que este conjunto NO decide: quién ve el DINERO lo sigue decidiendo
  // `esAccesoTotal` unas líneas más abajo, que es otro concepto y otra fuente.
  // Entrar a la página y ver la región financiera son dos permisos distintos.
  const rolesConAcceso: readonly RolValue[] = ROLES_ACCESO_ANALITICA;
  if (!actor || !rolesConAcceso.includes(actor.rol)) {
    notFound();
  }

  // Feature 133 (D5/D6) — qué se le PINTA a este actor. Props planas: un array de
  // strings y un enum. Se calcula después del gate: para quien no entra, no hay
  // nada que recortar.
  const recorte = recorteDePresentacion(actor);

  // El contenedor es PRESENTACIÓN y nada más: un encabezado y los N componentes
  // que se le pasen dentro. No cambia qué se carga ni quién lo ve — esas dos
  // decisiones siguen viviendo enteras en el gate y en `esAccesoTotal` de abajo.
  // Se declara una vez para que las dos ramas pinten exactamente el mismo bloque
  // operativo y no puedan divergir.
  const bloqueOperativo = (
    <SeccionFiltrable titulo={TITULO_OPERATIVO}>
      <ContenedorSeccion
        titulo={TITULO_OPERATIVO}
        descripcion={DESCRIPCION_OPERATIVO}
      >
        <PanelesOperativos alcance={recorte.alcance} />
      </ContenedorSeccion>
    </SeccionFiltrable>
  );

  // Va PRIMERO dentro de la página, por encima de la región de filtros del tablero: la
  // barra de entregas y, debajo, su contenedor. Hoy el contenedor es sólo su encabezado
  // —no pinta cuerpo mientras no reciba hijos, así que no hay ni una caja vacía ni una
  // cifra de relleno; un cero de placeholder es indistinguible de un cero real (R22 de
  // la 129)— y la barra todavía no consulta nada (ver `FiltrosEntregas`).
  //
  // La barra es la de ÓRDENES (fecha con sus atajos, zona, provincia, cantón, distrito y
  // mensajero) y NO sustituye a `FiltrosOperativos`, que sigue siendo quien filtra el
  // tablero: son dos barras con dos alcances distintos, y fundirlas es una decisión
  // aparte. Pasa como elemento ya montado, sin props-función, porque cruza la frontera RSC.
  const bloqueEntregas = (
    <>
      <FiltrosEntregas />
      <SeccionFiltrable titulo={TITULO_ENTREGAS}>
        <ContenedorSeccion titulo={TITULO_ENTREGAS} />
      </SeccionFiltrable>
    </>
  );

  // El pre-fetch del dinero va DESPUÉS del gate a propósito: un rol denegado no
  // debe llegar a consultarlo ni una sola vez (R9). Y va dentro de la guarda de
  // `esAccesoTotal` por el mismo motivo: un rol sin acceso total tampoco lo pide.
  // El proveedor envuelve el SHELL ENTERO, no solo la barra: quien teclea (la barra, en el
  // slot `destacado`) y quien se oculta (las secciones, en los otros slots) cuelgan de
  // ramas distintas, así que un proveedor pegado a la barra no sería ancestro de nadie a
  // quien filtrar. No pinta nada: sin término escrito el árbol es idéntico al de antes.
  if (!esAccesoTotal(actor.rol)) {
    return (
      <FiltroSeccionesProvider>
        <AnaliticaShell
          destacado={bloqueEntregas}
          filtros={<FiltrosOperativos facetas={recorte.facetas} />}
          operativo={bloqueOperativo}
        />
      </FiltroSeccionesProvider>
    );
  }

  const paneles = await cargarTableroFinanciero();
  return (
    <FiltroSeccionesProvider>
      <AnaliticaShell
        destacado={bloqueEntregas}
        filtros={<FiltrosOperativos facetas={recorte.facetas} />}
        operativo={bloqueOperativo}
        // La región financiera NO se declara filtrable, y no es un olvido: quién la ve lo
        // decide `esAccesoTotal` server-side (R2/R7 de la 132), y meterla en un filtro de
        // presentación mezclaría «no te toca» con «no la buscaste». Se deja para su
        // propio PR, con sus guardias delante.
        financiero={<TableroFinanciero paneles={paneles} />}
      />
    </FiltroSeccionesProvider>
  );
}
