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
import { listarMensajerosParaAsignacion } from "@/lib/actions/ordenes-guia";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

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

const SIN_MENSAJEROS: readonly MensajeroLiteDTO[] = [];

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
 * Los mensajeros que ofrece el filtro. Misma accion y misma clave SWR que usan los
 * modales de asignacion de ordenes, para no montar una segunda lista que pueda
 * discrepar de aquella (y para reaprovechar su cache si ya esta pedida).
 *
 * ⚠️ FEATURE 271 (T9.4, R33) — LA MISMA ACCION TRAE `bloqueadosIds` Y AQUI NO SE LEE. ES
 * DELIBERADO, NO UN OLVIDO, y queda escrito porque es exactamente lo que el proximo lector va a
 * «arreglar» al ver que los dos modales de asignacion si lo aplican.
 *
 * FILTRAR NO ES ASIGNAR. Deshabilitar aqui a un mensajero bloqueado volveria INALCANZABLES las
 * ordenes que ya tiene en la mano: son las suyas, alguien tiene que poder buscarlas, y son
 * justamente las que hay que mirar cuando esta bloqueado. El bloqueo prohibe DARLE trabajo nuevo,
 * no VER el que lleva.
 */
async function mensajerosFetcher(): Promise<MensajeroLiteDTO[]> {
  const res = await listarMensajerosParaAsignacion();
  // Un fallo aqui NO rompe la barra: el filtro de mensajero se queda sin opciones y los
  // otros tres siguen operativos, que es el mismo trato que la barra de ordenes le da a
  // un catalogo caido. Por eso se devuelve vacio en vez de lanzar.
  if (res.status !== "ok") return [];
  return res.mensajeros;
}

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
  // Sin la faceta de mensajero no se pide el directorio: su accion responde `forbidden` a
  // quien no la tiene ofrecida, y pedir algo para tirarlo es un viaje al servidor por nada.
  const ofreceMensajeros = facetas === undefined || facetas.includes("mensajero");
  // Las dos lecturas van en la MISMA oleada, sin encadenarse: el catalogo no depende de
  // los mensajeros ni al reves, y esperar a uno para pedir el otro haria la barra el
  // doble de lenta sin que nada lo delatara.
  const { data: catalogoCargado, isLoading } = useSWR(
    "entregas:catalogo-filtros",
    catalogoFetcher,
    { revalidateOnFocus: false },
  );
  const { data: mensajeros } = useSWR(
    ofreceMensajeros ? "entregas:mensajeros" : null,
    mensajerosFetcher,
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
    const declarados = construirFiltrosEntregas(
      catalogo ?? CATALOGO_VACIO,
      mensajeros ?? SIN_MENSAJEROS,
      { facetas },
    );
    // Sin catalogo, los filtros que dependen de el se deshabilitan en vez de
    // desaparecer: un filtro ausente parece que no existe, uno deshabilitado dice que
    // ahora mismo no hay opciones. El de fecha no depende del catalogo y sigue operativo.
    return catalogo === null
      ? declarados.map((f) => (f.kind === "dateRange" ? f : { ...f, disabled: true }))
      : declarados;
  }, [catalogo, mensajeros, facetas]);

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
