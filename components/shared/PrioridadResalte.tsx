import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { Column } from "@/components/shared/DataTable";

/**
 * Feature 101 (R8) — resalte de fila para las órdenes PRIORITARIAS (liberadas por
 * el SLA de la 99 y a la espera de reasignación en la bodega dueña). Concentra en
 * un solo módulo compartido las tres piezas del resalte para que las dos
 * superficies de reasignación (apartado `en_bodega_central` de `/ordenes` y grupo
 * "Recibidas" de `/recepcion-satelite`) las reusen idénticas:
 *   1. la CLASE de fondo de la fila (color llamativo, contrast-safe claro/oscuro),
 *   2. el BADGE visible "Prioritaria" (a11y: el estado no se comunica SOLO por color),
 *   3. el DECORADOR de columnas que ancla el badge a la primera celda de datos.
 *
 * El `DataTable` permanece genérico (R1): recibe el mapeo fila→clase por prop y las
 * columnas ya decoradas; no conoce el dominio "prioridad".
 */

/**
 * Clase de fondo de la fila prioritaria. Amber (`warning`) = urgencia/atención, el
 * rol semántico que encaja con "reasignar primero". Alfa `/15` es el mismo valor
 * que usa el soft-badge de `warning` en modo oscuro (token sancionado por el repo):
 * tiñe la fila de forma llamativa sin bajar el contraste del texto (`text-foreground`
 * sobre el tinte queda muy por encima de 4.5:1 en claro y oscuro).
 */
export const PRIORIDAD_RESALTE_CLASS = "bg-warning/15";

/** Texto visible/accesible que anuncia el estado prioritario (no solo color). */
export const PRIORIDAD_LABEL = "Prioritaria";

/**
 * `rowClassName` reutilizable para el `DataTable`: resalta la fila si la orden es
 * prioritaria; `undefined` (sin clase extra) en caso contrario. Tipado sobre
 * cualquier fila que exponga el flag `prioridad?` (OrdenListItemDTO / RecepcionSateliteDTO).
 */
export function resaltarFilaPrioridad<T extends { prioridad?: boolean }>(
  row: T,
): string | undefined {
  return row.prioridad ? PRIORIDAD_RESALTE_CLASS : undefined;
}

/**
 * Badge "Prioritaria". Reusa la primitiva shadcn `Badge` con la variante semántica
 * `warning` (fondo suave + texto `-strong` contrast-safe, con su variante oscura por
 * token). `label` es prop (default en español) para dejar la puerta abierta a i18n.
 */
export function PrioridadBadge({ label = PRIORIDAD_LABEL }: { label?: string } = {}) {
  return <Badge variant="warning">{label}</Badge>;
}

/**
 * Resuelve el contenido de una celda replicando el contrato mínimo de `render` del
 * `DataTable` (función | clave string | clave por defecto `id`), para poder ENVOLVER
 * la celda sin perder su valor original. Se coacciona a texto plano; objetos/booleanos
 * no se muestran (mismo criterio defensivo que `DataTable`).
 */
function resolverCelda<T>(column: Column<T>, row: T): ReactNode {
  const { render, id } = column;
  if (typeof render === "function") return render(row);
  const key = typeof render === "string" ? render : id;
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  return null;
}

/**
 * Decora la PRIMERA columna de datos para anexar el badge "Prioritaria" en las filas
 * prioritarias, SIN alterar las cabeceras ni el resto de columnas (retrocompatible con
 * los tests que fijan la lista exacta de headers). El badge queda en la celda líder de
 * la fila —lugar natural para un marcador de fila— y viaja junto al resalte de fondo.
 * La columna "Seleccionar" (checkbox), si existe, la antepone el consumidor DESPUÉS de
 * decorar, así el badge cae en la primera columna de DATOS, no en el checkbox.
 */
export function conBadgePrioridad<T extends { prioridad?: boolean }>(
  columns: Column<T>[],
): Column<T>[] {
  const [primera, ...resto] = columns;
  if (!primera) return columns;
  return [
    {
      ...primera,
      render: (row: T) => (
        <span className="inline-flex items-center gap-2">
          <span>{resolverCelda(primera, row)}</span>
          {row.prioridad ? <PrioridadBadge /> : null}
        </span>
      ),
    },
    ...resto,
  ];
}
