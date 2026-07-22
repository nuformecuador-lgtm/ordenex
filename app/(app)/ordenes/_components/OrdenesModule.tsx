"use client";

import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import {
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { ordenesConfig } from "@/lib/config/ordenes";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "./ordenes-columns";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { HistorialOrdenSheet } from "./HistorialOrdenSheet";
import { EtiquetaOrdenAccion } from "./EtiquetaOrdenAccion";

/**
 * Acción por lote ofrecida en la barra contextual cuando hay filas seleccionadas.
 * `onRun` recibe el snapshot de las órdenes marcadas (el orquestador decide el modal
 * y el filtrado por zona). El estado (tab) decide qué acciones aplican.
 */
export interface AccionLote {
  key: string;
  label: string;
  variant?: "default" | "outline";
  onRun: (seleccionadas: OrdenListItemDTO[]) => void;
}

// R33: opciones firmes acotadas por MAX_PAGE_SIZE del backend; ninguna opción
// ofrecida supera el máximo permitido.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= ordenesConfig.MAX_PAGE_SIZE,
);

interface OrdenesPageData {
  items: OrdenListItemDTO[];
  total: number;
  pageSize: number;
}

async function ordenesFetcher(
  page: number,
  pageSize: number,
  filter?: { status_id: string },
): Promise<OrdenesPageData> {
  // Feature 63/C2 (R15/R19): con `filter` se inyecta el `status_id` a la action
  // (whitelist server-side -> where.estatusId). Sin `filter`, el input es
  // idéntico al previo (R10, sin regresión).
  const res = await listarOrdenes(filter ? { page, pageSize, filter } : { page, pageSize });
  if (res.status !== "ok") throw new Error("list_failed");
  // items incluyen tiendaNombre; total viene del backend (R25).
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * Módulo de órdenes reutilizable: tabla + paginación + carga masiva sobre la
 * action `listarOrdenes` (SWR). Única implementación de tabla/fetch (feature 26,
 * R10). La prop `columns` es de presentación: por defecto muestra las 5 columnas
 * de `/ordenes`; el dashboard del admin de tienda la sustituye por la variante
 * sin "Tienda" (R11). Sin la prop, el comportamiento es idéntico al `/ordenes`
 * previo.
 *
 * Feature 49 (T6.2, R28/R29): con `mostrarHistorial` se añade una columna de acción
 * "Ver historial" por fila que abre el drawer `HistorialOrdenSheet` (datos por props via
 * Server Action). Por defecto `false` para NO alterar el contrato de columnas de otras
 * superficies (p. ej. el dashboard del adminTienda, feature 26).
 */
export function OrdenesModule({
  columns = ordenesColumns,
  puedeCargarMasiva = false,
  mostrarHistorial = false,
  filter,
  selectable = false,
  bloqueoSeleccion,
  acciones,
  resaltarPrioridad = false,
}: {
  columns?: Column<OrdenListItemDTO>[];
  puedeCargarMasiva?: boolean;
  mostrarHistorial?: boolean;
  /**
   * Feature 63/C2 (R15): filtro opcional por estado de orden. Se inyecta a
   * `listarOrdenes` y entra en la key SWR, de modo que cada estado (tab) tiene
   * su propia caché y paginación independiente (R17). Sin la prop, el módulo se
   * comporta idéntico al listado plano previo (R10/R19, sin regresión).
   */
  filter?: { status_id: string };
  /** Habilita la columna de checkbox por fila (selección por lote, solo maestro). */
  selectable?: boolean;
  /**
   * Predicado de bloqueo por fila: devuelve el MOTIVO (texto) si la orden NO puede
   * seleccionarse, o `null` si sí. Cuando devuelve motivo, el checkbox se deshabilita
   * y el texto va en su tooltip. Se usa cuando una acción del estado no aplica a
   * todas las filas (p. ej. la tab `rechazada`: la bodega central solo devuelve a la
   * tienda las órdenes de su zona; las satélite las devuelve el adminSatelite). Sin
   * el predicado, todas las filas son seleccionables.
   */
  bloqueoSeleccion?: (row: OrdenListItemDTO) => string | null;
  /**
   * Acciones por lote disponibles para este listado/estado. Se muestran en una barra
   * contextual SOLO cuando hay ≥1 fila marcada. Sin acciones o sin selección, no se
   * muestra la barra. La columna de checkbox depende de `selectable`.
   */
  acciones?: AccionLote[];
  /**
   * Feature 101/R8: resalta las filas de órdenes con `prioridad === true` (color
   * llamativo + badge "Prioritaria" accesible). Se activa SOLO en la superficie de
   * reasignación de la bodega dueña (apartado `en_bodega` de `/ordenes`, gateado por
   * `OrdenesTabs`); por defecto `false`, de modo que el resto de listados (otras tabs,
   * "Todas", dashboard adminTienda, listado plano) no resaltan por prioridad (R10).
   */
  resaltarPrioridad?: boolean;
} = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesConfig.DEFAULT_PAGE_SIZE);
  const [seleccionIds, setSeleccionIds] = useState<Set<string>>(new Set());

  function toggleSeleccion(id: string, checked: boolean) {
    setSeleccionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleTodos(ids: string[], checked: boolean) {
    setSeleccionIds((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Feature 63/C2 (R17): el `status_id` entra en la key SWR para que la caché y
  // la paginación sean por-tab. Sin `filter`, `statusId` es `undefined`.
  const statusId = filter?.status_id;
  const { data, error, isLoading } = useSWR(
    ["ordenes:list", statusId, page, pageSize],
    () => ordenesFetcher(page, pageSize, filter),
  );

  const items = data?.items ?? [];

  const columnasEfectivas = useMemo<Column<OrdenListItemDTO>[]>(() => {
    // Feature 101/R8: en la superficie de reasignación (`en_bodega`) las columnas de
    // DATOS se decoran para anexar el badge "Prioritaria" a las filas prioritarias.
    // Se decora ANTES de anteponer el checkbox, así el badge cae en la primera columna
    // de datos (Nº Guía), no en la de selección. Sin `resaltarPrioridad`, sin cambio.
    const columnasDatos = resaltarPrioridad ? conBadgePrioridad(columns) : columns;
    // Columna de selección (checkbox) al frente cuando el listado es seleccionable.
    const conSeleccion: Column<OrdenListItemDTO>[] = selectable
      ? [
          {
            id: "seleccionar",
            value: "Seleccionar",
            // Cabecera = checkbox "seleccionar todo" sobre las filas SELECCIONABLES de la
            // página (excluye las bloqueadas por `bloqueoSeleccion`, que no se pueden marcar).
            renderHeader: () => {
              const ids = items
                .filter((row) => (bloqueoSeleccion?.(row) ?? null) === null)
                .map((row) => row.id);
              return (
                <SelectAllCheckbox
                  selectableIds={ids}
                  selectedIds={seleccionIds}
                  onToggleAll={(checked) => toggleTodos(ids, checked)}
                  ariaLabel="Seleccionar todas las órdenes"
                />
              );
            },
            render: (row) => {
              // Motivo de bloqueo (o null): deshabilita el checkbox y lo explica en
              // el tooltip, en vez de dejar seleccionar una orden que la acción del
              // estado va a descartar (lo que dejaba el modal vacío/"bloqueado").
              const motivo = bloqueoSeleccion?.(row) ?? null;
              return (
                <Checkbox
                  checked={seleccionIds.has(row.id)}
                  disabled={motivo !== null}
                  onCheckedChange={(checked) =>
                    toggleSeleccion(row.id, checked === true)
                  }
                  aria-label={
                    motivo
                      ? `No se puede seleccionar la orden ${row.numRemision}: ${motivo}`
                      : `Seleccionar orden ${row.numRemision}`
                  }
                  title={motivo ?? undefined}
                />
              );
            },
          },
          ...columnasDatos,
        ]
      : columnasDatos;

    if (!mostrarHistorial) return conSeleccion;
    return [
      ...conSeleccion,
      {
        id: "acciones",
        value: "Acciones",
        // Acciones por fila del listado: ver historial (drawer) + ver etiqueta
        // (vista previa de QR + datos y descarga del PDF 100×100 mm, feature 32).
        render: (row) => (
          <div className="flex items-center gap-1">
            <HistorialOrdenSheet ordenId={row.id} referencia={row.numRemision} />
            <EtiquetaOrdenAccion orden={row} />
          </div>
        ),
      },
    ];
  }, [columns, mostrarHistorial, selectable, seleccionIds, bloqueoSeleccion, items, resaltarPrioridad]);

  // Snapshot de las filas marcadas PRESENTES en la página actual (la selección se
  // acota a lo visible, como en la vista de revisión previa).
  const seleccionadas = items.filter((item) => seleccionIds.has(item.id));
  const hayAcciones = selectable && !!acciones?.length && seleccionadas.length > 0;

  return (
    <section className="flex flex-col gap-4">
      {puedeCargarMasiva && (
        <div className="flex justify-end">
          <OrdenesCargaMasivaButton />
        </div>
      )}

      {/* Barra de acciones por lote ("tool"): aparece SOLO con filas marcadas. */}
      {hayAcciones ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5 shadow-sm">
          <span className="text-sm font-medium">
            {seleccionadas.length} seleccionada
            {seleccionadas.length === 1 ? "" : "s"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {acciones!.map((accion) => (
              <Button
                key={accion.key}
                type="button"
                size="sm"
                variant={accion.variant ?? "default"}
                onClick={() => accion.onRun(seleccionadas)}
              >
                {accion.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSeleccionIds(new Set())}
          >
            Limpiar
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columnasEfectivas}
        data={items}
        rowKey="id"
        ariaLabel="Órdenes"
        rowClassName={resaltarPrioridad ? resaltarFilaPrioridad : undefined}
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las órdenes" : null}
        emptyState={{
          icon: Inbox,
          title: "No hay órdenes",
          description: "Cuando lleguen órdenes, aparecerán aquí.",
        }}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />
    </section>
  );
}
