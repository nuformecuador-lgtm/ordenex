import { describe, it, expect } from "vitest";

import {
  buildCsvRows,
  buildCsvTemplate,
  type CsvColumn,
  type CsvTemplateField,
} from "@/lib/utils/csv-template";

/** Parsea un CSV simple respetando el envoltorio de comillas dobles (para R7). */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char === "\r") {
      // ignorar; el par \r\n cierra fila en el \n
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

describe("buildCsvTemplate", () => {
  it("R5: la cabecera respeta el orden de los campos y usa label cuando existe", () => {
    const fields: CsvTemplateField[] = [
      { key: "num_remision", label: "Nº Remisión" },
      { key: "telefono" },
      { key: "provincia", label: "Provincia" },
    ];

    const csv = buildCsvTemplate(fields);
    const [header] = parseCsv(csv);

    expect(header).toEqual(["Nº Remisión", "telefono", "Provincia"]);
  });

  it("R6: con al menos un ejemplo genera una segunda fila con los ejemplos alineados", () => {
    const fields: CsvTemplateField[] = [
      { key: "a", example: "1" },
      { key: "b" },
      { key: "c", example: "3" },
    ];

    const rows = parseCsv(buildCsvTemplate(fields));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["a", "b", "c"]);
    // Campo sin ejemplo queda como celda vacía alineada a su columna.
    expect(rows[1]).toEqual(["1", "", "3"]);
  });

  it("R6: sin ningún ejemplo genera solo la fila de cabecera", () => {
    const fields: CsvTemplateField[] = [{ key: "a" }, { key: "b" }];

    const rows = parseCsv(buildCsvTemplate(fields));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(["a", "b"]);
  });

  it("R7: escapa valores con separador, comillas o saltos de línea produciendo un CSV parseable", () => {
    const fields: CsvTemplateField[] = [
      { key: "con,coma", example: 'texto "citado"' },
      { key: "con\nsalto", example: "linea1\nlinea2" },
    ];

    const csv = buildCsvTemplate(fields);
    // El texto crudo debe envolver en comillas y duplicar las internas.
    expect(csv).toContain('"con,coma"');
    expect(csv).toContain('"texto ""citado"""');

    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["con,coma", "con\nsalto"]);
    expect(rows[1]).toEqual(['texto "citado"', "linea1\nlinea2"]);
  });

  it("lanza si se invoca sin campos (contrato de uso)", () => {
    expect(() => buildCsvTemplate([])).toThrow();
  });
});

// Feature 151 (T3) — generador CSV de N filas de datos, hermano de la plantilla.
describe("buildCsvRows", () => {
  const columnas: CsvColumn[] = [
    { key: "numGuia", header: "Nº Guía" },
    { key: "destinatario", header: "Destinatario" },
    { key: "monto", header: "Monto a cobrar" },
  ];

  it("emite una línea de cabecera y una línea por fila, en el orden recibido", () => {
    const csv = buildCsvRows(columnas, [
      { numGuia: 1001, destinatario: "Ana", monto: 15000 },
      { numGuia: 1002, destinatario: "Beto", monto: 0 },
      { numGuia: 1003, destinatario: "Cira", monto: 7.5 },
    ]);

    const filas = parseCsv(csv);

    expect(filas).toHaveLength(4);
    expect(filas[0]).toEqual(["Nº Guía", "Destinatario", "Monto a cobrar"]);
    expect(filas[1]).toEqual(["1001", "Ana", "15000"]);
    expect(filas[2]).toEqual(["1002", "Beto", "0"]);
    expect(filas[3]).toEqual(["1003", "Cira", "7.5"]);
  });

  it("escapa comas, comillas y saltos de línea dentro de una celda", () => {
    const csv = buildCsvRows(
      [
        { key: "direccion", header: "Dirección" },
        { key: "nota", header: "Nota" },
      ],
      [
        {
          direccion: "Calle 1, casa 2",
          nota: 'dijo "urgente"\nsegunda línea',
        },
      ],
    );

    // Texto crudo: envuelto en comillas, con las internas duplicadas.
    expect(csv).toContain('"Calle 1, casa 2"');
    expect(csv).toContain('"dijo ""urgente""');

    const filas = parseCsv(csv);
    expect(filas[0]).toEqual(["Dirección", "Nota"]);
    expect(filas[1]).toEqual([
      "Calle 1, casa 2",
      'dijo "urgente"\nsegunda línea',
    ]);
  });

  it("ignora las claves de la fila que no están declaradas como columna", () => {
    const csv = buildCsvRows(
      [{ key: "destinatario", header: "Destinatario" }],
      [{ destinatario: "Ana", id: "uuid-interno", deletedAt: "2026-01-01" }],
    );

    const filas = parseCsv(csv);

    expect(filas[0]).toEqual(["Destinatario"]);
    expect(filas[1]).toEqual(["Ana"]);
    expect(csv).not.toContain("uuid-interno");
    expect(csv).not.toContain("2026-01-01");
  });

  it("deja la celda vacía cuando la fila no aporta la clave", () => {
    const csv = buildCsvRows(columnas, [
      { numGuia: 1001, monto: null },
      { destinatario: "Beto" },
    ]);

    const filas = parseCsv(csv);

    expect(filas[1]).toEqual(["1001", "", ""]);
    expect(filas[2]).toEqual(["", "Beto", ""]);
    expect(csv).not.toContain("null");
    expect(csv).not.toContain("undefined");
  });

  it("lanza si la lista de columnas está vacía", () => {
    expect(() => buildCsvRows([], [{ a: "1" }])).toThrow();
  });
});
