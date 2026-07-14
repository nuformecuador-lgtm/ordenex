import { describe, it, expect } from "vitest";

import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import { buildXlsxTemplate } from "@/lib/utils/xlsx-template";
import { buildCsvTemplate } from "@/lib/utils/csv-template";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { findMissingHeaders, REQUIRED_HEADERS, filaCargaSchema } from "@/lib/types/carga-masiva";

/**
 * Regresión: la plantilla que descarga la app DEBE poder volver a subirse tal
 * cual, sin editar. Han existido DOS variantes del mismo bug:
 *
 *  1. La cabecera usaba etiquetas legibles ("Nº Remisión") mientras el backend
 *     valida contra claves máquina ("num_remision").
 *  2. (feature 58) La cabecera de los campos `required` se sufijaba con " *"
 *     ("distrito *"), de modo que al re-parsear el header ya no casaba con la
 *     clave "distrito": el VALOR obligatorio "Carmen" quedaba huérfano y la fila
 *     se rechazaba con «distrito requerido».
 *
 * Estos tests construyen la plantilla desde la definición REAL de columnas
 * (`ORDENES_BULK_FIELDS`) y la re-parsean con el parser del endpoint, exigiendo:
 *  - que CADA clave de columna aparezca VERBATIM en los headers parseados
 *    (falla ante cualquier sufijo/etiqueta divergente), y
 *  - que el VALOR de la fila de ejemplo llegue bajo su clave correcta.
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

  it("XLSX: CADA clave de columna aparece VERBATIM en los headers parseados", async () => {
    // Guard directo del bug del sufijo " *": "distrito *" NO es "distrito".
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    for (const field of ORDENES_BULK_FIELDS) {
      expect(
        headers,
        `El header de la columna '${field.key}' no aparece tal cual en la plantilla XLSX re-parseada (¿sufijo/etiqueta?): [${headers.join(", ")}]`,
      ).toContain(field.key);
    }
  });

  it("XLSX: el VALOR obligatorio de ejemplo (distrito) llega bajo su clave correcta", async () => {
    // Cierra el bug de raíz: no basta con que la fila exista; el valor obligatorio
    // debe reparsearse bajo la clave 'distrito' y sobrevivir a la validación de fila.
    const distritoField = ORDENES_BULK_FIELDS.find((f) => f.key === "distrito");
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { rows } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["distrito"]).toBe(distritoField?.example);

    // La fila de ejemplo pasa el schema por-fila con su distrito intacto.
    const parsed = filaCargaSchema.parse(rows[0]);
    expect(parsed.distrito).toBe(distritoField?.example);
  });

  it("CSV: la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(findMissingHeaders(headers)).toEqual([]);
  });

  it("CSV: CADA clave de columna aparece VERBATIM en los headers parseados", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    for (const field of ORDENES_BULK_FIELDS) {
      expect(
        headers,
        `El header de la columna '${field.key}' no aparece tal cual en la plantilla CSV re-parseada: [${headers.join(", ")}]`,
      ).toContain(field.key);
    }
  });
});
