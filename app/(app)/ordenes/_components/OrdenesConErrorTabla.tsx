"use client";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

export interface OrdenesConErrorTablaProps {
  /** Filas con `resultado === "error"` del `BulkSummary` (R18, R19). */
  errores: OrdenConError[];
}

/** Motivo genérico cuando la fila no trae detalle de errores (R19). */
const MOTIVO_GENERICO = "Error de validación";

/**
 * Aplana el mapa `campo → mensajes[]` a un texto legible, p. ej.
 * "num_remision: obligatorio; telefono: formato inválido" (R19). Si el mapa está
 * vacío (o sus entradas no aportan mensaje), devuelve un motivo genérico.
 */
export function formatErrores(errores: Record<string, string[]>): string {
  const partes: string[] = [];
  for (const [campo, mensajes] of Object.entries(errores)) {
    if (mensajes.length > 0) {
      partes.push(`${campo}: ${mensajes.join(", ")}`);
    }
  }
  return partes.length > 0 ? partes.join("; ") : MOTIVO_GENERICO;
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
