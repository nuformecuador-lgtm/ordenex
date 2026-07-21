"use client";

import { cn } from "@/lib/utils";

/**
 * Item de la ventana numérica de páginas: un número de página o un separador
 * de elipsis no accionable (R26, R27).
 */
export type PageItem = number | "ellipsis";

export interface PaginationLabels {
  /** aria-label del control "primera" (default "Primera página"). */
  first?: string;
  /** aria-label del control "anterior" (default "Página anterior"). */
  previous?: string;
  /** aria-label del control "siguiente" (default "Página siguiente"). */
  next?: string;
  /** aria-label del control "última" (default "Última página"). */
  last?: string;
  /** aria-label del selector de tamaño (default "Elementos por página"). */
  pageSize?: string;
  /** aria-label de un botón numérico. Default: `Ir a la página ${n}`. */
  page?: (page: number) => string;
  /** Render del indicador de posición. Default: `Página ${page} de ${totalPages}`. */
  status?: (page: number, totalPages: number, total: number) => string;
}

export interface PaginationProps {
  /** Página actual (1-based, ≥ 1). Fuente de verdad en el contenedor (R2). */
  page: number;
  /** Tamaño de página actual (≥ 1). */
  pageSize: number;
  /** Total de elementos del conjunto completo (≥ 0). */
  total: number;
  /** Emite el nuevo número de página (R4/R5). Sin él, navegación es no-op (R6). */
  onPageChange?: (nextPage: number) => void;
  /** Emite el nuevo tamaño de página (R11). Sin él, no se renderiza selector (R12). */
  onPageSizeChange?: (nextPageSize: number) => void;
  /** Opciones del selector de tamaño (R10). Requerido para mostrar el selector. */
  pageSizeOptions?: number[];
  /** Deshabilita todos los controles (p. ej. mientras carga, R23). */
  disabled?: boolean;
  /** Mostrar botones "primera"/"última" (R5). Default false. */
  showFirstLast?: boolean;
  /**
   * Nº de vecinos a cada lado de la página actual en la ventana numérica (R26).
   * Provisto (incl. 0) => se renderiza la ventana de botones numéricos;
   * `undefined` => NO se renderiza la ventana. Default `undefined`.
   */
  siblingCount?: number;
  /** Nombre accesible del <nav> (R15). Default "Paginación". */
  ariaLabel?: string;
  /** Etiquetas/aria-labels personalizables (i18n) (R16, R17). */
  labels?: PaginationLabels;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Helper puro que produce la lista de items de la ventana numérica (R26, R27).
 * Primera y última siempre presentes; ventana `current ± k`; elipsis solo cuando
 * el hueco es de más de una página (si el hueco es de 1, se muestra ese número);
 * dedup defensivo de números por si `k` grande hace solaparse los rangos.
 */
export function buildPageItems(
  current: number,
  totalPages: number,
  siblingCount: number,
): PageItem[] {
  const k = Math.max(0, siblingCount);
  const first = 1;
  const last = totalPages;

  if (last <= 1) return [1];

  const start = clamp(current - k, first, last);
  const end = clamp(current + k, first, last);

  const items: PageItem[] = [];
  items.push(first);

  if (start > first + 1) items.push("ellipsis");
  else if (start === first + 1) items.push(first + 1);

  for (let n = start; n <= end; n++) {
    if (n !== first && n !== last) items.push(n);
  }

  if (end < last - 1) items.push("ellipsis");
  else if (end === last - 1) items.push(last - 1);

  items.push(last);

  // Dedup defensivo: elimina números repetidos, preserva las elipsis.
  const seen = new Set<number>();
  const out: PageItem[] = [];
  for (const item of items) {
    if (item === "ellipsis") {
      out.push(item);
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

const buttonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground";

/**
 * Componente de paginación genérico, controlado y desacoplado (R1, R2). No obtiene
 * datos ni conoce ningún dominio: recibe `page/pageSize/total` y emite eventos.
 * Se compone como hermano de cualquier lista (DataTable, grid, tarjetas).
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  disabled = false,
  showFirstLast = false,
  siblingCount,
  ariaLabel = "Paginación",
  labels,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize)); // R3, R13
  const safePage = clamp(page, 1, totalPages); // R9
  const emptyDataset = total === 0; // R13
  const isFirst = safePage <= 1; // R7
  const isLast = safePage >= totalPages; // R8

  const statusText = labels?.status
    ? labels.status(safePage, totalPages, total)
    : `Página ${safePage} de ${totalPages}`;

  const pageLabel = labels?.page ?? ((n: number) => `Ir a la página ${n}`);

  const navDisabled = disabled || emptyDataset;
  const prevDisabled = navDisabled || isFirst;
  const nextDisabled = navDisabled || isLast;

  const goFirst = () => {
    if (!prevDisabled) onPageChange?.(1);
  };
  const goPrev = () => {
    if (!prevDisabled) onPageChange?.(safePage - 1);
  };
  const goNext = () => {
    if (!nextDisabled) onPageChange?.(safePage + 1);
  };
  const goLast = () => {
    if (!nextDisabled) onPageChange?.(totalPages);
  };
  const goTo = (n: number) => {
    if (!navDisabled && n !== safePage) onPageChange?.(n);
  };

  const showSizeSelector =
    onPageSizeChange !== undefined &&
    pageSizeOptions !== undefined &&
    pageSizeOptions.length > 0; // R10, R12

  const showNumbers = siblingCount !== undefined; // R26
  const pageItems = showNumbers
    ? buildPageItems(safePage, totalPages, siblingCount)
    : [];

  return (
    <nav
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-2 py-2"
    >
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {statusText}
      </span>

      <div className="flex items-center gap-1">
        {showFirstLast ? (
          <button
            type="button"
            aria-label={labels?.first ?? "Primera página"}
            disabled={prevDisabled}
            onClick={goFirst}
            className={buttonClass}
          >
            «
          </button>
        ) : null}

        <button
          type="button"
          aria-label={labels?.previous ?? "Página anterior"}
          disabled={prevDisabled}
          onClick={goPrev}
          className={buttonClass}
        >
          ‹
        </button>

        {showNumbers
          ? pageItems.map((item, index) =>
              item === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  aria-hidden="true"
                  className="px-1 text-sm text-muted-foreground"
                >
                  …
                </span>
              ) : (
                <button
                  key={`page-${item}`}
                  type="button"
                  aria-label={pageLabel(item)}
                  aria-current={item === safePage ? "page" : undefined}
                  disabled={navDisabled}
                  onClick={() => goTo(item)}
                  className={buttonClass}
                >
                  {item}
                </button>
              ),
            )
          : null}

        <button
          type="button"
          aria-label={labels?.next ?? "Página siguiente"}
          disabled={nextDisabled}
          onClick={goNext}
          className={buttonClass}
        >
          ›
        </button>

        {showFirstLast ? (
          <button
            type="button"
            aria-label={labels?.last ?? "Última página"}
            disabled={nextDisabled}
            onClick={goLast}
            className={buttonClass}
          >
            »
          </button>
        ) : null}
      </div>

      {showSizeSelector ? (
        <select
          aria-label={labels?.pageSize ?? "Elementos por página"}
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
          className={cn(
            "h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {pageSizeOptions?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
    </nav>
  );
}
