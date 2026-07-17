// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TabsGroup, type TabItem } from "@/components/shared/TabsGroup";

const items: TabItem[] = [
  { value: "guias", label: "Guías", content: <p>Panel de guías</p> },
  { value: "bodega", label: "Bodega", content: <p>Panel de bodega</p> },
  { value: "cierres", label: "Cierres", content: <p>Panel de cierres</p> },
];

afterEach(() => {
  cleanup();
});

describe("TabsGroup — listado vertical: alto y desborde", () => {
  const LARGO =
    "Órdenes rechazadas pendientes de devolución a la tienda de origen";

  it("el listado no tiene alto fijo: crece con sus tabs y no scrollea aparte", () => {
    render(<TabsGroup items={items} orientation="vertical" ariaLabel="Secciones" />);

    const list = screen.getByRole("tablist", { name: "Secciones" });
    expect(list.className).not.toMatch(/max-h-/);
    expect(list.className).not.toMatch(/overflow-y-(auto|scroll)/);
  });

  it("una tab larga se trunca con elipsis en vez de desbordar la columna", () => {
    render(
      <TabsGroup
        items={[{ value: "largo", label: LARGO, content: <p>Panel</p> }]}
        orientation="vertical"
      />,
    );

    const tab = screen.getByRole("tab", { name: LARGO });
    // `min-w-0` es lo que permite que el hijo flex se encoja; sin eso no hay elipsis.
    expect(tab.className).toMatch(/min-w-0/);
    expect(tab.querySelector(".truncate")).not.toBeNull();
    // El texto truncado sigue disponible completo al pasar el mouse.
    expect(tab).toHaveAttribute("title", LARGO);
  });

  it("el nombre accesible de la tab truncada es el label completo", () => {
    render(
      <TabsGroup
        items={[{ value: "largo", label: LARGO, content: <p>Panel</p> }]}
        orientation="vertical"
      />,
    );

    expect(screen.getByRole("tab", { name: LARGO })).toBeInTheDocument();
  });

  it("horizontal: el label no se trunca (el listado scrollea en X)", () => {
    render(<TabsGroup items={[{ value: "largo", label: LARGO }]} />);

    const tab = screen.getByRole("tab", { name: LARGO });
    expect(tab.querySelector(".truncate")).toBeNull();
    expect(tab).not.toHaveAttribute("title");
  });
});

describe("TabsGroup", () => {
  it("horizontal: activa la primera tab por defecto y no muestra filtro", () => {
    render(<TabsGroup items={items} ariaLabel="Secciones" />);

    expect(screen.getByRole("tab", { name: "Guías" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Panel de guías")).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("horizontal: al clicar una tab emite onValueChange y muestra su panel", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<TabsGroup items={items} onValueChange={onValueChange} />);

    await user.click(screen.getByRole("tab", { name: "Bodega" }));

    expect(onValueChange).toHaveBeenCalledWith("bodega");
    expect(screen.getByText("Panel de bodega")).toBeVisible();
  });

  it("vertical: renderiza el input de filtro antes del listado", () => {
    render(<TabsGroup items={items} orientation="vertical" />);

    const input = screen.getByRole("searchbox");
    const list = screen.getByRole("tablist");
    // El input precede al tablist en el orden del documento (R: filtro arriba).
    expect(
      input.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("vertical: el filtro deja solo las tabs que coinciden, ignorando acentos", async () => {
    const user = userEvent.setup();
    render(<TabsGroup items={items} orientation="vertical" />);

    await user.type(screen.getByRole("searchbox"), "guia");

    expect(screen.getByRole("tab", { name: "Guías" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Bodega" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Cierres" })).toBeNull();
  });

  it("vertical: filtrar no cambia la tab activa: sigue en el listado y con su panel", async () => {
    const user = userEvent.setup();
    render(<TabsGroup items={items} orientation="vertical" />);

    await user.type(screen.getByRole("searchbox"), "bodega");

    // "Guías" está activa y se queda fijada aunque no coincida con el filtro.
    expect(screen.getByRole("tab", { name: "Guías" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Panel de guías")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Cierres" })).toBeNull();
  });

  it("vertical: sin coincidencias muestra el mensaje vacío y solo deja la activa", async () => {
    const user = userEvent.setup();
    render(<TabsGroup items={items} orientation="vertical" />);

    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("Sin coincidencias")).toBeVisible();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveAccessibleName("Guías");
  });

  it("respeta el modo controlado: value manda sobre el estado interno", async () => {
    const user = userEvent.setup();
    render(<TabsGroup items={items} value="cierres" onValueChange={vi.fn()} />);

    expect(screen.getByText("Panel de cierres")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Bodega" }));

    // Sin re-render del padre, la activa no cambia.
    expect(screen.getByRole("tab", { name: "Cierres" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("no permite seleccionar una tab deshabilitada", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const conDisabled: TabItem[] = [
      items[0],
      { ...items[1], disabled: true },
    ];
    render(<TabsGroup items={conDisabled} onValueChange={onValueChange} />);

    await user.click(screen.getByRole("tab", { name: "Bodega" }));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
