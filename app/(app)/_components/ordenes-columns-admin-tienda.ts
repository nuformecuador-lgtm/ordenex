import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";

/**
 * Columnas del módulo de órdenes para el dashboard del `adminTienda` (feature 26,
 * R11). Derivan de `ordenesColumns` (única fuente de verdad de columnas) quitando
 * la entrada `id: "tienda"`: todas las órdenes pertenecen a la misma tienda, así
 * que el nombre de tienda es redundante. Quedan 4 columnas. No se muta
 * `ordenes-columns.tsx`, que sigue sirviendo a `/ordenes` con las 5 columnas.
 */
export const ordenesColumnsAdminTienda: Column<OrdenListItemDTO>[] =
  ordenesColumns.filter((column) => column.id !== "tienda");
