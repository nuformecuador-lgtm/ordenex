"use client";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import { formatErrores } from "@/app/(app)/ordenes/_components/carga-masiva-errores-formato";

// Feature 143: `formatErrores` se mudó a un módulo puro para compartirla con el
// export de filas con error (que no puede depender de un componente cliente). Se
// re-exporta aquí para no romper a los consumidores/tests que la importaban
// desde este archivo.
export { formatErrores };

export interface OrdenesConErrorTablaProps {
  /** Filas con `resultado === "error"` del `BulkSummary` (R18, R19). */
  errores: OrdenConError[];
}

/**
 * Feature 29 — Sección de SOLO LECTURA de órdenes con error (R18, R19). Lista
 * cada fila con su `fila`/`numRemision` y su motivo legible. Sin acciones de
 * recarga/reintento.
 */
export function OrdenesConErrorTabla({ errores }: OrdenesConErrorTablaProps) {
  const columns: Column<OrdenConError>[] = [
    {
      id: "fila",
      value: "Fila",
      render: (row) => (row.fila != null ? String(row.fila) : "—"),
    },
    {
      id: "numRemision",
      value: "Nº Remisión",
      render: (row) => row.numRemision || "—",
      minWidth: "120px",
    },
    {
      id: "motivo",
      value: "Motivo",
      render: (row) => formatErrores(row.errores),
    },
  ];

  return (
    <section className="flex flex-col gap-2" aria-labelledby="ordenes-error-heading">
      <Alert variant="destructive">
        <AlertDescription>
          <span id="ordenes-error-heading" className="font-medium">
            Órdenes con error
          </span>
        </AlertDescription>
      </Alert>
      <DataTable<OrdenConError>
        columns={columns}
        data={errores}
        rowKey={(row) => `${row.fila}-${row.numRemision}`}
        ariaLabel="Órdenes con error"
      />
    </section>
  );
}
