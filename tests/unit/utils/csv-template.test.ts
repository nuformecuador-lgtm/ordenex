import { describe, it, expect } from "vitest";

import {
  buildCsvTemplate,
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
