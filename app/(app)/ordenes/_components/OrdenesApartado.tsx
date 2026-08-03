"use client";

import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import useSWR from "swr";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { ordenesConfig } from "@/lib/config/ordenes";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "./ordenes-columns";
import { HistorialOrdenSheet } from "./HistorialOrdenSheet";

const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= ordenesConfig.MAX_PAGE_SIZE,
);

export interface OrdenesApartadoProps {
  /** Encabezado visible del apartado (R15/R16). */
  titulo: string;
  /** `value` del estado de catálogo que filtra este apartado (solo para la key de SWR). */
  estatusValue: string;
  /**
   * `estatusId` ya resuelto por el orquestador (`listarCatalogoEstatus`,
   * value→id). `undefined` mientras el catálogo carga: el apartado se muestra
   * en estado de carga y NO dispara `listarOrdenes` (evita filtrar por
   * `estatusId` vacío).
   */
  estatusId: string | undefined;
  /**
   * R17: habilita checkbox por fila + botón de acción. `false` para `admin`
   * (R12-UI, solo-lectura) y para el apartado `por_recoger` (sin
   * acción de este flujo, feature 36 la modela más adelante).
   */
  selectable?: boolean;
  /** R18/R26: etiqueta del botón ("Generar guía" / "Asignar mensajero"). */
  actionLabel?: string;
  /** Se invoca con las órdenes seleccionadas (snapshot) al pulsar el botón. */
  onAction?: (seleccionadas: OrdenListItemDTO[]) => void;
  /**
   * Feature 30/R13: acción secundaria opcional ("Rutear a bodega satélite") que
   * comparte la misma selección por checkbox. Convive con la acción primaria en
   * los apartados de revisión y `en_bodega_central`.
   */
  secondaryActionLabel?: string;
  /** Se invoca con las órdenes seleccionadas (snapshot) al pulsar la acción secundaria. */
  onSecondaryAction?: (seleccionadas: OrdenListItemDTO[]) => void;
  /**
   * Feature 32/R11/R13: acción terciaria opcional ("Imprimir etiquetas") que
   * comparte la misma selección por checkbox. Se añade porque `en_bodega_central` ya usa
   * la primaria ("Asignar mensajero") y la secundaria ("Rutear a bodega
   * satélite"): la terciaria da un tercer slot sin romper los existentes.
   */
  tertiaryActionLabel?: string;
  /** Se invoca con las órdenes seleccionadas (snapshot) al pulsar la acción terciaria. */
  onTertiaryAction?: (seleccionadas: OrdenListItemDTO[]) => void;
  /**
   * Feature 49 (R27/R29): con `true` añade una acción "Ver historial" POR FILA que
   * abre el drawer `HistorialOrdenSheet` (mismo componente/aria-labels que el listado
   * plano de `OrdenesModule`). Es de solo LECTURA (no muta), por lo que se ofrece
   * también cuando el apartado NO es `selectable` y en modo `readOnly` (admin): el
   * maestro/admin ven el historial de cualquier orden (R27). Por defecto `false` para
   * no alterar el contrato de columnas de las superficies que no lo piden.
   */
  mostrarHistorial?: boolean;
}

interface ApartadoPageData {
  items: OrdenListItemDTO[];
  total: number;
  pageSize: number;
}

async function ordenesApartadoFetcher(
  page: number,
  pageSize: number,
  estatusId: string,
): Promise<ApartadoPageData> {
  const res = await listarOrdenes({ page, pageSize, estatusId });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * Apartado de órdenes por estado (feature 17, R15-R18/R26): DataTable (feature
 * 7) + Paginación (feature 8), filtrando `listarOrdenes` por `estatusId`
 * (resuelto por el orquestador desde `value`, design.md §4). Pieza genérica y
 * reutilizada por los 4 apartados de `OrdenesRevisionMaestro`; no conoce a qué
 * acción de dominio corresponde el botón (lo decide el padre vía `onAction`).
 */
export function OrdenesApartado({
  titulo,
  estatusValue,
  estatusId,
  selectable = false,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  tertiaryActionLabel,
  onTertiaryAction,
  mostrarHistorial = false,
}: OrdenesApartadoProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesConfig.DEFAULT_PAGE_SIZE);
  const [seleccionIds, setSeleccionIds] = useState<Set<string>>(new Set());

  const { data, error, isLoading } = useSWR(
    estatusId
      ? (["ordenes:apartado", estatusValue, estatusId, page, pageSize] as const)
      : null,
    () => ordenesApartadoFetcher(page, pageSize, estatusId as string),
  );

  const items = data?.items ?? [];

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

  const columns = useMemo<Column<OrdenListItemDTO>[]>(() => {
    // Columna de selección (R17) SOLO cuando el apartado es seleccionable.
    const base: Column<OrdenListItemDTO>[] = selectable
      ? [
          {
            id: "seleccionar",
            value: "Seleccionar",
            renderHeader: () => {
              const ids = items.map((item) => item.id);
              return (
                <SelectAllCheckbox
                  selectableIds={ids}
                  selectedIds={seleccionIds}
                  onToggleAll={(checked) => toggleTodos(ids, checked)}
                  ariaLabel="Seleccionar todas las órdenes"
                />
              );
            },
            render: (row: OrdenListItemDTO) => (
              <Checkbox
                checked={seleccionIds.has(row.id)}
                onCheckedChange={(checked) =>
                  toggleSeleccion(row.id, checked === true)
                }
                aria-label={`Seleccionar orden ${row.numRemision}`}
              />
            ),
          },
          ...ordenesColumns,
        ]
      : [...ordenesColumns];

    // Feature 49 (R27/R29): acción "Ver historial" por fila. Reusa EXACTAMENTE el
    // montaje del listado plano (`OrdenesModule`): mismo `HistorialOrdenSheet`,
    // mismos aria-labels. Es de solo lectura, por eso convive con la selección y
    // con `readOnly` (admin) sin gatearse por `selectable`.
    if (!mostrarHistorial) return base;
    return [
      ...base,
      {
        id: "acciones",
        value: "Acciones",
        render: (row: OrdenListItemDTO) => (
          <HistorialOrdenSheet ordenId={row.id} referencia={row.numRemision} />
        ),
      },
    ];
  }, [selectable, seleccionIds, mostrarHistorial, items]);

  const seleccionadas = items.filter((item) => seleccionIds.has(item.id));

  function handleAction() {
    if (seleccionadas.length === 0) return;
    onAction?.(seleccionadas);
  }

  function handleSecondaryAction() {
    if (seleccionadas.length === 0) return;
    onSecondaryAction?.(seleccionadas);
  }

  function handleTertiaryAction() {
    if (seleccionadas.length === 0) return;
    onTertiaryAction?.(seleccionadas);
  }

  return (
    <section className="flex flex-col gap-3" aria-label={titulo}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{titulo}</h2>
      </div>
      {/* Acciones de lote: bloque normal en el flujo, encima de la tabla y alineado a
          la derecha. Los botones existen siempre (el apartado seleccionable los
          declara) y se deshabilitan mientras la selección esté vacía. */}
      {selectable &&
      (actionLabel || secondaryActionLabel || tertiaryActionLabel) ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actionLabel ? (
            <Button
              type="button"
              onClick={handleAction}
              disabled={seleccionadas.length === 0}
            >
              {actionLabel}
            </Button>
          ) : null}
          {secondaryActionLabel ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleSecondaryAction}
              disabled={seleccionadas.length === 0}
            >
              {secondaryActionLabel}
            </Button>
          ) : null}
          {tertiaryActionLabel ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleTertiaryAction}
              disabled={seleccionadas.length === 0}
            >
              {tertiaryActionLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={items}
        rowKey="id"
        ariaLabel={titulo}
        isLoading={isLoading || estatusId === undefined}
        error={error ? "No se pudieron cargar las órdenes" : null}
        emptyState={{
          icon: Inbox,
          title: "No hay órdenes",
          description: "Cuando una orden entre en este estado, la verás aquí.",
        }}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading || estatusId === undefined}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        // La revisión del maestro apila VARIOS apartados en una misma pantalla: si cada
        // uno pegara su barra al borde inferior, se amontonarían todas ahí y no se sabría
        // cuál pagina qué. Cada apartado se queda con su pie.
        sticky={false}
      />
    </section>
  );
}
