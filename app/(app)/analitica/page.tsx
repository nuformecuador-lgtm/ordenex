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
import { FiltroEntregasProvider } from "@/app/(app)/_components/filtro-entregas";
import { FiltrosEntregas } from "@/app/(app)/_components/FiltrosEntregas";
import { ContenedorSeccion } from "@/components/shared/ContenedorSeccion";

import { AnaliticaShell } from "./_components/AnaliticaShell";
import { ConteoEntregasAnillo } from "./_components/entregas/ConteoEntregasAnillo";
import { ConteoPorStatusDona } from "./_components/entregas/ConteoPorStatusDona";
import { CargadasPorDiaBarras } from "./_components/entregas/CargadasPorDiaBarras";
import { HoyGestionBarras } from "./_components/entregas/HoyGestionBarras";
import { CicloVidaKpi } from "./_components/entregas/CicloVidaKpi";
import { DevolucionesPorCausaAnillo } from "./_components/entregas/DevolucionesPorCausaAnillo";
import { KpisEfectividad } from "./_components/entregas/KpisEfectividad";
import { cargarTableroFinanciero } from "./_components/financiero/cargar";
// import { cargarKpisFinancieros, kpisDenegados } from "./_components/finanzas/cargar-kpis"; // sección de finanzas comentada (2026-08-18)
// import { KpisFinancieros } from "./_components/finanzas/KpisFinancieros"; // sección de finanzas comentada (2026-08-18)
// import { FinanzasDiarioBarras } from "./_components/finanzas/FinanzasDiarioBarras"; // sección de finanzas comentada (2026-08-18)
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
// El nombre del bloque, y con el la etiqueta que busca el campo de secciones. Los dos salen
// de la MISMA constante: si el titulo visible dijera «Detalle entregas» y el registrado para
// la busqueda siguiera siendo «Entregas», teclear lo que se ve en pantalla no encontraria
// nada. `coincideSeccion` busca por subcadena, asi que «entregas» a secas sigue valiendo.
const TITULO_ENTREGAS = "Detalle - Movimiento de las ordenes";
const TITULO_OPERATIVO = "Indicadores operativos";
// Los dos rótulos de la sección de finanzas, comentados con ella (2026-08-18). Se conservan
// aquí —y no dentro del bloque comentado— para que reactivarla sea descomentar en un sitio y
// no reescribir un texto que ya estaba decidido.
// const TITULO_FINANCIERO_KPIS = "Finanzas";
// const DESCRIPCION_FINANCIERO_KPIS =
//   "Estado de las cuentas a día de hoy. Estas cifras NO responden a los filtros de arriba: son el saldo del libro entero, no el de un periodo.";
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
  // barra de entregas y, debajo, su contenedor con el anillo de conteo.
  //
  // La barra ofrece las CUATRO coordenadas por las que la analítica sabe recortar (fecha
  // con sus atajos, zona, tienda y mensajero) y NO sustituye a `FiltrosOperativos`, que
  // sigue siendo quien filtra el tablero: son dos barras con dos alcances distintos, y
  // fundirlas es una decisión aparte. Por eso el filtro de entregas viaja por su propio
  // proveedor y no por la URL, que es de la otra barra. Pasa como elemento ya montado, sin
  // props-función, porque cruza la frontera RSC.
  // El proveedor envuelve la barra Y la sección: quien filtra y quien consulta son
  // hermanos, así que un proveedor pegado a la barra no sería ancestro de la cifra. Envuelve
  // sólo este bloque —y no el shell entero, como el de secciones— porque este filtro no le
  // incumbe a nadie más de la página: el tablero operativo tiene el suyo.
  const bloqueEntregas = (
    <FiltroEntregasProvider>
      {/* LA BARRA SE QUEDA PEGADA ARRIBA al bajar por la pantalla. Esta seccion tiene cuatro
          graficas y crece: sin esto hay que volver arriba para cambiar un filtro y volver a
          bajar para ver el efecto, que es justo lo que se hace todo el rato aqui.

          ⚠ EL `sticky` VIVE EN ESTA PAGINA Y NO EN `FiltrosEntregas`, y es deliberado: esa
          barra la monta TAMBIEN el panel maestro de `/dashboard`, donde no se ha pedido y
          donde el alto de la pagina es otro. Pegarla dentro del componente la pegaria en las
          dos pantallas de una vez.

          `bg-background/70 backdrop-blur-md` es el MISMO tratamiento que ya usa la barra
          pegajosa de `Pagination`, en vez de inventar otro: sin fondo, las graficas se verian
          por debajo de los controles al hacer scroll.

          `-mx-6 px-6` compensa el `p-6` de `Container`: sin eso el fondo difuminado acaba
          antes que el borde y quedan dos franjas nitidas a los lados por las que se ve pasar
          el contenido.

          `z-20` basta: las graficas no declaran `z-index`, y el desplegable del selector de
          filtros va en un portal con `z-50`, asi que sigue quedando por encima.

          Funciona porque el layout eligio `overflow-x-clip` —y no `hidden`— en el `main`:
          `clip` no lo convierte en contenedor de scroll vertical, que es lo que dejaria a un
          `position: sticky` sin nada contra lo que pegarse. */}
      <div className="sticky top-0 z-20 -mx-6 bg-background/70 px-6 py-3 backdrop-blur-md">
        <FiltrosEntregas />
      </div>
      <SeccionFiltrable titulo={TITULO_ENTREGAS}>
        <ContenedorSeccion titulo={TITULO_ENTREGAS}>
          {/* LA FILA DE KPIs, encima de la rejilla: son el resumen de lo que las gráficas
              desglosan, y tres de los cuatro salen de las MISMAS filas que «Detalle de las
              órdenes» —comparten la clave de SWR, así que comparten petición y respuesta y no
              pueden discrepar de los segmentos de abajo. Dentro de ESTE contenedor y no en uno
              propio: es la misma pregunta a distinta resolución, y separarlos sugeriría dos
              fuentes.

              LA REJILLA LA PONE AQUÍ LA PÁGINA y no cada componente: `KpisEfectividad` devuelve
              sus tres tarjetas sueltas y el ciclo de vida es un cuarto componente, así que sólo
              este nivel sabe cuántas tarjetas hay en la fila. Con una rejilla dentro de cada
              uno serían dos filas pegadas, con dos `gap` y dos anchos de columna distintos.

              ⚠ SIN la caja de borde y sombra que llevan las celdas de las gráficas: `KpiCard`
              YA es una `Card` con su propio `ring` y su fondo, y envolverla dejaría una tarjeta
              dentro de otra. `items-start` para que una tarjeta de dos líneas no se estire al
              alto de la de al lado —el ciclo de vida lleva su denominador debajo— y deje la
              cifra flotando en medio del hueco. */}
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpisEfectividad />
            {/* El ciclo de vida NO comparte petición con los otros tres: tiene su propia acción
                y su propia clave. Comparte fila porque responde a la misma pregunta —cómo va la
                operación— pero su cifra es un promedio de tiempo, no un reparto de órdenes, y
                sólo cuenta las CERRADAS (ver `CicloVidaKpi`). */}
            <CicloVidaKpi />
          </div>
          {/* Los dos graficos, uno junto a otro y al 50 %.

              `sm` (640 px) y no `md` (768) porque el corte pedido es 600 y `sm` es el
              breakpoint mas cercano de la escala de Tailwind. Por debajo, una sola columna:
              dos donuts a 300 px en un movil no se leen, se adivinan.

              El grid va AQUI y no en `ContenedorSeccion columnas={2}`: aquel apila hasta
              `md`, que son 168 px de mas de los pedidos, y cambiarle el breakpoint moveria
              todos los contenedores del repo por una peticion de esta pantalla.

              `min-w-[300px]` en cada celda es el suelo pedido. `minmax(0,1fr)` de `1fr`
              a secas: el default de una celda de grid es `min-width:auto`, que impide
              encogerse por debajo del contenido y desbordaria la fila con la leyenda lateral
              dentro.

              CADA GRAFICO VA ENCERRADO en su propia caja (borde + sombra leve). La caja vive
              AQUI y no dentro de los componentes por dos razones: `GraficaMarco` es un
              `<section>` desnudo que comparten todas las graficas de analitica —darle borde
              alli encajaria tambien los paneles operativos y el tablero financiero, que nadie
              ha pedido— y ademas el borde es una decision de ESTA composicion: son dos
              tarjetas hermanas en una rejilla, y lo que las separa visualmente es el hueco
              entre cajas.

              `ring-1 ring-foreground/10` y no `border`: es exactamente lo que usa `Card`
              (`components/ui/card.tsx`), asi que estas dos cajas se ven como el resto de
              tarjetas del producto en lugar de inventar un borde propio. `shadow-sm` es la
              sombra leve. `bg-card` para que la sombra tenga sobre que apoyarse. */}
          {/* REJILLA DE 12 COLUMNAS, repartida por lo que cada gráfico necesita (opción A,
              2026-08-18). Doce y no dos columnas porque es lo que permite mezclar anchos en la
              MISMA rejilla: con `grid-cols-2` una fila entera tendría que salirse a otro
              contenedor y dejaría de compartir el `gap`.

              El orden es el de lectura: primero cómo acabó todo, luego el detalle y el ritmo
              diario, y al final lo que queda pendiente hoy. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
            {/* 12 de 12: es UNA barra al 100 % con seis franjas y su leyenda. A media fila las
                franjas pequeñas —incidentes al 2 %— se vuelven astillas y la leyenda salta a
                tres líneas; a ancho completo se lee entera de un vistazo. */}
            <div className="min-w-[300px] rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:col-span-12">
              <ConteoEntregasAnillo />
            </div>

            {/* 6 + 6: el desglose por estado y el ritmo diario, uno al lado del otro. Son las
                dos caras de la misma pregunta —qué pasó y cuándo— y comparar de un vistazo
                «hubo más reprogramadas» con «entró más volumen» es justo lo que se viene a
                hacer. Las filas del ranking crecen hacia abajo, así que a media anchura no
                pierden ninguna categoría: solo recortan el nombre, que el tooltip devuelve. */}
            <div className="min-w-[300px] rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:col-span-6">
              <ConteoPorStatusDona />
            </div>
            <div className="min-w-[300px] rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:col-span-6">
              <CargadasPorDiaBarras />
            </div>

            {/* 6 + 6: las causas de devolución y el pendiente de hoy. Ojo al leer las causas
                junto a la barra de arriba: aquí se cuentan GESTIONES y allí ÓRDENES, así que
                sus totales no tienen por qué coincidir (ver `DevolucionesPorCausaAnillo`). */}
            <div className="min-w-[300px] rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:col-span-6">
              <DevolucionesPorCausaAnillo />
            </div>
            {/* El contador de hoy: una barra partida en dos y su leyenda. No depende del
                filtro, así que no gana nada con más sitio. */}
            <div className="min-w-[300px] rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:col-span-6">
              <HoyGestionBarras />
            </div>
          </div>
        </ContenedorSeccion>
      </SeccionFiltrable>
    </FiltroEntregasProvider>
  );

  // ─── LA SECCIÓN FINANCIERA, SEPARADA Y SIN FILTROS (2026-08-18) ───────────────────────
  //
  // Sección PROPIA y hermana de la de entregas, no un bloque dentro de ella: sus seis cifras no
  // responden a la barra de filtros —son el estado de las cuentas HOY— y meterlas bajo el mismo
  // título haría creer que sí. Por eso vive FUERA de `FiltroEntregasProvider`: lo que no se
  // filtra no cuelga del proveedor que filtra.
  //
  // ⚠ QUIÉN LA VE Y QUÉ VE. La sección se monta para los MISMOS roles que la de entregas (así se
  // pidió), pero las cifras siguen exigiendo acceso total: la caja central y los saldos de TODAS
  // las tiendas son dinero de otros inquilinos. Un rol sin acceso total ve las seis tarjetas en
  // estado «no tienes acceso», y `kpisDenegados()` produce ese estado SIN consultar la base — un
  // rol denegado no debe llegar al dinero ni una sola vez (R9 de la 132), tampoco para que le
  // digan que no.
  // ⚠ SECCIÓN DE FINANZAS COMENTADA (2026-08-18, decisión humana). Se comenta ENTERA y no se
  // borra: el trabajo está hecho y probado, y volver a encenderla es quitar estas marcas.
  //
  // Lo que hay que saber para reactivarla, porque no basta con descomentar este bloque:
  //   - hay que devolver `{bloqueFinanciero}` a `bloquesDestacados`, justo debajo;
  //   - hay que descomentar los tres imports de `./_components/finanzas/` arriba, que también
  //     se comentaron — dejarlos vivos con el bloque muerto deja el módulo cargándose y el
  //     linter en rojo por importaciones sin usar.
  //
  // Y lo que ESTO ahorra mientras esté apagada: `cargarKpisFinancieros()` corría en el render
  // del servidor y consultaba la caja y los saldos de todas las tiendas. Con el bloque
  // comentado ya no se llama — que es la diferencia con la sección financiera del shell, que
  // sigue pidiendo sus diez métricas aunque su `<section>` esté comentada.
  // const bloqueFinanciero = (
  //   <SeccionFiltrable titulo={TITULO_FINANCIERO_KPIS}>
  //     <ContenedorSeccion
  //       titulo={TITULO_FINANCIERO_KPIS}
  //       descripcion={DESCRIPCION_FINANCIERO_KPIS}
  //     >
  //       <KpisFinancieros
  //         kpis={esAccesoTotal(actor.rol) ? await cargarKpisFinancieros() : kpisDenegados()}
  //       />
  //       {/* Debajo de las tarjetas: los KPIs dicen el ESTADO de las cuentas hoy y esta serie dice
  //           cómo se llegó a él, día a día, en los últimos 30. Misma sección porque es la misma
  //           pregunta a distinta resolución.
  //
  //           La caja de borde y sombra la pone esta celda, como en la rejilla de gráficas: las
  //           tarjetas de KPI ya son `Card`, pero `GraficaMarco` es un `<section>` desnudo. */}
  //       <div className="mt-4 min-w-[300px] rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
  //         <FinanzasDiarioBarras />
  //       </div>
  //     </ContenedorSeccion>
  //   </SeccionFiltrable>
  // );

  // La sección de entregas viaja en el slot `destacado` porque hoy es el ÚNICO que el shell
  // pinta: sus otras tres regiones están comentadas en `AnaliticaShell`. La de finanzas iba
  // aquí al lado y está comentada arriba; cuando vuelvan las regiones del shell, cualquiera de
  // las dos puede pasar a su propio slot sin tocar nada de lo de arriba.
  const bloquesDestacados = (
    <>
      {bloqueEntregas}
      {/* {bloqueFinanciero} — comentado con su bloque, ver arriba. */}
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
          destacado={bloquesDestacados}
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
        destacado={bloquesDestacados}
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
