"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataTable,
  type Column,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import {
  FilterComponent,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import {
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import type {
  CatalogoFiltrosSateliteDTO,
  RecepcionSateliteDTO,
} from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 158 (T2.7, decisión del humano del 2026-07-30): el reporte de incidente también
// vive en la bodega satélite. Se IMPORTA el mismo disparador y el mismo modal de `/ordenes`;
// esta superficie sólo aporta SU regla de disponibilidad (alcance por zona, R48).
import { ReportarIncidenteAccion } from "@/app/(app)/ordenes/_components/ReportarIncidenteAccion";
import { puedeReportarIncidenteSatelite } from "./incidente-satelite";
import { recibidasColumns } from "./recibidas-columns";
import { COLUMNAS_DESCARGA_SATELITE } from "./satelite-descarga-columnas";
import {
  construirFiltrosSatelite,
  etiquetaEstado,
  seleccionAFiltroSatelite,
  type FiltroBodegaSatelite,
} from "./satelite-ordenes-filtros";

// Pedido humano: la bodega satélite deja de tener una sección (y una tabla) por estado y
// pasa a UN SOLO listado con barra de filtros, como el del admin en `/ordenes`.
//
// Qué cambia y qué no:
//   - Una tabla con las órdenes de los CINCO estados que ve el adminSatelite. El filtro
//     de estado ofrece exactamente esos cinco (ver `satelite-ordenes-filtros.ts`).
//   - Las acciones que antes vivían en la cabecera de cada sección ahora son acciones DE
//     LOTE sobre la selección, y se habilitan según el estado de lo seleccionado: asignar
//     mensajero (recibidas), deshacer asignación (por recoger, feature 149/R35), enviar a
//     central (por devolver) y recuperar (devueltas). Con una selección MIXTA no se ofrece
//     ninguna: son transiciones distintas.
//   - "Por recibir" NO entra aquí: se acepta por escáner/lote y vive en su propia sección.
//
// Feature 170 — FASE 2 (T K.3): la tabla pinta UNA PÁGINA que resuelve el servidor. Este
// componente ya NO consulta ni recorta nada: recibe la página, el total del conjunto y el
// catálogo de opciones, y EMITE los filtros elegidos (`onFiltroChange`) para que el módulo
// —que es quien tiene los datos— pida la página que toca. Lo que sí decide aquí es lo que
// es suyo: qué filas están marcadas y qué acción de lote se ofrece sobre ellas (R47/R48).

/**
 * Feature 170 (T A.2) — título del dataset: encabezado de la sección, nombre accesible de
 * la tabla, nombre de la hoja y base del nombre de archivo
 * (`ordenes-de-la-bodega-YYYY-MM-DD.xlsx`, R12), y parte del nombre accesible del control
 * de descarga (R13). Se EXPORTA porque desde T K.3 la descarga la arma el módulo —es quien
 * conoce el origen del conjunto completo— y las dos partes tienen que decir lo mismo.
 */
export const TITULO_BODEGA = "Órdenes de la bodega";

/** Estados sobre los que cada acción de lote es válida. */
const ESTADO_ASIGNABLE = "en_bodega_satelite";
/** Feature 149 (R35): asignada a un mensajero que aún NO la recogió; la asignación se deshace. */
const ESTADO_POR_RECOGER = "por_recoger";
const ESTADO_POR_DEVOLVER = "por_devolver";
const ESTADO_DEVUELTA = "devuelta";

export interface SateliteOrdenesListadoProps {
  /**
   * Feature 170 — FASE 2 (T K.3, R40): la PÁGINA visible que devolvió el servidor, ya
   * filtrada y ordenada por él. NO es el conjunto: para hablar del conjunto están `total`
   * y `totalSinFiltros`.
   */
  ordenes: RecepcionSateliteDTO[];
  /**
   * R41/R42: total de órdenes que corresponden a los filtros vigentes y al alcance del
   * actor, tal como lo devolvió el servidor. NUNCA `ordenes.length`.
   */
  total: number;
  /**
   * R42: total del conjunto del actor SIN filtros (la página 1 que pre-cargó el Server
   * Component). Es el «de Y» del contador; también viene del servidor.
   */
  totalSinFiltros: number;
  /**
   * T K.2 (R46): opciones de cantón y distrito del CONJUNTO del actor, independientes de
   * la página visible. Alimentan los dos desplegables.
   */
  catalogo: CatalogoFiltrosSateliteDTO;
  /** Emite los tres filtros elegidos; el módulo pide con ellos la página al servidor (R45). */
  onFiltroChange: (filtro: FiltroBodegaSatelite) => void;
  /**
   * R52 — filas del CONJUNTO COMPLETO con los filtros vigentes, para el archivo.
   *
   * Es un CALLBACK, no unos filtros: esta tabla pinta la página que le llega por props y no
   * conoce el origen del conjunto ni los filtros vigentes; quien los conoce es
   * `RecepcionSateliteModule`, que cierra sobre ellos. Mismo patrón que `WalletLedger` /
   * `DesglosePagos` (T C.4), y lo que manda el design §5: nunca los filtros a la tabla. Las
   * COLUMNAS del archivo las declara esta tabla, que es la que sabe qué enseña.
   */
  obtenerFilasDescarga: () => Promise<DescargaFilasResult>;
  /**
   * Feature 184 — Tanda A (T A.5, R18/R19/R22) — cuáles de estos identificadores SIGUEN en el
   * conjunto filtrado, según el SERVIDOR.
   *
   * Es un callback por lo mismo que `obtenerFilasDescarga`: los filtros vigentes los conoce el
   * módulo, no esta tabla. Devuelve los VIGENTES —nunca los caducados— para que una respuesta
   * corta por error no pueda leerse como «desmarca todo», y `null` cuando la comprobación no
   * se pudo hacer, que aquí significa NO PODAR (R22).
   *
   * Opcional: sin él la selección se comporta como antes de la tanda A.
   */
  comprobarVigencia?: (ids: string[]) => Promise<readonly string[] | null>;
  /** `true` mientras no hay ninguna página que pintar (primer viaje al servidor). */
  cargando?: boolean;
  /** Mensaje de error de la carga de la página, ya redactado; `null` si no lo hay. */
  errorCarga?: string | null;
  /** Zona del actor, para el estado legible de la columna. */
  zonaNombre: string | null;
  /** `false` con la bodega bloqueada: no se puede asignar (defensa suave). */
  puedeAsignar: boolean;
  /** Abre el modal de asignación con las órdenes seleccionadas. */
  onAsignar: (ordenes: RecepcionSateliteDTO[]) => void;
  /** Envía a bodega central las órdenes seleccionadas (`por_devolver`). */
  onEnviarACentral: (ordenes: RecepcionSateliteDTO[]) => void;
  /** Recupera a bodega las órdenes seleccionadas (`devuelta`). */
  onRecuperar: (ordenes: RecepcionSateliteDTO[]) => void;
  /**
   * Feature 149 (R35/R37): abre el modal de "Deshacer asignación" con las seleccionadas
   * (`por_recoger`). NO depende de `puedeAsignar`: el cierre de día pendiente de un
   * mensajero bloquea asignar, pero no revertir (Q1 CERRADA, R19).
   */
  onDeshacerAsignacion: (ordenes: RecepcionSateliteDTO[]) => void;
  /** `true` mientras el envío a central está en vuelo (deshabilita el botón). */
  enviandoACentral?: boolean;
  /** `true` mientras la recuperación está en vuelo. */
  recuperando?: boolean;
  /**
   * Feature 158 (R48): `true` si el actor no tiene zona asignada. Sin zona no tiene alcance
   * sobre NADA, así que no se le ofrece reportar incidentes sobre ninguna fila.
   */
  sinZona?: boolean;
  /** Feature 158 (T2.7): qué hacer tras reportar un incidente (el módulo relee del servidor). */
  onIncidenteReportado?: () => void;
}

export function SateliteOrdenesListado({
  ordenes,
  total,
  totalSinFiltros,
  catalogo,
  onFiltroChange,
  obtenerFilasDescarga,
  comprobarVigencia,
  cargando = false,
  errorCarga = null,
  zonaNombre,
  puedeAsignar,
  onAsignar,
  onEnviarACentral,
  onRecuperar,
  onDeshacerAsignacion,
  enviandoACentral = false,
  recuperando = false,
  sinZona = false,
  onIncidenteReportado,
}: Readonly<SateliteOrdenesListadoProps>) {
  const [seleccion, setSeleccion] = useState<FilterSelection>({});
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());

  // R46: las opciones salen del CATÁLOGO del conjunto, no de la página visible. Elegir un
  // cantón tampoco borra los demás del desplegable: el catálogo no depende de la selección.
  const filtros = useMemo(() => construirFiltrosSatelite(catalogo), [catalogo]);

  /** `true` si hay algún filtro marcado (cambia el contador y el mensaje de vacío). */
  const hayFiltros = Object.values(seleccion).some((valores) => valores.length > 0);

  /**
   * Filtrar cambia el CONJUNTO, así que la página que se está viendo puede no existir en el
   * nuevo resultado y las filas marcadas pueden desaparecer de la vista. Se emite el filtro
   * (el módulo vuelve a la página 1) y se limpia la selección: actuar sobre una fila que ya
   * no se ve es actuar a ciegas. Mismo criterio que `OrdenesModule` (feature 144).
   */
  function cambiarFiltros(nueva: FilterSelection) {
    setSeleccion(nueva);
    setSeleccionados(new Set());
    onFiltroChange(seleccionAFiltroSatelite(nueva));
  }

  function toggleUno(id: string, checked: boolean) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleTodos(ids: string[], checked: boolean) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  /**
   * R47 — Seleccionadas REALES: las de la PÁGINA VISIBLE que están marcadas.
   *
   * Antes esto se leía contra el conjunto entero, porque el conjunto entero era lo que se
   * pintaba. Con la tabla paginada, la selección se acota a la página: lo marcado en otra
   * página no se pierde (se recupera al volver), pero NO entra en ninguna acción de lote —
   * actuar sobre una fila que no se está viendo es actuar a ciegas—. Molde: `OrdenesModule`.
   */
  const seleccionadas = useMemo(
    () => ordenes.filter((orden) => seleccionados.has(orden.id)),
    [ordenes, seleccionados],
  );

  /**
   * Q-K7 (deuda de la 170 · FASE 2, T K.3) — marcadas FUERA de la página visible.
   *
   * Es la diferencia entre lo que el usuario ha marcado (`seleccionados`, que sobrevive al
   * cambio de página) y lo que de verdad entra en la acción de lote (`seleccionadas`, sólo
   * las de la página que se está viendo). Hasta ahora esa diferencia existía y NADA la
   * decía: se marcaba en la página 1, se pasaba a la 2 y las marcas seguían ahí, invisibles
   * y sin participar. Se cuenta a partir de los DOS conjuntos que ya gobiernan la selección
   * —no se cambia ni la selección ni la acción, esto es sólo un aviso—.
   */
  const marcadasFuera = seleccionados.size - seleccionadas.length;

  /**
   * Feature 184 — Tanda A (T A.5, R18-R26) — LA PODA de la selección.
   *
   * El aviso de arriba hizo VISIBLE y CONTABLE un hueco que ya existía: la selección
   * sobrevive al cambio de página (a propósito) y se limpia al cambiar los filtros (a
   * propósito), pero NUNCA se limpiaba cuando una orden marcada dejaba de estar en el listado
   * —por ejemplo al reportarle un incidente, que la saca del flujo—. La marca seguía viva,
   * invisible, y el aviso contaba órdenes que ya no existen ahí.
   *
   * Qué hace: tras cada lectura del listado, si hay marcas FUERA de la página visible,
   * pregunta al servidor cuáles siguen en el conjunto filtrado y se queda con
   * `seleccionados ∩ (idsPágina ∪ vigentes)`. La pertenencia la decide el servidor sobre el
   * conjunto entero (R19), nunca la página: por eso una marca de otra página no se pierde por
   * el solo hecho de no verse (R20).
   *
   * Q3 CERRADA (decisión del humano): al podar NO se avisa. La poda corrige un número que
   * estaba mal; el contador simplemente pasa a ser correcto, y un tercer mensaje en una barra
   * que ya dice dos cosas sería ruido — el mismo criterio con el que se decidió el aviso.
   *
   * El disparador es la IDENTIDAD de la página recibida, que cambia una vez por lectura del
   * servidor (navegar, `mutate()` tras una acción, revalidar). La selección se lee de una ref
   * y no de las dependencias, para que podar —que cambia la selección— no encadene otra
   * comprobación (R24).
   */
  const podaRef = useRef({ seleccionados, comprobarVigencia });
  useEffect(() => {
    podaRef.current = { seleccionados, comprobarVigencia };
  });

  useEffect(() => {
    // Sin página que comparar no hay nada que decidir: durante la carga `ordenes` está vacío
    // y todo lo marcado parecería estar fuera (R28: la carga no consulta vigencia).
    if (cargando) return;
    const { comprobarVigencia: comprobar, seleccionados: marcados } = podaRef.current;
    if (!comprobar || marcados.size === 0) return;
    const enPagina = new Set(ordenes.map((orden) => orden.id));
    const fuera = [...marcados].filter((id) => !enPagina.has(id));
    // R23: sin marcas fuera de la vista no hay nada que comprobar — ni una consulta.
    if (fuera.length === 0) return;

    let vigente = true;
    void comprobar(fuera).then((vigentes) => {
      // La respuesta de una página que ya no está a la vista se descarta: `enPagina` sería de
      // otra página y la intersección conservaría lo que no debe.
      if (!vigente || vigentes === null) return; // R22: no se pudo comprobar ⇒ no se poda
      const conservar = new Set(vigentes);
      setSeleccionados((prev) => {
        const podado = new Set(
          [...prev].filter((id) => enPagina.has(id) || conservar.has(id)),
        );
        // R24: si no retira nada, NO se reemplaza el Set. Un Set nuevo equivalente sería un
        // re-render y, con él, una segunda comprobación que no cambia nada.
        return podado.size === prev.size ? prev : podado;
      });
    });
    return () => {
      vigente = false;
    };
  }, [ordenes, cargando]);

  // La acción disponible sale del estado COMÚN de lo seleccionado: con una selección
  // mixta no hay transición única que ofrecer.
  const estadosSeleccionados = new Set(
    seleccionadas.map((orden) => orden.estatusValue),
  );
  const estadoUnico =
    estadosSeleccionados.size === 1 ? [...estadosSeleccionados][0] : null;
  const haySeleccion = seleccionadas.length > 0;

  /**
   * R48 — `true` si hay al menos una orden de ese estado ENTRE LAS SELECCIONADAS.
   *
   * Antes miraba el conjunto a la vista, que era todo el conjunto del actor. Con la tabla
   * paginada eso se rompe en los dos sentidos: un botón dejaría de ofrecerse por estar sus
   * órdenes en otra página, y —lo grave— una acción de lote decidida sobre el contenido del
   * listado puede acabar moviendo paquetes que el usuario no eligió. La decisión se toma
   * sobre lo SELECCIONADO, que es también lo que la acción recibe.
   */
  function hayEstado(estado: string): boolean {
    return seleccionadas.some((orden) => orden.estatusValue === estado);
  }

  // Feature 101 (R8/R10): el resalte por plazo de reasignación solo aplica a las órdenes que
  // ESPERAN reasignación en la bodega (`en_bodega_satelite`). Al juntar los cinco estados en
  // una tabla, una devuelta con `prioridad=true` heredada del DTO habría empezado a resaltar;
  // se neutraliza el flag para el resto de estados, que es lo que ya hacía tener una tabla
  // por grupo. No se toca el DTO original: la copia es solo para pintar.
  const filas = useMemo(
    () =>
      ordenes.map((orden) =>
        orden.estatusValue === ESTADO_ASIGNABLE || !orden.prioridad
          ? orden
          : { ...orden, prioridad: false },
      ),
    [ordenes],
  );

  const columnas = useMemo<Column<RecepcionSateliteDTO>[]>(
    () => [
      {
        id: "seleccionar",
        value: "Seleccionar",
        // R47: "seleccionar todo" marca EXACTAMENTE las filas de la página visible.
        renderHeader: () => {
          const ids = ordenes.map((orden) => orden.id);
          return (
            <SelectAllCheckbox
              selectableIds={ids}
              selectedIds={seleccionados}
              onToggleAll={(checked) => toggleTodos(ids, checked)}
              ariaLabel="Seleccionar todas las órdenes de esta página"
            />
          );
        },
        render: (orden: RecepcionSateliteDTO) => (
          <Checkbox
            checked={seleccionados.has(orden.id)}
            onCheckedChange={(checked) => toggleUno(orden.id, checked === true)}
            aria-label={`Seleccionar ${orden.numRemision}`}
          />
        ),
      },
      // Feature 101/R8: badge "Prioritaria" sobre la primera columna de datos.
      ...conBadgePrioridad(recibidasColumns(zonaNombre)),
      // Feature 158 (T2.7) — «Reportar incidente» POR FILA. Antes vivía en las tablas de
      // «Recibidas» y «Asignadas (por recoger)», las dos únicas cuyo estado es un origen
      // válido; al fundirse las secciones en ESTA tabla la columna se monta siempre y la
      // decisión pasa a ser POR FILA: `puedeReportarIncidenteSatelite` exige estado origen
      // (R41) Y zona del actor (R48), así que una `por_devolver`, una `devuelta` o una de
      // otra zona no pintan disparador —el componente no renderiza nada cuando no está
      // disponible—. Es la única forma posible con una tabla única, y el criterio no se
      // relaja: es el MISMO predicado de antes, sin una segunda copia.
      {
        id: "incidente",
        value: "Incidente",
        render: (orden: RecepcionSateliteDTO) => (
          <ReportarIncidenteAccion
            orden={orden}
            disponible={puedeReportarIncidenteSatelite(orden, zonaNombre, sinZona)}
            onSuccess={onIncidenteReportado}
          />
        ),
      },
    ],
    [seleccionados, zonaNombre, ordenes, sinZona, onIncidenteReportado],
  );

  return (
    <section aria-label={TITULO_BODEGA} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{TITULO_BODEGA}</h2>

      <FilterComponent
        filters={filtros}
        onChange={cambiarFiltros}
        showClearAll
        debounceMs={0}
      />

      {/* Barra de acciones de lote: aparece con la selección y ofrece SOLO la transición
          válida para el estado común de lo seleccionado. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          {haySeleccion
            ? `${seleccionadas.length} seleccionada(s) en esta página${
                estadoUnico === null
                  ? " · estados mezclados"
                  : ` · ${etiquetaEstado(estadoUnico)}`
              }`
            : /* R42: los DOS números son totales del servidor. El de la izquierda responde
                 a los filtros vigentes; el de la derecha es el conjunto del actor. Ninguno
                 sale de las filas de la página, que es lo que R42 prohíbe. */
              hayFiltros
              ? `${total} de ${totalSinFiltros} órdenes`
              : `${total} órdenes`}
          {/* Q-K7 — el aviso de lo marcado en OTRAS páginas.
              Va aquí dentro y en letra menor A PROPÓSITO: la barra ya dice dos cosas (el
              contador/la selección a la izquierda y, si los estados están mezclados, el
              motivo por el que no hay acción a la derecha), y un tercer mensaje al mismo
              nivel estorbaría más de lo que ayuda. Es una coletilla SUBORDINADA a la línea
              de la selección, que es de lo que habla.
              Y sólo aparece cuando hay algo que avisar: si todo lo marcado está a la vista
              no se pinta nada. El número es el de FUERA de la página, no el total marcado:
              decir el total convertiría el aviso en mentira en cuanto se marca una fila de
              la página actual. */}
          {marcadasFuera > 0 ? (
            <span className="mt-0.5 block text-xs">
              Tienes {marcadasFuera} orden(es) marcadas en otras páginas que no
              entran en esta acción.
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* R48: cada acción se ofrece si hay órdenes de su estado SELECCIONADAS, y se
              habilita solo cuando lo seleccionado es todo de ese estado: son transiciones
              distintas y no se mezclan en un mismo lote. Sin nada marcado no se ofrece
              ninguna —no hay nada sobre lo que actuar—. */}
          {hayEstado(ESTADO_ASIGNABLE) ? (
            <Button
              type="button"
              onClick={() => onAsignar(seleccionadas)}
              disabled={estadoUnico !== ESTADO_ASIGNABLE || !puedeAsignar}
            >
              Asignar
            </Button>
          ) : null}
          {/* Feature 149 (R35/R36): solo `por_recoger`. El caso (b)
              (`en_ruta_bodega_satelite`) no llega a este listado —vive en "Por recibir"— y
              es competencia de la bodega central. */}
          {hayEstado(ESTADO_POR_RECOGER) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onDeshacerAsignacion(seleccionadas)}
              disabled={estadoUnico !== ESTADO_POR_RECOGER}
            >
              Deshacer asignación
            </Button>
          ) : null}
          {hayEstado(ESTADO_POR_DEVOLVER) ? (
            <Button
              type="button"
              onClick={() => onEnviarACentral(seleccionadas)}
              disabled={estadoUnico !== ESTADO_POR_DEVOLVER || enviandoACentral}
            >
              {enviandoACentral ? "Enviando…" : "Enviar a central"}
            </Button>
          ) : null}
          {hayEstado(ESTADO_DEVUELTA) ? (
            <Button
              type="button"
              onClick={() => onRecuperar(seleccionadas)}
              disabled={estadoUnico !== ESTADO_DEVUELTA || recuperando}
            >
              {recuperando ? "Recuperando…" : "Recuperar"}
            </Button>
          ) : null}
          {haySeleccion && estadoUnico === null ? (
            <p className="text-sm text-muted-foreground">
              Selecciona órdenes del mismo estado para actuar sobre ellas.
            </p>
          ) : null}
        </div>
      </div>

      <DataTable
        columns={columnas}
        data={filas}
        rowKey="id"
        ariaLabel={TITULO_BODEGA}
        // R52: el control descarga el CONJUNTO con los filtros vigentes; el callback lo baja
        // el módulo. Las columnas del archivo las declara esta tabla (T A.2).
        descarga={{
          titulo: TITULO_BODEGA,
          columnas: COLUMNAS_DESCARGA_SATELITE,
          obtenerFilas: obtenerFilasDescarga,
        }}
        isLoading={cargando}
        error={errorCarga}
        rowClassName={resaltarFilaPrioridad}
        emptyMessage={
          hayFiltros
            ? "Ninguna orden coincide con los filtros."
            : "No hay órdenes en la bodega."
        }
      />
    </section>
  );
}
