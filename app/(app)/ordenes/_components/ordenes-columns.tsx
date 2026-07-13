import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { EstatusBadge } from "./EstatusBadge";

/**
 * Columnas concretas de `/ordenes` (R17, R24). La tabla genérica NO conoce el
 * dominio orden: estas columnas viven junto a la página.
 *
 * Se ejercita el contrato completo de `render` (R6/R7/R8):
 *  - `numGuia`: `render` función → "Pendiente" si `null` (feature 17/R30: la
 *    guía se asigna en "Generar guía", no al crear la orden; una orden aún sin
 *    guía se lista mostrándola como pendiente en vez de vacío/null crudo).
 *  - `numRemision`: `render` string/clave → `row.numRemision` (R7).
 *  - `estatus`: `render` función → `estatusValue ?? estatusId` (R6). Su `id` no es
 *    campo del DTO, por eso requiere función. Feature 30/R15: pasa `zonaNombre`
 *    de la fila para que `en_ruta_bodega_satelite` se lea "En ruta a bodega <zona>".
 *  - `destinatario`: sin `render` → celda por `column.id` (R8).
 *  - `tienda`: `render` función → `row.tiendaNombre`, nombre legible NO el uuid
 *    `tiendaId` (R24). Su `id` no es campo del DTO.
 *  - `zona`: feature 30/R14 → `row.zonaNombre`, nombre legible de la zona de la
 *    orden (derivado de `orden.zonaId`); "—" defensivo si el DTO no lo trae.
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
      <EstatusBadge
        value={row.estatusValue ?? row.estatusId}
        zonaNombre={row.zonaNombre}
      />
    ),
  },
  { id: "destinatario", value: "Destinatario" },
  { id: "tienda", value: "Tienda", render: (row) => row.tiendaNombre },
  { id: "zona", value: "Zona", render: (row) => row.zonaNombre ?? "—" },
];
