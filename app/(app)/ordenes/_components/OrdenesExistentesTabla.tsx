"use client";

import { DataTable, type Column } from "@/components/shared/DataTable";
import type { OrdenExistente } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";

export interface OrdenesExistentesTablaProps {
  /** Órdenes ya existentes (filas `duplicada` del `BulkSummary`), R4/R5. */
  existentes: OrdenExistente[];
}

/**
 * Feature 29 — Sección de SOLO LECTURA de órdenes ya existentes (R4, R5, R6).
 * Muestra `numRemision` + estado como el chip del listado (R17). Sin `Select`, sin
 * botones ni acción de recarga: las existentes no se re-insertan (R6).
 */
export function OrdenesExistentesTabla({ existentes }: OrdenesExistentesTablaProps) {
  const columns: Column<OrdenExistente>[] = [
    {
      id: "numRemision",
      value: "Nº Remisión",
      render: "numRemision",
      minWidth: "120px",
    },
    {
      id: "estatus",
      value: "Estado actual",
      // La etiqueta ya era legible (R17), pero en texto plano: el chip del listado
      // añade el color semántico sin cambiar el texto. `estatus` es nullable, y el
      // guion del caso vacío se conserva (lo daba `estatusLabel`, ahora explícito).
      // Sin `zonaNombre`: `OrdenExistente` no lo trae, así que `en_ruta_bodega_satelite`
      // cae a su etiqueta genérica en vez de nombrar la bodega.
      render: (row) => (row.estatus ? <EstatusBadge value={row.estatus} /> : "—"),
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
