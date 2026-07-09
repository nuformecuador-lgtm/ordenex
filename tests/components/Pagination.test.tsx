// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Pagination, buildPageItems } from "@/components/shared/Pagination";

afterEach(() => {
  cleanup();
});

describe("Pagination", () => {
  it("B1: expone un <nav> accesible y el indicador de posición 'Página X de Y' (R3, R15, R17)", () => {
    render(<Pagination page={2} pageSize={10} total={45} ariaLabel="Paginación" />);
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByText("Página 2 de 5")).toBeInTheDocument();
  });

  it("B2: los controles siguiente/anterior emiten onPageChange con el número correcto (R4, R16)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination page={2} pageSize={10} total={45} onPageChange={onPageChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("B3: los controles primera/última emiten onPageChange(1) y onPageChange(totalPages) (R5)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={3}
        pageSize={10}
        total={45}
        showFirstLast
        onPageChange={onPageChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Primera página" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "Última página" }));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("B4: sin onPageChange, activar navegación es un no-op seguro que no lanza (R6)", async () => {
    const user = userEvent.setup();
    render(<Pagination page={2} pageSize={10} total={45} />);
    const next = screen.getByRole("button", { name: "Página siguiente" });
    await expect(user.click(next)).resolves.not.toThrow();
    expect(next).toBeInTheDocument();
  });

  it("B5: en la primera página, anterior/primera están disabled y no emiten (R7, R18)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={1}
        pageSize={10}
        total={45}
        showFirstLast
        onPageChange={onPageChange}
      />,
    );
    const prev = screen.getByRole("button", { name: "Página anterior" });
    const first = screen.getByRole("button", { name: "Primera página" });
    expect(prev).toBeDisabled();
    expect(first).toBeDisabled();
    await user.click(prev);
    await user.click(first);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("B6: en la última página, siguiente/última están disabled y no emiten (R8, R18)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={5}
        pageSize={10}
        total={45}
        showFirstLast
        onPageChange={onPageChange}
      />,
    );
    const next = screen.getByRole("button", { name: "Página siguiente" });
    const last = screen.getByRole("button", { name: "Última página" });
    expect(next).toBeDisabled();
    expect(last).toBeDisabled();
    await user.click(next);
    await user.click(last);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("B7: un page fuera de rango se acota a [1, totalPages] sin lanzar (R9)", () => {
    render(<Pagination page={99} pageSize={10} total={45} />);
    expect(screen.getByText("Página 5 de 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });

  it("B8: el selector de tamaño muestra el pageSize actual y emite onPageSizeChange (R10, R11)", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        pageSize={10}
        total={100}
        pageSizeOptions={[10, 25, 50]}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Elementos por página" });
    expect((select as HTMLSelectElement).value).toBe("10");
    await user.selectOptions(select, "25");
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });

  it("B9: sin onPageSizeChange/pageSizeOptions no se renderiza el selector y la navegación sigue funcionando (R12)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination page={2} pageSize={10} total={45} onPageChange={onPageChange} />,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("B10: dataset vacío (total=0) muestra 'Página 1 de 1' con todos los controles disabled (R13)", () => {
    render(<Pagination page={1} pageSize={10} total={0} showFirstLast />);
    expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("B11: una sola página deshabilita la navegación pero mantiene indicador y selector (R14)", () => {
    render(
      <Pagination
        page={1}
        pageSize={10}
        total={5}
        showFirstLast
        pageSizeOptions={[10, 25, 50]}
        onPageSizeChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Elementos por página" }),
    ).toBeInTheDocument();
  });

  it("B12: disabled global deshabilita todos los controles y no emite al hacer click (R23)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={2}
        pageSize={10}
        total={45}
        showFirstLast
        disabled
        onPageChange={onPageChange}
      />,
    );
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("B13: buildPageItems produce la ventana con primera/última y elipsis según hueco (R26, R27)", () => {
    // totalPages <= 1 -> solo [1].
    expect(buildPageItems(1, 1, 1)).toEqual([1]);
    // Pocas páginas, sin elipsis (hueco de 1 muestra el número).
    expect(buildPageItems(3, 5, 1)).toEqual([1, 2, 3, 4, 5]);
    // Muchas páginas: elipsis a ambos lados.
    expect(buildPageItems(10, 20, 1)).toEqual([
      1,
      "ellipsis",
      9,
      10,
      11,
      "ellipsis",
      20,
    ]);
    // Hueco de exactamente 1 a la izquierda -> muestra el número, no elipsis.
    expect(buildPageItems(3, 20, 1)).toEqual([
      1,
      2,
      3,
      4,
      "ellipsis",
      20,
    ]);
  });

  it("B14: los botones numéricos emiten onPageChange, la elipsis no es accionable y la página actual es no-op (R28)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={3}
        pageSize={10}
        total={90}
        siblingCount={1}
        onPageChange={onPageChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ir a la página 4" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
    // La elipsis no es un botón accionable (aria-hidden, sin rol button).
    expect(screen.getByText("…")).toHaveAttribute("aria-hidden", "true");
    // Click en la página actual (3) es no-op.
    onPageChange.mockClear();
    await user.click(screen.getByRole("button", { name: "Ir a la página 3" }));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("B15: exactamente un botón numérico lleva aria-current='page' (el de la página actual) (R29)", () => {
    render(
      <Pagination page={3} pageSize={10} total={90} siblingCount={1} />,
    );
    const current = screen.getAllByRole("button").filter(
      (b) => b.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Ir a la página 3");
  });

  it("B16: con disabled global o dataset vacío, todos los botones numéricos quedan disabled sin emisión (R30)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { unmount } = render(
      <Pagination
        page={3}
        pageSize={10}
        total={90}
        siblingCount={1}
        disabled
        onPageChange={onPageChange}
      />,
    );
    const numericButtons = screen
      .getAllByRole("button")
      .filter((b) => /Ir a la página/.test(b.getAttribute("aria-label") ?? ""));
    for (const button of numericButtons) {
      expect(button).toBeDisabled();
    }
    await user.click(numericButtons[0]);
    expect(onPageChange).not.toHaveBeenCalled();
    unmount();

    // Dataset vacío: total=0 -> los numéricos también disabled.
    render(
      <Pagination
        page={1}
        pageSize={10}
        total={0}
        siblingCount={1}
        onPageChange={onPageChange}
      />,
    );
    for (const button of screen
      .getAllByRole("button")
      .filter((b) => /Ir a la página/.test(b.getAttribute("aria-label") ?? ""))) {
      expect(button).toBeDisabled();
    }
  });
});
