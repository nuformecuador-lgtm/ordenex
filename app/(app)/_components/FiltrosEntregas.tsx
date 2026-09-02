"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import type { Faceta } from "@/lib/analytics/presentacion";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

import {
  FILTRO_ENTREGAS_INICIAL,
  seleccionAFiltroAnalitica,
} from "./entregas-filtro-analitica";
import { construirFiltrosEntregas } from "./entregas-filtros-def";
import { useFiltroEntregas } from "./filtro-entregas";
import { coincideSeccion, useFiltroSecciones } from "./filtro-secciones";

/** Catalogo vacio: la barra se monta igual, sin opciones, si el catalogo no cargo. */
const CATALOGO_VACIO: CatalogoFiltrosOrdenesDTO = {
  zonas: [],
  tiendas: [],
  mensajeros: [],
  provincias: [],
  cantones: [],
  distritos: [],
};

/**
 * Que dice el campo que hace. Es lo unico que distingue «buscar una orden» de «saltar a
 * una seccion», y son dos cosas muy distintas: sin el rotulo, quien llega teclea una guia
 * y no entiende por que desaparece media pantalla.
 */
const ETIQUETA_BUSCADOR = "Buscar sección";
const PLACEHOLDER_BUSCADOR = "Nombre de la sección: Entregas, Indicadores…";
const TEXTO_SIN_COINCIDENCIAS = "Ninguna sección coincide con";

/**
 * El catalogo (zonas + tiendas) que rellena dos de los cuatro filtros.
 *
 * Se pide desde el CLIENTE, como hace la barra de analitica
 * (`analitica/_components/operativo/FiltrosOperativos.tsx`), y no desde la ruta: el Server
 * Component de `/dashboard` resuelve el actor UNA vez —lo afirma el guardia R4 de
 * `HomePageMaestro.test.tsx`— y esta accion lo resuelve otra por dentro.
 *
 * `null` cuando no se pudo cargar. No lanza: un catalogo caido deja la barra montada y
 * deshabilitada, no una pantalla rota (R64 de la 144).
 */
async function catalogoFetcher(): Promise<CatalogoFiltrosOrdenesDTO | null> {
  try {
    const res = await obtenerCatalogoFiltrosOrdenes();
    return res.status === "ok" ? res.catalogo : null;
  } catch {
    return null;
  }
}

/**
 * ⚠️ FICHA 351 (2026-09-02) — AQUI VIVIA `mensajerosFetcher`, Y SE FUE ENTERO. NO LO TRAIGAS DE
 * VUELTA sin leer esto, porque el hueco que deja es el arreglo.
 *
 * Esta barra pedia sus mensajeros a `listarMensajerosParaAsignacion` (misma accion y misma clave
 * SWR que los modales de asignacion, para no montar dos listas que pudieran discrepar). El
 * problema no era la duplicidad: era el SIGNIFICADO. Esa lista es la de ASIGNACION y por diseño
 * incluye a los dados de baja —alli hay a quien deshabilitar y un motivo que enseñar
 * (`MOTIVO_USUARIO_NO_ASIGNABLE`), y eso no se toca—. En un desplegable de FILTRO no hay nada de
 * eso: una opcion apagada no informa, y ofrecerla es exactamente lo que el humano señalo
 * («muestra tiendas o mensajeros que tenemos desactivos y eso es informacion que no debe
 * mostrarse»). Los mensajeros salen ahora del CATALOGO que esta misma barra ya pedia
 * (`obtenerCatalogoFiltrosOrdenes` -> `UserRepository.listMensajerosParaFiltro`), donde el
 * filtro de estado vive en el `WHERE`.
 *
 * DOS EFECTOS COLATERALES, los dos queridos y ninguno silencioso:
 *
 *  - **Una lectura menos por visita.** El catalogo ya viajaba; los mensajeros venian en una
 *    segunda peticion que ahora no se hace.
 *  - **El ALCANCE de la lista cambia de dueño.** `listarMensajerosParaAsignacion` devuelve solo
 *    los de la zona GAM y responde `forbidden` a quien no sea `maestro`/`admin`; el catalogo lo
 *    resuelve por ACTOR (`FiltrosOrdenesService`): al maestro y al admin les da los del pais y
 *    al `adminSatelite` los de SU zona —que antes veia el control vacio—. Es la misma regla que
 *    ya gobierna las otras seis facetas de esta barra, asi que el filtro deja de tener una
 *    excepcion propia.
 *
 * Lo que la 271/R33 protegia SIGUE EN PIE, y conviene no confundirlo: un mensajero BLOQUEADO POR
 * CIERRE (`bloqueadosIds`) esta `activo` y sigue apareciendo en este filtro. El bloqueo prohibe
 * DARLE trabajo nuevo, no VER el que lleva.
 */

/**
 * La barra de filtros de ordenes, montada en el panel maestro sobre las ENTREGAS: fecha (con
 * los mismos atajos de rango que ordenes), zona, provincia, canton, distrito, tienda y
 * mensajero.
 *
 * Es la MISMA pareja de componentes que la barra de ordenes —`BuscadorFiltros` como
 * contenedor y `FilterComponent` para los controles pedidos—, no una copia: el campo
 * manda la barra, el boton «Filtros» los ofrece todos, y los que el usuario pide se montan
 * delante del campo.
 *
 * EL CAMPO DE TEXTO FILTRA LAS SECCIONES de la pagina por su nombre («Entregas»,
 * «Indicadores operativos»…): lo publica en `FiltroSeccionesProvider` y cada
 * `SeccionFiltrable` decide si sigue en el arbol. No busca DENTRO de las secciones ni
 * consulta nada al servidor — es navegacion, no una consulta.
 *
 * LOS FILTROS YA CONSULTAN. La barra traduce su `seleccion` al filtro de la analitica
 * (`seleccionAFiltroAnalitica`) y lo publica en `FiltroEntregasProvider`; quien pinta cifras
 * dentro de la seccion —hoy el anillo de conteo— lo consume desde ahi. La traduccion vive
 * fuera, en su modulo puro, porque es donde se decide QUE numero se pide.
 *
 * LOS SIETE recortan la cifra: fecha, zona, provincia, canton, distrito, tienda y mensajero.
 * La cadena geografica estuvo RETIRADA mientras la cifra salia de `analytics_daily`, cuyo
 * grano no tiene esas coordenadas —ofrecerla era prometer un recorte que la analitica
 * ignoraba en silencio—. Volvio el 2026-08-17 con el cambio de fuente: el conteo se lee de la
 * tabla `orden`, que si tiene `provincia_id`, `canton_id` y `distrito_id` como columnas
 * propias. El motivo por el que no estaban desaparecio; el criterio es el mismo.
 */
export interface FiltrosEntregasProps {
  /**
   * Feature 133 (D5) — las facetas de filtro que ESTE actor puede elegir, tal como las
   * resolvio `recorteDePresentacion` en el servidor. Es un array de strings: no cruza la
   * frontera RSC ni un id, ni un nombre, ni el rol.
   *
   * Lo que decide: si se declaran los controles de zona, tienda y mensajero. La fecha y la
   * cadena geografica van siempre — a esta ultima la acota el CATALOGO, no el recorte.
   *
   * Omitirlo declara las tres, que es lo que ve el alcance global. Se pasa siempre desde la
   * ruta; el default existe para no obligar a los tests a montar el recorte entero.
   */
  facetas?: readonly Faceta[];
}

export function FiltrosEntregas({ facetas }: Readonly<FiltrosEntregasProps> = {}) {
  // UNA sola lectura desde la ficha 351. Antes eran dos en la misma oleada —el catalogo y un
  // directorio de mensajeros aparte—; la segunda desaparecio con `mensajerosFetcher` (ver la
  // nota de arriba), y con ella el `ofreceMensajeros` que decidia si valia la pena pedirla: el
  // catalogo ya sirve la lista ACOTADA AL ACTOR, asi que el rol que no tiene la faceta recibe
  // una lista vacia sin ningun viaje de mas.
  const { data: catalogoCargado, isLoading } = useSWR(
    "entregas:catalogo-filtros",
    catalogoFetcher,
    { revalidateOnFocus: false },
  );

  // Mientras carga NO se dan por perdidas las opciones: `undefined` (en vuelo) y `null`
  // (no cargo) son dos cosas distintas, y confundirlas deshabilitaria la barra entera
  // durante el primer paint de cada visita.
  const catalogo = isLoading ? CATALOGO_VACIO : (catalogoCargado ?? null);

  // Seleccion agregada de los controles montados. `FilterComponent` es dueño de su
  // estado interno y emite la seleccion COMPLETA en cada cambio; aqui se guarda y se
  // PUBLICA ya traducida.
  const [seleccion, setSeleccion] = useState<FilterSelection>({});

  // El filtro que consumen las cifras de la seccion. Se publica en el mismo manejador que
  // guarda la seleccion —y no en un `useEffect` que la observe— para que no exista un
  // render intermedio en el que la barra dice una cosa y la cifra sigue mostrando otra.
  const { setFiltro } = useFiltroEntregas();

  function alCambiarSeleccion(nueva: FilterSelection) {
    setSeleccion(nueva);
    setFiltro(seleccionAFiltroAnalitica(nueva));
  }

  // El termino del buscador NO vive aqui: vive en el proveedor, porque quien lo consume
  // son las secciones de la pagina, que cuelgan de otras ramas del arbol. Aparte de la
  // seleccion en cualquier caso —`FilterComponent` emite la suya entera en cada cambio,
  // asi que guardarlo ahi dentro haria que marcar una zona lo borrase—.
  //
  // Sin proveedor el contexto vale «no hay filtro»: el campo sigue funcionando (su texto
  // es suyo) y simplemente no esconde nada.
  const { termino, setTermino, titulos } = useFiltroSecciones();

  // Claves de los filtros PUESTOS desde el selector. Arranca vacia: la barra nace con el
  // buscador solo y el usuario pide los que va a usar.
  const [activos, setActivos] = useState<string[]>([]);

  /**
   * Retirar un filtro del selector lo retira TAMBIEN de la cifra.
   *
   * ⚠ ESTO NO ES REDUNDANTE CON `FilterComponent`, aunque lo parezca. Aquel ya poda su
   * seleccion cuando una clave deja de estar declarada («un filtro que deja de estar
   * DECLARADO deja de filtrar»), pero esa poda vive en un `useEffect` SUYO — y aqui abajo
   * `FilterComponent` solo se monta si queda algun filtro puesto. Al desmarcar el ULTIMO, el
   * componente se DESMONTA: el efecto no llega a correr y su emision pendiente se cancela en
   * la limpieza. Resultado antes de este cambio: la seleccion del filtro retirado seguia viva
   * aqui, la cifra seguia recortada por un control que ya no estaba en pantalla, y «Limpiar
   * todo» se quedaba visible sin nada visible que limpiar.
   *
   * Se poda aqui, en el manejador, y no en un `useEffect` que observe `activos`: asi no
   * existe un render intermedio en el que la barra ya no muestra el filtro y la cifra todavia
   * lo aplica. Y sin debounce — quitar un filtro es una intencion explicita, no una racha de
   * tecleo.
   */
  function alCambiarActivos(nuevos: string[]) {
    setActivos(nuevos);

    const vivos = new Set(nuevos);
    const podada = Object.fromEntries(
      Object.entries(seleccion).filter(([clave]) => vivos.has(clave)),
    );
    // Solo se publica si algo se cayo: sin esta guarda, PONER un filtro nuevo (que no cambia
    // ninguna seleccion) republicaria el mismo filtro y dispararia una consulta de mas.
    if (Object.keys(podada).length === Object.keys(seleccion).length) return;

    setSeleccion(podada);
    setFiltro(seleccionAFiltroAnalitica(podada));
  }

  // `FilterComponent` no expone forma de vaciar su seleccion desde fuera, asi que
  // «Limpiar todo» le cambia la `key` para remontarlo limpio.
  const [reset, setReset] = useState(0);

  const filtros = useMemo<FilterDef[]>(() => {
    const declarados = construirFiltrosEntregas(catalogo ?? CATALOGO_VACIO, { facetas });
    // Sin catalogo, los filtros que dependen de el se deshabilitan en vez de
    // desaparecer: un filtro ausente parece que no existe, uno deshabilitado dice que
    // ahora mismo no hay opciones. El de fecha no depende del catalogo y sigue operativo.
    return catalogo === null
      ? declarados.map((f) => (f.kind === "dateRange" ? f : { ...f, disabled: true }))
      : declarados;
  }, [catalogo, facetas]);

  const ofrecidos = useMemo(
    () => filtros.map((f) => ({ key: f.key, label: f.label })),
    [filtros],
  );

  // Solo se montan los PEDIDOS, y en el orden en que se declararon (no en el de los
  // clics): asi los controles no bailan de sitio segun como se hayan ido pidiendo.
  const montados = useMemo(
    () => filtros.filter((f) => activos.includes(f.key)),
    [filtros, activos],
  );

  /** Deja la barra como recien abierta: sin valores y sin filtros puestos. */
  function limpiarTodo() {
    setSeleccion({});
    // Y la cifra vuelve a la del arranque. Sin esta linea «Limpiar todo» vaciaria los
    // controles dejando la cifra del ultimo filtro: la pantalla afirmaria estar sin filtrar
    // mientras muestra un recorte.
    setFiltro(FILTRO_ENTREGAS_INICIAL);
    setActivos([]);
    setReset((n) => n + 1);
  }

  // Que decir cuando lo tecleado no encuentra ninguna seccion. Se calcula sobre los
  // titulos REGISTRADOS —no sobre una lista escrita aqui—, asi que una seccion nueva
  // entra en la cuenta por el mero hecho de montarse.
  const sinCoincidencias =
    termino !== "" && titulos.length > 0 && !titulos.some((t) => coincideSeccion(t, termino));

  return (
    <>
    <BuscadorFiltros
      label={ETIQUETA_BUSCADOR}
      placeholder={PLACEHOLDER_BUSCADOR}
      onChange={setTermino}
      filtros={ofrecidos}
      activos={activos}
      onActivosChange={alCambiarActivos}
      onLimpiarTodo={limpiarTodo}
      // Basta con tener un filtro PUESTO —aunque este vacio— para ofrecer la limpieza:
      // retirarlo de la barra tambien es algo que limpiar. Lo que NO puede pasar es que el
      // boton siga ahi sin nada que limpiar, y por eso `seleccion` se poda en
      // `alCambiarActivos`: sin esa poda, esta condicion se quedaba en `true` para siempre
      // por una seleccion huerfana de un control ya retirado.
      hayFiltrosAplicados={
        activos.length > 0 || Object.keys(seleccion).length > 0 || termino !== ""
      }
    >
      {montados.length > 0 ? (
        <FilterComponent key={reset} filters={montados} onChange={alCambiarSeleccion} />
      ) : null}
    </BuscadorFiltros>
    {/* El aviso va JUNTO AL CAMPO, que es donde mira quien acaba de teclear. Sin el, una
        pagina que se queda vacia se lee como una pantalla rota y no como un filtro que no
        encontro nada. `role="status"` lo anuncia sin robar el foco del campo. */}
    {sinCoincidencias ? (
      <p role="status" className="text-sm text-muted-foreground">
        {`${TEXTO_SIN_COINCIDENCIAS} «${termino}».`}
      </p>
    ) : null}
    </>
  );
}
