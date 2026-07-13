"use client";

import { isValidElement, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Definición de una columna de la tabla genérica.
 *
 * `render` admite tres formas (contrato R3):
 *  - función `(row) => ReactNode`: contenido custom (R6).
 *  - string / `keyof T`: clave de acceso al dato de la fila, `row[render]` (R7).
 *  - ausente/undefined: valor por la clave por defecto `column.id`, `row[id]` (R8).
 */
export interface Column<T> {
  /** Identificador único de columna. También clave de acceso por defecto y key de React. */
  id: string;
  /** Etiqueta de cabecera mostrada en el `<th scope="col">`. */
  value: string;
  /** Cómo renderizar la celda. Ver descripción del contrato arriba. */
  render?: ((row: T) => ReactNode) | keyof T | string;
  /** Ancho fijo de la columna (px o cualquier unidad CSS). */
  width?: number | string;
  /** Ancho mínimo de la columna (px o cualquier unidad CSS). */
  minWidth?: number | string;
  /** Ancho máximo de la columna (px o cualquier unidad CSS). */
  maxWidth?: number | string;
}

/** Deriva los estilos de ancho de una columna (width/minWidth/maxWidth). */
function columnWidthStyle<T>(column: Column<T>): CSSProperties | undefined {
  const { width, minWidth, maxWidth } = column;
  if (width === undefined && minWidth === undefined && maxWidth === undefined) {
    return undefined;
  }
  return { width, minWidth, maxWidth };
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /**
   * Origen de la key de fila. Por defecto usa `row.id`; si no existe, el índice.
   * Nunca usa el índice cuando hay un identificador de fila disponible.
   */
  rowKey?: keyof T | ((row: T) => string);
  /** Texto del `<caption>` de la tabla (R14). También da nombre accesible (R16). */
  caption?: string;
  /** Nombre accesible cuando no se usa `caption` (R16). */
  ariaLabel?: string;
  /** Estado de carga (R12). */
  isLoading?: boolean;
  /** Mensaje de error ya saneado por el consumidor (R13). */
  error?: string | null;
  /** Mensaje del estado vacío (R11). */
  emptyMessage?: string;
}

/**
 * Coacciona un valor arbitrario de la fila a un `ReactNode` renderizable sin
 * exponer objetos crudos (evita "[object Object]") ni lanzar. Se usa solo en el
 * camino de acceso por clave (render string / clave por defecto), donde el valor
 * es de tipo desconocido por definición.
 */
function toRenderableNode(value: unknown): ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (isValidElement(value)) return value;
  // Booleanos, símbolos, objetos y funciones no se muestran como texto crudo.
  return null;
}

/** Resuelve el contenido de una celda según el contrato de `render` (R6–R8). */
function resolveCell<T>(column: Column<T>, row: T): ReactNode {
  const { render, id } = column;
  if (typeof render === "function") {
    return render(row);
  }
  // Camino de acceso por clave: render string (R7) o clave por defecto = id (R8).
  const key = typeof render === "string" ? render : id;
  // Cast acotado: `row` es un registro de datos; leemos por clave string. El
  // valor resultante se trata como `unknown` y se coacciona con toRenderableNode,
  // por lo que ningún `any` cruza el borde público.
  const value = (row as Record<string, unknown>)[key];
  return toRenderableNode(value);
}

/** Deriva una key de React estable para una fila (R10). */
function resolveRowKey<T>(
  rowKey: DataTableProps<T>["rowKey"],
  row: T,
  index: number,
): string {
  if (typeof rowKey === "function") {
    return rowKey(row);
  }
  if (rowKey !== undefined) {
    const value = (row as Record<string, unknown>)[rowKey as string];
    if (value !== null && value !== undefined) return String(value);
  }
  const id = (row as { id?: unknown }).id;
  if (id !== null && id !== undefined) return String(id);
  return String(index);
}

/**
 * Tabla genérica, data-driven y UI pura. No conoce ningún dominio: recibe las
 * columnas normalizadas (`Column<T>[]`) y las filas (`T[]`) por props (R1).
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  caption,
  ariaLabel,
  isLoading = false,
  error = null,
  emptyMessage = "No hay registros",
}: DataTableProps<T>) {
  // Precedencia de estados: error > carga > vacío > datos.
  const colSpan = columns.length;
  let body: ReactNode;

  if (error) {
    body = (
      <tr>
        <td colSpan={colSpan} className="px-3 py-6 text-center">
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        </td>
      </tr>
    );
  } else if (isLoading) {
    body = (
      <tr>
        <td colSpan={colSpan} className="px-3 py-6 text-center">
          <span role="status" className="text-sm text-muted-foreground">
            Cargando…
          </span>
        </td>
      </tr>
    );
  } else if (data.length === 0) {
    body = (
      <tr>
        <td
          colSpan={colSpan}
          className="px-3 py-6 text-center text-sm text-muted-foreground"
        >
          {emptyMessage}
        </td>
      </tr>
    );
  } else {
    body = data.map((row, index) => (
      <tr key={resolveRowKey(rowKey, row, index)} className="border-b">
        {columns.map((column) => (
          <td
            key={column.id}
            className="px-3 py-2 align-middle"
            style={columnWidthStyle(column)}
          >
            {resolveCell(column, row)}
          </td>
        ))}
      </tr>
    ));
  }

  return (
    <div className="w-full overflow-x-auto">
      <table
        aria-label={ariaLabel}
        className={cn("w-full border-collapse text-left text-sm")}
      >
        {caption ? (
          <caption className="mb-2 text-sm text-muted-foreground">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr className="border-b">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="px-3 py-2 font-medium text-muted-foreground"
                style={columnWidthStyle(column)}
              >
                {column.value}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
