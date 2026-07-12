// Feature 24 (T17) — Seed idempotente del catalogo geografico global + zonas.
// Cruza DOS fuentes XLSX (ambas con exceljs):
//   (a) mapa oficial completo de Costa Rica -> puebla provincia/canton/distrito;
//   (b) Excel original (hoja "Jerarquia (revisar)") -> asignaciones de zona.
// Patron scripts/seed-catalogos.ts: funciones exportadas que reciben el cliente
// Prisma por parametro (testeables sin DB) y `isEntrypoint` para no auto-correr
// al importarlo. La corrida real contra la DB + los XLSX de public/ es un gate de
// despliegue (R40).
import ExcelJS from "exceljs";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { canonicalZonaNombre, normalizeZonaKey } from "@/lib/geo/normalize";
import { getPrismaClient } from "@/lib/db/prisma-client";

// --- Tipos de fila de cada fuente ---
export interface GeoRow {
  provincia: string;
  canton: string;
  distrito: string;
}

export interface ZonaHintRow {
  provincia: string;
  canton: string;
  distrito: string;
  zona: string;
}

export interface SeedZonasSummary {
  distritosPoblados: number; // desde el mapa completo (R38)
  distritosConZona: number; // cruzados con exito (R38)
  distritosSinZona: number; // sin match/zona vacia -> NULL (R36/R38)
  zonasCreadas: number; // zonas deducidas y deduplicadas (R35/R38)
  ternasSinCorrespondencia: number; // hints sin distrito en el mapa completo (R38)
  filasOmitidas: number; // filas incompletas de cualquiera de las fuentes (R38)
}

// Clientes Prisma acotados (permite mockear en tests sin la conexion real).
type GeoPrisma = Pick<PrismaClient, "provincia" | "canton" | "distrito">;
type ZonaPrisma = Pick<PrismaClient, "zona">;
type DistritoPrisma = Pick<PrismaClient, "distrito">;

// --- Parsers XLSX (exceljs) ---

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text);
    if ("result" in value) return cellToString((value as { result: ExcelJS.CellValue }).result);
  }
  return "";
}

// Clave de cabecera insensible a acentos/espacios/mayusculas ("Cantón" -> "canton").
function headerKey(raw: string): string {
  return normalizeZonaKey(raw) ?? "";
}

/** Extrae filas normalizadas por cabecera (clave = cabecera sin acentos/lower). */
export function rowsFromWorksheet(ws: ExcelJS.Worksheet): Record<string, string>[] {
  const headerByCol = new Map<number, string>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = headerKey(cellToString(cell.value));
    if (key !== "") headerByCol.set(col, key);
  });

  const rows: Record<string, string>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // cabecera
    const record: Record<string, string> = {};
    let hasValue = false;
    for (const [col, key] of headerByCol) {
      const raw = cellToString(row.getCell(col).value).trim();
      record[key] = raw;
      if (raw !== "") hasValue = true;
    }
    if (hasValue) rows.push(record);
  });
  return rows;
}

/** Fuente GEOGRAFIA (mapa oficial completo): columnas Provincia/Canton/Distrito. */
export function parseGeografiaRows(ws: ExcelJS.Worksheet): GeoRow[] {
  return rowsFromWorksheet(ws).map((r) => ({
    provincia: r["provincia"] ?? "",
    canton: r["canton"] ?? "",
    distrito: r["distrito"] ?? "",
  }));
}

/** Fuente ZONA (Excel original): columnas Provincia/Canton/Distrito/Zona (+ ignoradas). */
export function parseZonaHintRows(ws: ExcelJS.Worksheet): ZonaHintRow[] {
  return rowsFromWorksheet(ws).map((r) => ({
    provincia: r["provincia"] ?? "",
    canton: r["canton"] ?? "",
    distrito: r["distrito"] ?? "",
    zona: r["zona"] ?? "",
  }));
}

// --- Upserts manuales por nombre dentro del padre (no hay unique compuesto) ---

async function upsertProvincia(prisma: GeoPrisma, nombre: string): Promise<string> {
  const found = await prisma.provincia.findFirst({ where: { nombre }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.provincia.create({ data: { nombre }, select: { id: true } });
  return created.id;
}

async function upsertCanton(prisma: GeoPrisma, provinciaId: string, nombre: string): Promise<string> {
  const found = await prisma.canton.findFirst({
    where: { provinciaId, nombre },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.canton.create({
    data: { provinciaId, nombre },
    select: { id: true },
  });
  return created.id;
}

async function upsertDistrito(prisma: GeoPrisma, cantonId: string, nombre: string): Promise<string> {
  const found = await prisma.distrito.findFirst({
    where: { cantonId, nombre },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.distrito.create({
    data: { cantonId, nombre },
    select: { id: true },
  });
  return created.id;
}

export interface GeografiaResult {
  /** terna normalizada `prov::canton::distrito` -> distritoId (para el cruce). */
  distritoByTerna: Map<string, string>;
  distritosPoblados: number;
  filasOmitidas: number;
}

/**
 * R34/R39: puebla provincia -> canton -> distrito por nombre dentro del padre, sin
 * duplicar en re-corridas (upsert manual por nombre). Filas incompletas se omiten.
 */
export async function seedGeografia(prisma: GeoPrisma, rows: GeoRow[]): Promise<GeografiaResult> {
  const distritoByTerna = new Map<string, string>();
  const provinciaIdByKey = new Map<string, string>();
  const cantonIdByKey = new Map<string, string>();
  let distritosPoblados = 0;
  let filasOmitidas = 0;

  for (const row of rows) {
    const pk = normalizeZonaKey(row.provincia);
    const ck = normalizeZonaKey(row.canton);
    const dk = normalizeZonaKey(row.distrito);
    if (pk === null || ck === null || dk === null) {
      filasOmitidas += 1; // R38: fila incompleta
      continue;
    }

    let provinciaId = provinciaIdByKey.get(pk);
    if (provinciaId === undefined) {
      provinciaId = await upsertProvincia(prisma, row.provincia);
      provinciaIdByKey.set(pk, provinciaId);
    }

    const cantonMapKey = `${pk}::${ck}`;
    let cantonId = cantonIdByKey.get(cantonMapKey);
    if (cantonId === undefined) {
      cantonId = await upsertCanton(prisma, provinciaId, row.canton);
      cantonIdByKey.set(cantonMapKey, cantonId);
    }

    const distritoId = await upsertDistrito(prisma, cantonId, row.distrito);
    distritoByTerna.set(`${pk}::${ck}::${dk}`, distritoId);
    distritosPoblados += 1;
  }

  return { distritoByTerna, distritosPoblados, filasOmitidas };
}

/**
 * R35/R37/R39: pre-crea las zonas deducidas de la columna `Zona`, deduplicadas por
 * clave normalizada, con es_central=false (default). En re-corridas el
 * `update: {}` NO pisa es_central editado por el maestro. Devuelve key -> zonaId.
 */
export async function seedZonas(prisma: ZonaPrisma, hints: ZonaHintRow[]): Promise<Map<string, string>> {
  const zonaByKey = new Map<string, string>();
  for (const row of hints) {
    const key = normalizeZonaKey(row.zona);
    if (key === null) continue; // R36: sin zona
    if (zonaByKey.has(key)) continue; // R35: dedup
    const canonical = canonicalZonaNombre(row.zona);
    if (canonical === null) continue;
    const zona = await prisma.zona.upsert({
      where: { nombre: canonical },
      update: {}, // R39: no sobrescribe es_central ya editado
      create: { nombre: canonical }, // R35/R37: es_central false por default
      select: { id: true },
    });
    zonaByKey.set(key, zona.id);
  }
  return zonaByKey;
}

export interface CruceResult {
  asignados: number;
  ternasSinCorrespondencia: number;
  filasOmitidas: number;
}

/**
 * R36/R38: por cada terna del Excel original, resuelve el distrito del mapa
 * completo (clave normalizada prov+canton+distrito) y le asigna la zona. Ternas sin
 * distrito o con zona vacia se reportan/omiten sin fallar. NUNCA toca es_central (R37).
 */
export async function cruzarZonas(
  prisma: DistritoPrisma,
  hints: ZonaHintRow[],
  zonaByKey: Map<string, string>,
  distritoByTerna: Map<string, string>,
): Promise<CruceResult> {
  let asignados = 0;
  let ternasSinCorrespondencia = 0;
  let filasOmitidas = 0;

  for (const row of hints) {
    const pk = normalizeZonaKey(row.provincia);
    const ck = normalizeZonaKey(row.canton);
    const dk = normalizeZonaKey(row.distrito);
    if (pk === null || ck === null || dk === null) {
      filasOmitidas += 1; // R38: fila incompleta
      continue;
    }

    const distritoId = distritoByTerna.get(`${pk}::${ck}::${dk}`);
    if (distritoId === undefined) {
      ternasSinCorrespondencia += 1; // R38: terna sin correspondencia en el mapa completo
      continue;
    }

    const zk = normalizeZonaKey(row.zona);
    if (zk === null) continue; // R36: zona vacia -> distrito queda con zona_id NULL

    const zonaId = zonaByKey.get(zk);
    if (zonaId === undefined) {
      ternasSinCorrespondencia += 1; // defensivo: no deberia ocurrir tras seedZonas
      continue;
    }

    await prisma.distrito.update({ where: { id: distritoId }, data: { zonaId } }); // R36
    asignados += 1;
  }

  return { asignados, ternasSinCorrespondencia, filasOmitidas };
}

/**
 * Orquesta el seed completo (geografia -> zonas -> cruce) y devuelve el resumen
 * (R38). Idempotente (R39). Recibe el cliente Prisma por parametro para testear.
 */
export async function seedZonasCompleto(
  prisma: GeoPrisma & ZonaPrisma,
  geoRows: GeoRow[],
  hints: ZonaHintRow[],
): Promise<SeedZonasSummary> {
  const geo = await seedGeografia(prisma, geoRows);
  const zonaByKey = await seedZonas(prisma, hints);
  const cruce = await cruzarZonas(prisma, hints, zonaByKey, geo.distritoByTerna);

  return {
    distritosPoblados: geo.distritosPoblados,
    distritosConZona: cruce.asignados,
    distritosSinZona: geo.distritosPoblados - cruce.asignados,
    zonasCreadas: zonaByKey.size,
    ternasSinCorrespondencia: cruce.ternasSinCorrespondencia,
    filasOmitidas: geo.filasOmitidas + cruce.filasOmitidas,
  };
}

// --- Entrypoint (gate de despliegue R40) ---

const GEO_XLSX_PATH = process.env.SEED_GEO_XLSX ?? "public/geografia-cr-completa.xlsx";
const ZONA_XLSX_PATH = process.env.SEED_ZONA_XLSX ?? "public/mapa-geografico-costa-rica.xlsx";
const ZONA_SHEET_NAME = process.env.SEED_ZONA_SHEET ?? "Jerarquía (revisar)";

async function loadWorksheet(path: string, sheet?: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(`No se encontro la hoja ${sheet ?? "(primera)"} en ${path}`);
  }
  return worksheet;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const geoWs = await loadWorksheet(GEO_XLSX_PATH);
  const zonaWs = await loadWorksheet(ZONA_XLSX_PATH, ZONA_SHEET_NAME);
  const geoRows = parseGeografiaRows(geoWs);
  const hints = parseZonaHintRows(zonaWs);

  const prisma = getPrismaClient();
  try {
    const summary = await seedZonasCompleto(prisma, geoRows, hints);
    console.log("Seed de zonas completado:", JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el seed de zonas:", error);
    process.exit(1);
  });
}
