"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataTable,
  type Column,
  type DataTableDescarga,
} from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import {
  FilterComponent,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import {
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { normalizeName } from "@/lib/utils/normalize";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 158 (T2.7, decisión del humano del 2026-07-30): el reporte de incidente también
// vive en la bodega satélite. Se IMPORTA el mismo disparador y el mismo modal de `/ordenes`;
// esta superficie sólo aporta SU regla de disponibilidad (alcance por zona, R48).
import { ReportarIncidenteAccion } from "@/app/(app)/ordenes/_components/ReportarIncidenteAccion";
import { puedeReportarIncidenteSatelite } from "./incidente-satelite";
import { recibidasColumns } from "./recibidas-columns";
import {
  COLUMNAS_DESCARGA_SATELITE,
  filaDescargaSatelite,
} from "./satelite-descarga-columnas";
import {
  CLAVE_CANTON,
  CLAVE_DISTRITO,
  CLAVE_ESTADO,
  construirFiltrosSatelite,
  etiquetaEstado,
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
// Todo el filtrado es de CLIENTE sobre las órdenes que ya llegan por props (el service ya
// las acotó a la zona del actor); esta pantalla no consulta nada por su cuenta.

/**
 * Feature 170 (T A.2) — título del dataset: nombre de la hoja, base del nombre de archivo
 * (`ordenes-de-la-bodega-YYYY-MM-DD.xlsx`, R12) y parte del nombre accesible del control
 * (R13). Es el mismo encabezado que la pantalla muestra.
 */
const TITULO_DESCARGA = "Órdenes de la bodega";

/** Estados sobre los que cada acción de lote es válida. */
const ESTADO_ASIGNABLE = "en_bodega_satelite";
/** Feature 149 (R35): asignada a un mensajero que aún NO la recogió; la asignación se deshace. */
const ESTADO_POR_RECOGER = "por_recoger";
const ESTADO_POR_DEVOLVER = "por_devolver";
const ESTADO_DEVUELTA = "devuelta";

export interface SateliteOrdenesListadoProps {
  /** Órdenes de los cuatro grupos, ya unidas por el módulo. */
  ordenes: RecepcionSateliteDTO[];
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

  // Opciones derivadas del conjunto COMPLETO cargado: elegir un cantón no debe borrar
  // los demás del desplegable.
  const filtros = useMemo(() => construirFiltrosSatelite(ordenes), [ordenes]);

  // Filtro compuesto en AND: estado ∧ cantón ∧ distrito. Una lista vacía en cualquiera de
  // los tres desplegables significa "todos" (no filtra). Las tres selecciones se leen
  // DENTRO del memo: hacerlo fuera con `?? []` crearía un array nuevo en cada render y el
  // memo no memoizaría nada.
  const visibles = useMemo(() => {
    const estadosElegidos = seleccion[CLAVE_ESTADO] ?? [];
    const cantonesElegidos = seleccion[CLAVE_CANTON] ?? [];
    const distritosElegidos = seleccion[CLAVE_DISTRITO] ?? [];
    const cantones = new Set(cantonesElegidos.map(normalizeName));
    const distritos = new Set(distritosElegidos.map(normalizeName));
    return ordenes.filter((orden) => {
      if (
        estadosElegidos.length > 0 &&
        !estadosElegidos.includes(orden.estatusValue)
      ) {
        return false;
      }
      if (
        cantones.size > 0 &&
        !cantones.has(normalizeName(orden.cantonNombre))
      ) {
        return false;
      }
      if (distritos.size > 0) {
        if (orden.distritoNombre === null) return false;
        if (!distritos.has(normalizeName(orden.distritoNombre))) return false;
      }
      return true;
    });
  }, [ordenes, seleccion]);

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

  // Seleccionadas REALES: las que siguen visibles tras filtrar. Filtrar no debe dejar
  // seleccionada a una orden que ya no se ve (se actuaría a ciegas sobre ella).
  const seleccionadas = useMemo(
    () => visibles.filter((orden) => seleccionados.has(orden.id)),
    [visibles, seleccionados],
  );

  // La acción disponible sale del estado COMÚN de lo seleccionado: con una selección
  // mixta no hay transición única que ofrecer.
  const estadosSeleccionados = new Set(
    seleccionadas.map((orden) => orden.estatusValue),
  );
  const estadoUnico =
    estadosSeleccionados.size === 1 ? [...estadosSeleccionados][0] : null;
  const haySeleccion = seleccionadas.length > 0;

  /** `true` si hay al menos una orden de ese estado a la vista (tras filtrar). */
  function hayEstado(estado: string): boolean {
    return visibles.some((orden) => orden.estatusValue === estado);
  }

  // Feature 101 (R8/R10): el resalte por SLA solo aplica a las órdenes que ESPERAN
  // reasignación en la bodega (`en_bodega_satelite`). Al juntar los cuatro estados en una
  // tabla, una devuelta con `prioridad=true` heredada del DTO habría empezado a resaltar;
  // se neutraliza el flag para el resto de estados, que es lo que ya hacía tener una tabla
  // por grupo. No se toca el DTO original: la copia es solo para pintar.
  const filas = useMemo(
    () =>
      visibles.map((orden) =>
        orden.estatusValue === ESTADO_ASIGNABLE || !orden.prioridad
          ? orden
          : { ...orden, prioridad: false },
      ),
    [visibles],
  );

  const columnas = useMemo<Column<RecepcionSateliteDTO>[]>(
    () => [
      {
        id: "seleccionar",
        value: "Seleccionar",
        renderHeader: () => {
          const ids = visibles.map((orden) => orden.id);
          return (
            <SelectAllCheckbox
              selectableIds={ids}
              selectedIds={seleccionados}
              onToggleAll={(checked) => toggleTodos(ids, checked)}
              ariaLabel="Seleccionar todas las órdenes"
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
    [seleccionados, zonaNombre, visibles, sinZona, onIncidenteReportado],
  );

  /**
   * Feature 170 (T A.2, R1/R10/R30/R32) — descarga de lo que la bodega tiene a la vista.
   *
   * Familia B: el dataset completo YA está en el cliente (el servicio lo entregó por
   * props, acotado a la zona del actor), así que `obtenerFilas` NO llama a nada. Proyecta
   * `filas`, que es EXACTAMENTE el array que el `DataTable` está pintando: ya pasado por
   * los tres filtros de cliente (estado ∧ cantón ∧ distrito) y en el mismo orden. De ahí
   * salen a la vez R10 (filtros vigentes) y R30/R32 (ni una lectura extra).
   *
   * Se construye EN EL RENDER: el closure lee las filas de ESTE render.
   */
  const descarga: DataTableDescarga = {
    titulo: TITULO_DESCARGA,
    columnas: COLUMNAS_DESCARGA_SATELITE,
    obtenerFilas: () => filasLocales(filas, filaDescargaSatelite),
  };

  return (
    <section aria-label="Órdenes de la bodega" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Órdenes de la bodega</h2>

      <FilterComponent
        filters={filtros}
        onChange={setSeleccion}
        showClearAll
        debounceMs={0}
      />

      {/* Barra de acciones de lote: aparece con la selección y ofrece SOLO la transición
          válida para el estado común de lo seleccionado. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm text-muted-foreground">
          {haySeleccion
            ? `${seleccionadas.length} seleccionada(s)${
                estadoUnico === null
                  ? " · estados mezclados"
                  : ` · ${etiquetaEstado(estadoUnico)}`
              }`
            : `${visibles.length} de ${ordenes.length} órdenes`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Cada acción se OFRECE si hay órdenes de su estado a la vista (así el operador
              ve qué puede hacer aquí) y se HABILITA solo cuando lo seleccionado es todo de
              ese estado: son transiciones distintas y no se mezclan en un mismo lote. */}
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
        ariaLabel="Órdenes de la bodega"
        descarga={descarga}
        rowClassName={resaltarFilaPrioridad}
        emptyMessage={
          ordenes.length === 0
            ? "No hay órdenes en la bodega."
            : "Ninguna orden coincide con los filtros."
        }
      />
    </section>
  );
}
