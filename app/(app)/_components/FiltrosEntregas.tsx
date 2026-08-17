"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { listarMensajerosParaAsignacion } from "@/lib/actions/ordenes-guia";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { construirFiltrosEntregas } from "./entregas-filtros-def";
import { coincideSeccion, useFiltroSecciones } from "./filtro-secciones";

/** Catalogo vacio: la barra se monta igual, sin opciones, si el catalogo no cargo. */
const CATALOGO_VACIO: CatalogoFiltrosOrdenesDTO = {
  zonas: [],
  tiendas: [],
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
 * El catalogo (zonas + geografia) que rellena cinco de los seis filtros.
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
 */
async function mensajerosFetcher(): Promise<MensajeroLiteDTO[]> {
  const res = await listarMensajerosParaAsignacion();
  // Un fallo aqui NO rompe la barra: el filtro de mensajero se queda sin opciones y los
  // otros cinco siguen operativos, que es el mismo trato que la barra de ordenes le da a
  // un catalogo caido. Por eso se devuelve vacio en vez de lanzar.
  if (res.status !== "ok") return [];
  return res.mensajeros;
}

/**
 * La barra de filtros de ordenes, montada en el panel maestro sobre las ENTREGAS:
 * fecha (con los mismos atajos de rango que ordenes), zona, provincia, canton, distrito
 * y mensajero.
 *
 * Es la MISMA pareja de componentes que la barra de ordenes —`BuscadorFiltros` como
 * contenedor y `FilterComponent` para los controles pedidos—, no una copia: el campo
 * manda la barra, el boton «Filtros» ofrece los seis, y los que el usuario pide se montan
 * delante del campo.
 *
 * EL CAMPO DE TEXTO FILTRA LAS SECCIONES de la pagina por su nombre («Entregas»,
 * «Indicadores operativos»…): lo publica en `FiltroSeccionesProvider` y cada
 * `SeccionFiltrable` decide si sigue en el arbol. No busca DENTRO de las secciones ni
 * consulta nada al servidor — es navegacion, no una consulta.
 *
 * ⚠️ LOS SEIS FILTROS, EN CAMBIO, TODAVIA NO CONSULTAN NADA. La barra es dueña de su
 * `seleccion` y la deja lista, pero no hay un listado de entregas contra el que aplicarla:
 * el contenedor «Entregas» esta vacio. Enchufarlo es traducir esa seleccion al `filter`
 * del listado que se monte ahi —como hace `seleccionAFilter` en ordenes— y no exige tocar
 * este archivo por dentro.
 */
export function FiltrosEntregas() {
  // Las dos lecturas van en la MISMA oleada, sin encadenarse: el catalogo no depende de
  // los mensajeros ni al reves, y esperar a uno para pedir el otro haria la barra el
  // doble de lenta sin que nada lo delatara.
  const { data: catalogoCargado, isLoading } = useSWR(
    "entregas:catalogo-filtros",
    catalogoFetcher,
    { revalidateOnFocus: false },
  );
  const { data: mensajeros } = useSWR("entregas:mensajeros", mensajerosFetcher, {
    revalidateOnFocus: false,
  });

  // Mientras carga NO se dan por perdidas las opciones: `undefined` (en vuelo) y `null`
  // (no cargo) son dos cosas distintas, y confundirlas deshabilitaria la barra entera
  // durante el primer paint de cada visita.
  const catalogo = isLoading ? CATALOGO_VACIO : (catalogoCargado ?? null);

  // Seleccion agregada de los controles montados. `FilterComponent` es dueño de su
  // estado interno y emite la seleccion COMPLETA en cada cambio; aqui solo se guarda.
  const [seleccion, setSeleccion] = useState<FilterSelection>({});

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

  // `FilterComponent` no expone forma de vaciar su seleccion desde fuera, asi que
  // «Limpiar todo» le cambia la `key` para remontarlo limpio.
  const [reset, setReset] = useState(0);

  const filtros = useMemo<FilterDef[]>(() => {
    const declarados = construirFiltrosEntregas(
      catalogo ?? CATALOGO_VACIO,
      mensajeros ?? SIN_MENSAJEROS,
    );
    // Sin catalogo, los filtros que dependen de el se deshabilitan en vez de
    // desaparecer: un filtro ausente parece que no existe, uno deshabilitado dice que
    // ahora mismo no hay opciones. El de fecha no depende del catalogo y sigue operativo.
    return catalogo === null
      ? declarados.map((f) => (f.kind === "dateRange" ? f : { ...f, disabled: true }))
      : declarados;
  }, [catalogo, mensajeros]);

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
      onActivosChange={setActivos}
      onLimpiarTodo={limpiarTodo}
      // Basta con tener un filtro PUESTO —aunque este vacio— para ofrecer la limpieza:
      // retirarlo de la barra tambien es algo que limpiar.
      hayFiltrosAplicados={
        activos.length > 0 || Object.keys(seleccion).length > 0 || termino !== ""
      }
    >
      {montados.length > 0 ? (
        <FilterComponent key={reset} filters={montados} onChange={setSeleccion} />
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
