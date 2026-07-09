"use client";

import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "./_components/ordenes-columns";

async function ordenesFetcher(): Promise<OrdenListItemDTO[]> {
  const res = await listarOrdenes({});
  if (res.status !== "ok") throw new Error("list_failed");
  return res.items; // items incluyen tiendaNombre (R24/R26)
}

export default function OrdenesPage() {
  const { data, error, isLoading } = useSWR<OrdenListItemDTO[]>(
    "ordenes:list",
    ordenesFetcher,
  );

  return (
    <DataTable
      columns={ordenesColumns}
      data={data ?? []}
      rowKey="id"
      ariaLabel="Órdenes"
      isLoading={isLoading}
      error={error ? "No se pudieron cargar las órdenes" : null}
      emptyMessage="No hay órdenes"
    />
  );
}
