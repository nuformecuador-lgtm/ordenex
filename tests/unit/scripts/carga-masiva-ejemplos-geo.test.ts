// Feature 58 — Blindaje (regression guard): la fila de EJEMPLO de la plantilla de
// carga masiva (ORDENES_BULK_FIELDS) debe usar provincia/cantón/distrito que EXISTAN
// en el catálogo geográfico real y cuyo distrito TENGA zona asignada, para que la
// plantilla descargada sea cargable tal cual (fix 'provincia no encontrada' / distrito
// sin zona). Se valida ESTÁTICAMENTE (sin DB) reusando el MISMO parser + normalizador
// del seed (scripts/seed-zonas.ts) sobre los XLSX de public/, así el ejemplo no puede
// volver a desincronizarse del seed: si alguien lo cambia a algo inválido, falla aquí.
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import {
  parseGeografiaRows,
  parseZonaHintRows,
  type GeoRow,
  type ZonaHintRow,
} from "@/scripts/seed-zonas";
import { normalizeZonaKey, canonicalZonaNombre } from "@/lib/geo/normalize";
import { ORDENES_BULK_FIELDS } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";

// Mismas rutas/hoja que el seed (scripts/seed-zonas.ts). Absolutas respecto al repo.
const GEO_XLSX_PATH = path.resolve(process.cwd(), "public/geografia-cr-completa.xlsx");
const ZONA_XLSX_PATH = path.resolve(process.cwd(), "public/mapa-geografico-costa-rica.xlsx");
const ZONA_SHEET_NAME = "Jerarquía (revisar)";

async function loadWorksheet(filePath: string, sheet?: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
  if (!worksheet) throw new Error(`No se encontró la hoja ${sheet ?? "(primera)"} en ${filePath}`);
  return worksheet;
}

// Terna normalizada prov::canton::distrito con el MISMO normalizador del cruce del seed.
function ternaKey(provincia: string, canton: string, distrito: string): string | null {
  const pk = normalizeZonaKey(provincia);
  const ck = normalizeZonaKey(canton);
  const dk = normalizeZonaKey(distrito);
  if (pk === null || ck === null || dk === null) return null;
  return `${pk}::${ck}::${dk}`;
}

function exampleFor(key: string): string {
  const field = ORDENES_BULK_FIELDS.find((f) => f.key === key);
  if (!field || field.example === undefined) {
    throw new Error(`La plantilla no define ejemplo para la columna '${key}'`);
  }
  return field.example;
}

describe("carga masiva — fila de ejemplo con geografía válida (feature 58)", () => {
  let geoRows: GeoRow[];
  let hints: ZonaHintRow[];
  // Ternas geográficas existentes en el catálogo (mapa oficial completo).
  let geoTernas: Set<string>;
  // Ternas que RECIBEN zona en el seed: existen en el catálogo Y tienen hint con zona.
  let ternasConZona: Set<string>;

  beforeAll(async () => {
    const geoWs = await loadWorksheet(GEO_XLSX_PATH);
    const zonaWs = await loadWorksheet(ZONA_XLSX_PATH, ZONA_SHEET_NAME);
    geoRows = parseGeografiaRows(geoWs);
    hints = parseZonaHintRows(zonaWs);

    geoTernas = new Set<string>();
    for (const r of geoRows) {
      const k = ternaKey(r.provincia, r.canton, r.distrito);
      if (k !== null) geoTernas.add(k);
    }

    // Réplica de la lógica de cruce del seed (cruzarZonas): un distrito recibe zona
    // si hay un hint que casa su terna normalizada Y cuya zona no es vacía.
    ternasConZona = new Set<string>();
    for (const h of hints) {
      const k = ternaKey(h.provincia, h.canton, h.distrito);
      if (k === null || !geoTernas.has(k)) continue;
      if (canonicalZonaNombre(h.zona) === null) continue;
      ternasConZona.add(k);
    }
  });

  it("los XLSX del seed están presentes y parseables (precondición)", () => {
    expect(geoRows.length).toBeGreaterThan(0);
    expect(hints.length).toBeGreaterThan(0);
    expect(ternasConZona.size).toBeGreaterThan(0);
  });

  it("provincia/cantón/distrito de ejemplo EXISTEN en el catálogo geográfico real", () => {
    const provincia = exampleFor("provincia");
    const canton = exampleFor("canton");
    const distrito = exampleFor("distrito");

    const terna = ternaKey(provincia, canton, distrito);
    expect(terna).not.toBeNull();
    expect(
      geoTernas.has(terna!),
      `El combo de ejemplo ${provincia}/${canton}/${distrito} no existe en el catálogo geográfico (public/geografia-cr-completa.xlsx). Elige uno del seed real.`,
    ).toBe(true);
  });

  it("el distrito de ejemplo TIENE zona asignada (deriva orden.zona_id)", () => {
    const provincia = exampleFor("provincia");
    const canton = exampleFor("canton");
    const distrito = exampleFor("distrito");

    const terna = ternaKey(provincia, canton, distrito);
    expect(
      ternasConZona.has(terna!),
      `El distrito de ejemplo ${provincia}/${canton}/${distrito} no tiene zona asignada en el cruce del seed (public/mapa-geografico-costa-rica.xlsx). La carga fallaría con 'distrito sin zona'.`,
    ).toBe(true);
  });
});
