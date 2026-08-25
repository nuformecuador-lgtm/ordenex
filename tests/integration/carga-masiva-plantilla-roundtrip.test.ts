import { describe, it, expect } from "vitest";

import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import { buildXlsxTemplate } from "@/lib/utils/xlsx-template";
import { buildCsvTemplate } from "@/lib/utils/csv-template";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { findMissingHeaders, REQUIRED_HEADERS, filaCargaSchema } from "@/lib/types/carga-masiva";
import { parseCantonDistrito } from "@/lib/utils/canton-distrito";

/**
 * Regresión: la plantilla que descarga la app DEBE poder volver a subirse tal
 * cual, sin editar. Han existido DOS variantes del mismo bug:
 *
 *  1. La cabecera usaba etiquetas legibles ("Nº Remisión") mientras el backend
 *     valida contra claves máquina ("num_remision").
 *  2. (feature 58) La cabecera de los campos `required` se sufijaba con " *",
 *     de modo que al re-parsear el header ya no casaba con la clave: el VALOR
 *     obligatorio quedaba huérfano y la fila se rechazaba.
 *
 * Feature 276 — la plantilla v3 tiene 10 columnas en orden fijo (R1) y la
 * geografía viaja en `provincia` + `canton_distrito` + `direccion` (R5). El caso
 * del valor obligatorio mira que el ejemplo de `canton_distrito` llegue VERBATIM
 * bajo su clave y que el parser real lo resuelva a cantón y distrito.
 *
 * Estos tests construyen la plantilla desde la definición REAL de columnas
 * (`ORDENES_BULK_FIELDS`) y la re-parsean con el parser del endpoint.
 */

/** R1: orden y claves exactos de la plantilla v3. */
const COLUMNAS_ESPERADAS = [
  "destinatario",
  "telefono",
  "provincia",
  "canton_distrito",
  "direccion",
  "monto_cobrar",
  "producto",
  "num_remision",
  "peso",
  "notas",
];

describe("Carga masiva — round-trip de la plantilla de órdenes", () => {
  it("R1: la plantilla tiene exactamente las 10 columnas en el orden del spec", () => {
    expect(ORDENES_BULK_FIELDS.map((f) => f.key)).toEqual(COLUMNAS_ESPERADAS);
  });

  it("R5: la plantilla NO incluye la columna única de la v2 ni canton/distrito sueltos", () => {
    const keys = new Set(ORDENES_BULK_FIELDS.map((f) => f.key));
    for (const muerta of ["direccion_destinatario", "canton", "distrito", "pais"]) {
      expect(keys.has(muerta), `La columna '${muerta}' no debería estar en la plantilla`).toBe(
        false,
      );
    }
  });

  it("R3: cada una de las 10 columnas define un valor de ejemplo", () => {
    for (const field of ORDENES_BULK_FIELDS) {
      expect(field.example, `La columna '${field.key}' no define ejemplo`).toBeTruthy();
    }
  });

  it("R2: la cabecera de la plantilla usa las claves máquina (sin etiquetas divergentes)", () => {
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

  it("R2: XLSX — la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes", async () => {
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(findMissingHeaders(headers)).toEqual([]);
  });

  it("R2: XLSX — CADA clave de columna aparece VERBATIM en los headers parseados", async () => {
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

  it("R1: XLSX — los headers re-parseados conservan el orden de las 8 columnas", async () => {
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(headers).toEqual(COLUMNAS_ESPERADAS);
  });

  it("R3/R4: XLSX — los ejemplos geográficos llegan verbatim y el parser los resuelve", async () => {
    // Cierra el bug de raíz: no basta con que la fila exista; los valores
    // obligatorios deben reparsearse bajo su clave y sobrevivir a la validación
    // de fila y al parser.
    const ejemploDe = (key: string) => ORDENES_BULK_FIELDS.find((f) => f.key === key)?.example;
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { rows } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(rows).toHaveLength(1);
    for (const key of ["provincia", "canton_distrito", "direccion"]) {
      expect(rows[0]?.[key]).toBe(ejemploDe(key));
    }

    // La fila de ejemplo pasa el schema por-fila con su geografía intacta.
    const parsed = filaCargaSchema.parse(rows[0]);
    expect(parsed.provincia).toBe(ejemploDe("provincia"));
    expect(parsed.canton_distrito).toBe(ejemploDe("canton_distrito"));
    expect(parsed.direccion).toBe(ejemploDe("direccion"));

    // Y el parser real lo resuelve a cantón + distrito.
    const partes = parseCantonDistrito(parsed.canton_distrito);
    expect(partes.ok).toBe(true);
    if (!partes.ok) return;
    expect(partes.partes.canton).not.toBe("");
    expect(partes.partes.distrito).not.toBe("");
  });

  it("R2: CSV — la plantilla descargada se re-parsea sin cabeceras obligatorias ausentes", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(findMissingHeaders(headers)).toEqual([]);
  });

  it("R2: CSV — CADA clave de columna aparece VERBATIM en los headers parseados", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    for (const field of ORDENES_BULK_FIELDS) {
      expect(
        headers,
        `El header de la columna '${field.key}' no aparece tal cual en la plantilla CSV re-parseada: [${headers.join(", ")}]`,
      ).toContain(field.key);
    }
  });

  it("R1: CSV — los headers re-parseados conservan el orden de las 10 columnas", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(headers).toEqual(COLUMNAS_ESPERADAS);
  });

  it("R3: CSV — el ejemplo de direccion sobrevive a las comas del CSV", async () => {
    // El ejemplo lleva comas ("…, 200m sur"): si el generador no lo entrecomilla,
    // la columna se parte y la geografía se rompe. Guard explícito.
    const direccion = ORDENES_BULK_FIELDS.find((f) => f.key === "direccion");
    const cantonDistrito = ORDENES_BULK_FIELDS.find((f) => f.key === "canton_distrito");
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { rows } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["direccion"]).toBe(direccion?.example);
    // Y los paréntesis del cantón/distrito tampoco se pierden por el camino.
    expect(rows[0]?.["canton_distrito"]).toBe(cantonDistrito?.example);
    expect(parseCantonDistrito(cantonDistrito!.example!).ok).toBe(true);
  });
});
