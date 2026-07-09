"use client";

import { useState } from "react";

export interface UsePaginationResult<T> {
  /** Página actual acotada a `[1, totalPages]`. */
  page: number;
  /** Tamaño de página actual. */
  pageSize: number;
  /** Total de elementos del array de entrada. */
  total: number;
  /** Segmento del array correspondiente a la página actual. */
  pagedItems: T[];
  /** Setter de página (el hook la acota al leer). */
  setPage: (page: number) => void;
  /** Setter de tamaño de página. */
  setPageSize: (pageSize: number) => void;
}

/**
 * Hook para el modo CLIENT-SIDE: segmenta un array en memoria y produce las
 * props que `Pagination` espera (`page/pageSize/total`) más `pagedItems` para la
 * lista. Confirma que `Pagination` es transport-agnostic: mismo componente,
 * distinto origen de datos.
 */
export function usePagination<T>(
  items: T[],
  initialPageSize: number,
): UsePaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const pagedItems = items.slice(start, start + pageSize);

  return {
    page: safePage,
    pageSize,
    total,
    pagedItems,
    setPage,
    setPageSize,
  };
}
