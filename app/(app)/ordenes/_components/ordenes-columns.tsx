import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { EstatusBadge } from "./EstatusBadge";

/**
 * Columnas concretas de `/ordenes` (R17, R24). Exactamente 5, en orden. La tabla
 * genérica NO conoce el dominio orden: estas columnas viven junto a la página.
 *
 * Se ejercita el contrato completo de `render` (R6/R7/R8):
 *  - `numGuia`: `render` función → "Pendiente" si `null` (feature 17/R30: la
 *    guía se asigna en "Generar guía", no al crear la orden; una orden aún sin
 *    guía se lista mostrándola como pendiente en vez de vacío/null crudo).
 *  - `numRemision`: `render` string/clave → `row.numRemision` (R7).
 *  - `estatus`: `render` función → `estatusValue ?? estatusId` (R6). Su `id` no es
 *    campo del DTO, por eso requiere función.
 *  - `destinatario`: sin `render` → celda por `column.id` (R8).
 *  - `tienda`: `render` función → `row.tiendaNombre`, nombre legible NO el uuid
 *    `tiendaId` (R24). Su `id` no es campo del DTO.
 */
export const ordenesColumns: Column<OrdenListItemDTO>[] = [
  {
    id: "numGuia",
    value: "Nº Guía",
    render: (row) => (row.numGuia === null ? "Pendiente" : row.numGuia),
  },
  { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
  {
    id: "estatus",
    value: "Estatus",
    render: (row) => (
      <EstatusBadge value={row.estatusValue ?? row.estatusId} />
    ),
  },
  { id: "destinatario", value: "Destinatario" },
  { id: "tienda", value: "Tienda", render: (row) => row.tiendaNombre },
];
