import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";

/**
 * Columnas del módulo de órdenes para el dashboard del `adminTienda` (feature 26,
 * R11). Derivan de `ordenesColumns` (única fuente de verdad de columnas) quitando
 * la entrada `id: "tienda"`: todas las órdenes pertenecen a la misma tienda, así
 * que el nombre de tienda es redundante. También se omite `id: "zona"` (feature
 * 30/R14): la columna de zona es un concern del LISTADO DEL MAESTRO, no del
 * dashboard de la tienda, cuyo contrato de presentación son estas 4 columnas. No
 * se muta `ordenes-columns.tsx`, que sigue sirviendo a `/ordenes` con la columna
 * de zona incluida.
 */
export const ordenesColumnsAdminTienda: Column<OrdenListItemDTO>[] =
  ordenesColumns.filter(
    (column) => column.id !== "tienda" && column.id !== "zona",
  );
