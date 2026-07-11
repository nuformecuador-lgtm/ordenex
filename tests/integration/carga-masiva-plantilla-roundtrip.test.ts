import { describe, it, expect } from "vitest";

import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import { buildXlsxTemplate } from "@/lib/utils/xlsx-template";
import { buildCsvTemplate } from "@/lib/utils/csv-template";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { findMissingHeaders, REQUIRED_HEADERS } from "@/lib/types/carga-masiva";

/**
 * Regresión: la plantilla que descarga la app DEBE poder volver a subirse. El bug
 * original era que la cabecera usaba etiquetas legibles ("Nº Remisión") mientras
 * el backend valida contra claves máquina ("num_remision"), rompiendo el
 * round-trip. Estos tests generan la plantilla desde la definición REAL de
 * columnas y la re-parsean con el parser del endpoint, exigiendo cero cabeceras
 * obligatorias ausentes.
 */
describe("Carga masiva — round-trip de la plantilla de órdenes", () => {
  it("la cabecera de la plantilla usa las claves máquina (sin etiquetas divergentes)", () => {
    // Si alguien vuelve a poner un `label`, la cabecera dejaría de ser la clave
    // y el round-trip se rompería; este test lo bloquea de raíz.
    for (const field of ORDENES_BULK_FIELDS) {
      expect(field.label ?? field.key).toBe(field.key);
    }
    // Todas las columnas obligatorias del backend están presentes como clave.
    const keys = new Set(ORDENES_BULK_FIELDS.map((f) => f.key));
    for (const required of REQUIRED_HEADERS) {
      expect(keys.has(required)).toBe(true);
    }
  });

  it("XLSX: la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes", async () => {
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(findMissingHeaders(headers)).toEqual([]);
  });

  it("CSV: la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(findMissingHeaders(headers)).toEqual([]);
  });
});
