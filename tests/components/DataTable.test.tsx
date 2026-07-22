// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/DataTable";

type Row = { id: string; nombre: string; edad?: number | null };

const baseData: Row[] = [
  { id: "1", nombre: "Ana", edad: 30 },
  { id: "2", nombre: "Beto", edad: 25 },
  { id: "3", nombre: "Ceci", edad: 40 },
];

afterEach(() => {
  cleanup();
});

/** Devuelve las filas del `<tbody>` (excluye la fila de cabecera del `<thead>`). */
function bodyRows(): HTMLElement[] {
  const table = screen.getByRole("table");
  const tbody = table.querySelector("tbody");
  if (!tbody) throw new Error("tbody no encontrado");
  return within(tbody).getAllByRole("row");
}

describe("DataTable", () => {
  it("B1: renderiza una cabecera por columna con su value en orden y nombre accesible por ariaLabel (R2, R5, R15, R16)", () => {
    const columns: Column<Row>[] = [
      { id: "id", value: "ID" },
      { id: "nombre", value: "Nombre" },
      { id: "edad", value: "Edad" },
    ];

    render(<DataTable columns={columns} data={baseData} ariaLabel="Personas" />);

    const table = screen.getByRole("table", { name: "Personas" });
    expect(table).toBeInTheDocument();

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["ID", "Nombre", "Edad"]);
    for (const th of headers) {
      expect(th.tagName).toBe("TH");
      expect(th).toHaveAttribute("scope", "col");
    }
  });

  it("renderHeader sustituye el texto `value` por un nodo custom en el <th> (p. ej. un checkbox)", () => {
    const onToggle = vi.fn();
    const columns: Column<Row>[] = [
      {
        id: "seleccionar",
        value: "Seleccionar",
        renderHeader: () => (
          <input
            type="checkbox"
            aria-label="Seleccionar todo"
            onChange={onToggle}
          />
        ),
        render: () => <input type="checkbox" aria-label="Seleccionar fila" />,
      },
      { id: "nombre", value: "Nombre" },
    ];

    render(<DataTable columns={columns} data={baseData} ariaLabel="Personas" />);

    // El primer <th> ya no muestra el texto: contiene el checkbox de cabecera.
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0].textContent).toBe("");
    const selectAll = within(headers[0]).getByRole("checkbox", {
      name: "Seleccionar todo",
    });
    expect(selectAll).toBeInTheDocument();
    // La columna sin `renderHeader` conserva su `value` de texto.
    expect(headers[1].textContent).toBe("Nombre");
  });

  it("B2: render como FUNCIÓN produce un nodo custom por fila (R3a, R6)", () => {
    const columns: Column<Row>[] = [
      { id: "nombre", value: "Nombre" },
      {
        id: "accion",
        value: "Acción",
        render: (row) => <button>Ver {row.nombre}</button>,
      },
    ];

    render(<DataTable columns={columns} data={baseData} ariaLabel="Personas" />);

    for (const row of baseData) {
      expect(
        screen.getByRole("button", { name: `Ver ${row.nombre}` }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(baseData.length);
  });

  it("B3: render como STRING usa esa clave de la fila (R3b, R7)", () => {
    const columns: Column<Row>[] = [
      { id: "a", value: "A", render: "nombre" },
    ];

    render(<DataTable columns={columns} data={[baseData[0]]} ariaLabel="T" />);

    const [dataRow] = bodyRows();
    const [cell] = within(dataRow).getAllByRole("cell");
    expect(cell).toHaveTextContent("Ana");
  });

  it("B4: sin render lee por column.id y deja celda vacía si el valor es null/undefined sin throw (R3c, R8)", () => {
    const columns: Column<Row>[] = [
      { id: "nombre", value: "Nombre" },
      { id: "edad", value: "Edad" },
    ];
    const data: Row[] = [
      { id: "x", nombre: "Dora", edad: 22 },
      { id: "y", nombre: "Emi", edad: null },
      { id: "z", nombre: "Fabi" }, // edad undefined
    ];

    expect(() =>
      render(<DataTable columns={columns} data={data} ariaLabel="T" />),
    ).not.toThrow();

    const rows = bodyRows();
    // Fila con edad válida: celda por column.id "edad"
    expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("Dora");
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent("22");
    // Fila con edad null -> celda vacía
    expect(within(rows[1]).getAllByRole("cell")[1].textContent).toBe("");
    // Fila con edad undefined -> celda vacía
    expect(within(rows[2]).getAllByRole("cell")[1].textContent).toBe("");
  });

  it("B5: renderiza N filas en el tbody preservando el orden de data (R9)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(<DataTable columns={columns} data={baseData} ariaLabel="T" />);

    const rows = bodyRows();
    expect(rows).toHaveLength(baseData.length);
    expect(rows.map((r) => r.textContent)).toEqual(["Ana", "Beto", "Ceci"]);
  });

  it("B6: rowKey por id y como función; sin warning de key y contenido correcto al reordenar (R10)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    // rowKey por defecto (id)
    const { unmount } = render(
      <DataTable columns={columns} data={baseData} ariaLabel="T" />,
    );
    expect(bodyRows().map((r) => r.textContent)).toEqual([
      "Ana",
      "Beto",
      "Ceci",
    ]);
    unmount();

    // rowKey como función, con data reordenada
    const reordered = [baseData[2], baseData[0], baseData[1]];
    render(
      <DataTable
        columns={columns}
        data={reordered}
        rowKey={(row) => row.id}
        ariaLabel="T"
      />,
    );
    expect(bodyRows().map((r) => r.textContent)).toEqual([
      "Ceci",
      "Ana",
      "Beto",
    ]);

    // Ningún console.error de React relativo a "key"
    const keyWarnings = errorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("key")),
    );
    expect(keyWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("B7: estado vacío muestra cabecera + emptyMessage por defecto y sin filas de datos (R11)", () => {
    const columns: Column<Row>[] = [
      { id: "nombre", value: "Nombre" },
      { id: "edad", value: "Edad" },
    ];

    render(<DataTable columns={columns} data={[]} ariaLabel="T" />);

    // Cabecera visible
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    // Mensaje vacío por defecto
    expect(screen.getByText("No hay registros")).toBeInTheDocument();
    // Solo una fila (la del mensaje), sin datos
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("No hay registros");
  });

  it("B8: isLoading muestra filas skeleton (no el texto 'Cargando…') distinguibles del vacío (R12)", () => {
    const columns: Column<Row>[] = [
      { id: "nombre", value: "Nombre" },
      { id: "edad", value: "Edad" },
    ];

    const { container } = render(
      <DataTable columns={columns} data={[]} isLoading ariaLabel="T" />,
    );

    // El estado de carga ahora es visual (filas skeleton), no el texto plano.
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(screen.queryByText("Cargando…")).not.toBeInTheDocument();

    // Sigue anunciado a lectores de pantalla y distinguible del estado vacío.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("No hay registros")).not.toBeInTheDocument();
  });

  it("B9: error muestra role=alert en lugar de los datos (R13)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(
      <DataTable
        columns={columns}
        data={baseData}
        error="No se pudo cargar"
        ariaLabel="T"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudo cargar");
    // Ninguna fila de datos
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
    expect(screen.queryByText("Beto")).not.toBeInTheDocument();
    // Cabecera sigue presente
    expect(screen.getAllByRole("columnheader")).toHaveLength(1);
  });

  it("B10: caption se renderiza y da nombre accesible a la tabla (R14, R16)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(
      <DataTable columns={columns} data={baseData} caption="Listado de personas" />,
    );

    const table = screen.getByRole("table", { name: /Listado de personas/ });
    expect(table.querySelector("caption")?.textContent).toBe(
      "Listado de personas",
    );
  });

  it("B7b: estado vacío estructurado (`emptyState`) muestra icono, título, descripción y CTA (R11, EmptyState)", async () => {
    const onCrear = vi.fn();
    const user = userEvent.setup();
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    const { container } = render(
      <DataTable
        columns={columns}
        data={[]}
        ariaLabel="T"
        emptyState={{
          icon: Inbox,
          title: "No hay usuarios",
          description: "Crea el primer usuario para dar acceso al sistema.",
          action: <button onClick={onCrear}>Crear usuario</button>,
        }}
      />,
    );

    // Título estructurado + descripción que enseña el próximo paso.
    expect(screen.getByText("No hay usuarios")).toBeInTheDocument();
    expect(
      screen.getByText("Crea el primer usuario para dar acceso al sistema."),
    ).toBeInTheDocument();
    // Icono decorativo renderizado.
    expect(container.querySelector("svg")).toBeInTheDocument();
    // CTA operativa.
    const cta = screen.getByRole("button", { name: "Crear usuario" });
    await user.click(cta);
    expect(onCrear).toHaveBeenCalledTimes(1);
    // Cabecera presente, sin filas de datos (solo la fila del estado vacío).
    expect(screen.getAllByRole("columnheader")).toHaveLength(1);
    expect(bodyRows()).toHaveLength(1);
  });

  it("B7c: `emptyState.title` tiene prioridad sobre `emptyMessage` (retrocompatible)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(
      <DataTable
        columns={columns}
        data={[]}
        ariaLabel="T"
        emptyMessage="No hay registros"
        emptyState={{ title: "No hay usuarios" }}
      />,
    );

    expect(screen.getByText("No hay usuarios")).toBeInTheDocument();
    expect(screen.queryByText("No hay registros")).not.toBeInTheDocument();
  });

  it("B12: sin `rowClassName` cada fila de datos conserva solo `border-b` (retrocompatible, R8-101/T9)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(<DataTable columns={columns} data={baseData} ariaLabel="T" />);

    const rows = bodyRows();
    expect(rows).toHaveLength(baseData.length);
    for (const row of rows) {
      // La clase base sigue intacta y no se cuela ninguna clase derivada de fila.
      expect(row).toHaveClass("border-b");
      expect(row.className.trim()).toBe("border-b");
    }
  });

  it("B13: con `rowClassName` la fila recibe la clase derivada sin perder `border-b`; filas que devuelven undefined quedan solo con `border-b` (R8-101/T9)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(
      <DataTable
        columns={columns}
        data={baseData}
        ariaLabel="T"
        // Resalta solo "Beto": el predicado por fila devuelve la clase o undefined.
        rowClassName={(row) => (row.nombre === "Beto" ? "bg-warning/15" : undefined)}
      />,
    );

    const rows = bodyRows();
    const [ana, beto, ceci] = rows;
    // La fila marcada combina la clase base con la derivada.
    expect(beto).toHaveClass("border-b");
    expect(beto).toHaveClass("bg-warning/15");
    // Las no marcadas (undefined) quedan idénticas al comportamiento previo.
    expect(ana).not.toHaveClass("bg-warning/15");
    expect(ceci).not.toHaveClass("bg-warning/15");
    expect(ana.className.trim()).toBe("border-b");
    expect(ceci.className.trim()).toBe("border-b");
  });

  it("B11: columnas con id único renderizan sin throw (R4)", () => {
    const columns: Column<Row>[] = [
      { id: "id", value: "ID" },
      { id: "nombre", value: "Nombre" },
      { id: "edad", value: "Edad" },
    ];

    // Documenta el contrato: los id deben ser únicos entre columnas.
    const ids = columns.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    expect(() =>
      render(<DataTable columns={columns} data={baseData} ariaLabel="T" />),
    ).not.toThrow();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
  });
});
