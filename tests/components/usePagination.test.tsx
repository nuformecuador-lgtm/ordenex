// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { usePagination } from "@/hooks/usePagination";

describe("usePagination", () => {
  it("C2: segmenta el array en memoria y expone total/pagedItems por página (client-side)", () => {
    const items = Array.from({ length: 23 }, (_, i) => i + 1);
    const { result } = renderHook(() => usePagination(items, 10));

    expect(result.current.total).toBe(23);
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.pagedItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Página 3: solo quedan 3 elementos.
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.pagedItems).toEqual([21, 22, 23]);
  });

  it("C2: setPageSize reconfigura la segmentación y un page fuera de rango se acota", () => {
    const items = Array.from({ length: 23 }, (_, i) => i + 1);
    const { result } = renderHook(() => usePagination(items, 10));

    act(() => result.current.setPageSize(25));
    expect(result.current.pageSize).toBe(25);
    expect(result.current.pagedItems).toHaveLength(23);

    // Page 99 fuera de rango se acota a totalPages.
    act(() => result.current.setPageSize(10));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3); // ceil(23/10) = 3
    expect(result.current.pagedItems).toEqual([21, 22, 23]);
  });
});
