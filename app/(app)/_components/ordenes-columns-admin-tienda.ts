import type { Column } from "@/components/shared/DataTable";
import type { OrdenListItemDTO } from "@/lib/types/orden";

import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";

/**
 * Columnas ocultas en el dashboard del `adminTienda`. Solo se omiten `tienda` y
 * `zona`: todas las órdenes son de la misma tienda (nombre redundante) y la zona
 * es un concern del LISTADO DEL MAESTRO (feature 26/R11, 30/R14). El resto de
 * columnas del listado del maestro —incluidas geografía y mensajero, resueltas por
 * la nueva estructura de respuesta— se muestran igual, independientes del rol.
 */
const COLUMNAS_OCULTAS_ADMIN_TIENDA = new Set(["tienda", "zona"]);

/**
 * Columnas del módulo de órdenes para el dashboard del `adminTienda` (feature 26,
 * R11). Derivan de `ordenesColumns` (única fuente de verdad de columnas) quitando
 * las columnas ocultas. No se muta `ordenes-columns.tsx`, que sigue sirviendo a
 * `/ordenes` con todas las columnas del listado del maestro.
 */
export const ordenesColumnsAdminTienda: Column<OrdenListItemDTO>[] =
  ordenesColumns.filter((column) => !COLUMNAS_OCULTAS_ADMIN_TIENDA.has(column.id));
