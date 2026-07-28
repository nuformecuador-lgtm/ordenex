import { describe, it, expect } from "vitest";

import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import { buildXlsxTemplate } from "@/lib/utils/xlsx-template";
import { buildCsvTemplate } from "@/lib/utils/csv-template";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { findMissingHeaders, REQUIRED_HEADERS, filaCargaSchema } from "@/lib/types/carga-masiva";
import { parseDireccionDestinatario } from "@/lib/utils/direccion-destinatario";

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
 * Feature 142 — la plantilla v2 tiene 8 columnas en orden fijo (R1) y la
 * geografía viaja en la columna única `direccion_destinatario` (R5). El caso del
 * valor obligatorio ya no mira `distrito`: mira que el valor de ejemplo de
 * `direccion_destinatario` llegue VERBATIM bajo su clave y que el parser real lo
 * resuelva a sus cuatro partes.
 *
 * Estos tests construyen la plantilla desde la definición REAL de columnas
 * (`ORDENES_BULK_FIELDS`) y la re-parsean con el parser del endpoint.
 */

/** R1: orden y claves exactos de la plantilla v2. */
const COLUMNAS_ESPERADAS = [
  "destinatario",
  "telefono",
  "direccion_destinatario",
  "monto_cobrar",
  "producto",
  "num_remision",
  "peso",
  "notas",
];

describe("Carga masiva — round-trip de la plantilla de órdenes", () => {
  it("R1: la plantilla tiene exactamente las 8 columnas en el orden del spec", () => {
    expect(ORDENES_BULK_FIELDS.map((f) => f.key)).toEqual(COLUMNAS_ESPERADAS);
  });

  it("R5: la plantilla NO incluye provincia, canton, distrito ni direccion", () => {
    const keys = new Set(ORDENES_BULK_FIELDS.map((f) => f.key));
    for (const vieja of ["provincia", "canton", "distrito", "direccion"]) {
      expect(keys.has(vieja), `La columna vieja '${vieja}' sigue en la plantilla`).toBe(
        false,
      );
    }
  });

  it("R3: cada una de las 8 columnas define un valor de ejemplo", () => {
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

  it("R3: XLSX — el ejemplo de direccion_destinatario llega verbatim y se parsea a 4 partes", async () => {
    // Cierra el bug de raíz: no basta con que la fila exista; el valor obligatorio
    // debe reparsearse bajo su clave y sobrevivir a la validación de fila y al parser.
    const field = ORDENES_BULK_FIELDS.find((f) => f.key === "direccion_destinatario");
    const buffer = await buildXlsxTemplate(ORDENES_BULK_FIELDS);
    const { rows } = await parseSpreadsheet(Buffer.from(buffer), "xlsx");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["direccion_destinatario"]).toBe(field?.example);

    // La fila de ejemplo pasa el schema por-fila con su dirección intacta.
    const parsed = filaCargaSchema.parse(rows[0]);
    expect(parsed.direccion_destinatario).toBe(field?.example);

    // Y el parser real la resuelve a provincia/cantón/distrito + dirección literal.
    const partes = parseDireccionDestinatario(parsed.direccion_destinatario);
    expect(partes.ok).toBe(true);
    if (!partes.ok) return;
    expect(partes.partes.provincia).not.toBe("");
    expect(partes.partes.canton).not.toBe("");
    expect(partes.partes.distrito).not.toBe("");
    expect(partes.partes.direccion).not.toBe("");
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

  it("R1: CSV — los headers re-parseados conservan el orden de las 8 columnas", async () => {
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { headers } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(headers).toEqual(COLUMNAS_ESPERADAS);
  });

  it("R3: CSV — el ejemplo de direccion_destinatario sobrevive a las comas del CSV", async () => {
    // El ejemplo lleva comas ("…, 200m sur"): si el generador no lo entrecomilla,
    // la columna se parte y la geografía se rompe. Guard explícito.
    const field = ORDENES_BULK_FIELDS.find((f) => f.key === "direccion_destinatario");
    const csv = buildCsvTemplate(ORDENES_BULK_FIELDS);
    const { rows } = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "csv");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["direccion_destinatario"]).toBe(field?.example);
    expect(parseDireccionDestinatario(field!.example!).ok).toBe(true);
  });
});
