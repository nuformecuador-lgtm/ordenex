"use client";

import { DataTable, type Column } from "@/components/shared/DataTable";
import type { OrdenExistente } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";

export interface OrdenesExistentesTablaProps {
  /** Órdenes ya existentes (filas `duplicada` del `BulkSummary`), R4/R5. */
  existentes: OrdenExistente[];
}

/**
 * Feature 29 — Sección de SOLO LECTURA de órdenes ya existentes (R4, R5, R6).
 * Muestra `numRemision` + estado como etiqueta legible (R17). Sin `Select`, sin
 * botones ni acción de recarga: las existentes no se re-insertan (R6).
 */
export function OrdenesExistentesTabla({ existentes }: OrdenesExistentesTablaProps) {
  const columns: Column<OrdenExistente>[] = [
    { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
    {
      id: "estatus",
      value: "Estado actual",
      render: (row) => estatusLabel(row.estatus),
    },
  ];

  return (
    <section className="flex flex-col gap-2" aria-labelledby="ordenes-existentes-heading">
      <h3 id="ordenes-existentes-heading" className="text-sm font-medium">
        Órdenes ya existentes
      </h3>
      <DataTable<OrdenExistente>
        columns={columns}
        data={existentes}
        rowKey="numRemision"
        ariaLabel="Órdenes ya existentes"
      />
    </section>
  );
}
