// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

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

  it("B8: isLoading muestra indicador role=status distinguible del vacío (R12)", () => {
    const columns: Column<Row>[] = [{ id: "nombre", value: "Nombre" }];

    render(<DataTable columns={columns} data={[]} isLoading ariaLabel="T" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    // No debe confundirse con el estado vacío
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
