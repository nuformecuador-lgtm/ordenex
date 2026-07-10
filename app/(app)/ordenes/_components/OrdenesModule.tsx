"use client";

import { useState } from "react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { ordenesConfig } from "@/lib/config/ordenes";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "./ordenes-columns";
import { OrdenesCargaMasivaButton } from "./OrdenesCargaMasivaButton";

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
): Promise<OrdenesPageData> {
  const res = await listarOrdenes({ page, pageSize });
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
 */
export function OrdenesModule({
  columns = ordenesColumns,
}: {
  columns?: Column<OrdenListItemDTO>[];
} = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ordenesConfig.DEFAULT_PAGE_SIZE);

  const { data, error, isLoading } = useSWR(
    ["ordenes:list", page, pageSize],
    () => ordenesFetcher(page, pageSize),
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <OrdenesCargaMasivaButton />
      </div>
      <DataTable
        columns={columns}
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
