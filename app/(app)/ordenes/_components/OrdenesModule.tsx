"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { ordenesConfig } from "@/lib/config/ordenes";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "./ordenes-columns";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";
import { HistorialOrdenSheet } from "./HistorialOrdenSheet";
import { EtiquetaOrdenAccion } from "./EtiquetaOrdenAccion";

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
} = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesConfig.DEFAULT_PAGE_SIZE);

  const columnasEfectivas = useMemo<Column<OrdenListItemDTO>[]>(() => {
    if (!mostrarHistorial) return columns;
    return [
      ...columns,
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
  }, [columns, mostrarHistorial]);

  // Feature 63/C2 (R17): el `status_id` entra en la key SWR para que la caché y
  // la paginación sean por-tab. Sin `filter`, `statusId` es `undefined`.
  const statusId = filter?.status_id;
  const { data, error, isLoading } = useSWR(
    ["ordenes:list", statusId, page, pageSize],
    () => ordenesFetcher(page, pageSize, filter),
  );

  return (
    <section className="flex flex-col gap-4">
      {puedeCargarMasiva && (
        <div className="flex justify-end">
          <OrdenesCargaMasivaButton />
        </div>
      )}
      <DataTable
        columns={columnasEfectivas}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Órdenes"
        isLoading={isLoading}
        error={error ? "No se pudieron cargar las órdenes" : null}
        emptyMessage="No hay órdenes"
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
