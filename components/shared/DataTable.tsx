"use client";

import { Fragment, isValidElement, useState, type ReactNode } from "react";

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
  /**
   * Contenido desplegable de una fila. Al pasarlo, la tabla antepone una columna con un
   * botón de expandir por fila y el contenido aparece en una fila propia debajo. Devolver
   * `null` para una fila concreta la deja sin desplegar (sin botón).
   *
   * La tabla NO decide qué va adentro: sigue siendo data-driven y sin dominio (R1).
   */
  renderExpanded?: (row: T) => ReactNode;
  /**
   * Nombre accesible del botón de expandir de cada fila. Debe identificar SU fila, no ser
   * un genérico "Ver detalle" repetido N veces.
   */
  expandAriaLabel?: (row: T) => string;
}

/** Chevron del botón de expandir; rota al abrir. Decorativo (el botón ya tiene nombre). */
function ExpandIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={cn("size-4 transition-transform", open && "rotate-90")}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  renderExpanded,
  expandAriaLabel,
}: DataTableProps<T>) {
  // Filas desplegadas, por key de fila. Vive acá (y no en el consumidor) porque es estado
  // de PRESENTACIÓN de la tabla; el consumidor solo dice QUÉ se despliega.
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set());
  const expandible = renderExpanded !== undefined;

  function toggle(key: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  // Precedencia de estados: error > carga > vacío > datos. La columna del botón (si la hay)
  // también ocupa ancho: sin sumarla, los estados vacío/carga no cubren la tabla entera.
  const colSpan = columns.length + (expandible ? 1 : 0);
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
    body = data.map((row, index) => {
      const key = resolveRowKey(rowKey, row, index);
      const expandido = renderExpanded?.(row) ?? null;
      const abierta = expandidas.has(key);
      return (
        <Fragment key={key}>
          <tr className="border-b">
            {expandible ? (
              <td className="px-3 py-2 align-middle">
                {expandido === null ? null : (
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    aria-expanded={abierta}
                    aria-controls={`${key}-expandido`}
                    aria-label={expandAriaLabel?.(row)}
                    className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ExpandIcon open={abierta} />
                  </button>
                )}
              </td>
            ) : null}
            {columns.map((column) => (
              <td key={column.id} className="px-3 py-2 align-middle">
                {resolveCell(column, row)}
              </td>
            ))}
          </tr>
          {expandido !== null && abierta ? (
            <tr id={`${key}-expandido`} className="border-b bg-muted/30">
              <td colSpan={colSpan} className="px-3 py-3">
                {expandido}
              </td>
            </tr>
          ) : null}
        </Fragment>
      );
    });
  }

  return (
    // Contenedor con scroll horizontal: cuando la tabla excede el ancho
    // disponible, desborda DENTRO de este contenedor en vez de empujar la página.
    // Requiere que los ancestros flex (p. ej. SidebarInset) permitan encogerse
    // (`min-w-0`), si no el overflow nunca se activa.
    <div className="w-full max-w-full overflow-x-auto">
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
            {/* Cabecera de la columna del botón: sin texto visible, pero con nombre para
                que la tabla no quede con una columna anónima para un lector de pantalla. */}
            {expandible ? (
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Desglose</span>
              </th>
            ) : null}
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="px-3 py-2 font-medium text-muted-foreground"
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
