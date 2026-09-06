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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// FICHA 375 — EL CRUCE VA POR `codigo_dta`, NO POR NOMBRE.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// LO QUE ESTABA MAL, Y ES LA RAZON DE SER DE LA FICHA. Hasta hoy este seed resolvia la geografia
// por NOMBRE EXACTO dentro del padre y, si no la encontraba, CREABA. El nombre hacia de clave sin
// serlo: en cuanto un maestro renombrara un distrito desde /configuracion/geografia, la siguiente
// corrida de este script no lo encontraria y crearia un DUPLICADO ACTIVO con el nombre viejo. A
// partir de ahi `resolveGeo` responderia «distrito ambiguo en el canton» a TODA carga masiva que
// lo mencione, y el `@@unique([canton_id, nombre])` NO lo atraparia: los nombres difieren. Por eso
// la ficha 374 dejo el renombrado fuera de alcance a proposito.
//
// LO QUE HACE AHORA. Cada fila del .xlsx trae su `Codigo DTA` (5 digitos del distrito), del que se
// derivan por PREFIJO el del canton (3) y el de la provincia (1) — la DTA es jerarquica por
// construccion. La resolucion es, en este orden:
//   1. por `codigo_dta` si la fila lo trae;
//   2. si no lo trae, o si ningun nodo lo tiene todavia, por NOMBRE dentro del padre (el respaldo
//      de siempre, para lo que no tiene codigo oficial: un nodo dado de alta a mano);
//   3. si tampoco, se CREA — con su codigo si la fila lo traia.
//
// ⚠️ EL NOMBRE ES AHORA UNA ETIQUETA MUTABLE: cuando el nodo se resuelve por codigo, este script
// NO reescribe su `nombre` con el del .xlsx. Es deliberado y es lo que hace seguro el renombrado:
// el .xlsx es la foto de la DTA, y el nombre vigente lo decide el maestro en la pantalla.
//
// LA UNICA ESCRITURA NUEVA es la ADOPCION del codigo (paso 2): a un nodo resuelto por nombre y con
// `codigo_dta` NULL se le pone el de la fila. Sin ella el respaldo por nombre no converge nunca —un
// nodo creado a mano al que el IGN le asigne codigo despues seguiria sin clave estable, y su primer
// renombrado volveria a duplicarlo—. Nunca PISA un codigo ya puesto.

// --- Tipos de fila de cada fuente ---
export interface GeoRow {
  provincia: string;
  canton: string;
  distrito: string;
  /** FICHA 375: el codigo DTA del DISTRITO (5 digitos). Cadena vacia si el .xlsx no lo trae. */
  codigoDta: string;
}

export interface ZonaHintRow {
  provincia: string;
  canton: string;
  distrito: string;
  zona: string;
}

/**
 * FICHA 375 — como se resolvio cada nodo. Se cuenta para poder AFIRMAR que el cruce fue por codigo
 * en vez de suponerlo: una corrida con `porNombre` alto sobre un catalogo ya backfilleado significa
 * que algo no cuadra entre el .xlsx y la base.
 */
export interface ResolucionGeoStats {
  porCodigo: number;
  porNombre: number;
  creados: number;
  /** Nodos resueltos por nombre a los que se les puso el codigo que no tenian. */
  codigosAdoptados: number;
}

export interface SeedZonasSummary {
  distritosPoblados: number; // desde el mapa completo (R38)
  distritosConZona: number; // cruzados con exito (R38)
  distritosSinZona: number; // sin match/zona vacia -> NULL (R36/R38)
  zonasCreadas: number; // zonas deducidas y deduplicadas (R35/R38)
  ternasSinCorrespondencia: number; // hints sin distrito en el mapa completo (R38)
  filasOmitidas: number; // filas incompletas de cualquiera de las fuentes (R38)
  /** FICHA 375: el desglose de la resolucion, sumado sobre los TRES niveles. */
  resolucion: ResolucionGeoStats;
}

// Clientes Prisma acotados (permite mockear en tests sin la conexion real).
type GeoPrisma = Pick<PrismaClient, "provincia" | "canton" | "distrito">;
type ZonaPrisma = Pick<PrismaClient, "zona">;
// Feature 69/R28: el cruce escribe la relacion N:M `zona_distrito` (feature 24), NO
// `distrito.zona_id` — esa columna la dropeo `20260713000000_drop_distrito_zona_id`.
type DistritoPrisma = Pick<PrismaClient, "zonaDistrito">;

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

/**
 * Fuente GEOGRAFIA (mapa oficial completo): columnas Provincia/Canton/Distrito y —desde la ficha
 * 375— `Codigo DTA`.
 *
 * La cabecera se busca por su clave normalizada (`codigo dta`), como todas las demas, asi que
 * tolera acentos y mayusculas. Un .xlsx SIN esa columna sigue leyendose: `codigoDta` queda vacio y
 * la resolucion cae al nombre, que es el respaldo declarado.
 */
export function parseGeografiaRows(ws: ExcelJS.Worksheet): GeoRow[] {
  return rowsFromWorksheet(ws).map((r) => ({
    provincia: r["provincia"] ?? "",
    canton: r["canton"] ?? "",
    distrito: r["distrito"] ?? "",
    codigoDta: r["codigo dta"] ?? "",
  }));
}

// --- FICHA 375: los tres codigos de una terna, derivados por prefijo ---

/** Longitud del codigo DTA de cada nivel. Jerarquico: el del padre es el prefijo del hijo. */
export const LARGO_CODIGO_DTA = { provincia: 1, canton: 3, distrito: 5 } as const;

export interface CodigosTerna {
  provincia: string;
  canton: string;
  distrito: string;
}

/**
 * Los codigos de los TRES niveles a partir del codigo del distrito. `null` cuando la fila no trae
 * codigo o cuando no es un codigo DTA valido.
 *
 * SE VALIDA LA FORMA (5 digitos exactos) en vez de confiar en el archivo: un codigo mal escrito
 * —cuatro digitos, un espacio, una letra— cruzaria con el nodo equivocado o con ninguno, y en el
 * segundo caso CREARIA un duplicado, que es justo el defecto que esta ficha cierra. Ante la duda,
 * `null`: se cae al nombre, que es el respaldo conocido.
 */
export function codigosDeLaTerna(codigoDistrito: string | null | undefined): CodigosTerna | null {
  const limpio = (codigoDistrito ?? "").trim();
  if (!/^\d{5}$/.test(limpio)) return null;
  return {
    provincia: limpio.slice(0, LARGO_CODIGO_DTA.provincia),
    canton: limpio.slice(0, LARGO_CODIGO_DTA.canton),
    distrito: limpio,
  };
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

// --- FICHA 375: upserts por CODIGO, con el nombre dentro del padre como respaldo ---

/** Un nodo tal y como lo devuelven las dos busquedas. */
interface NodoResuelto {
  id: string;
  codigoDta: string | null;
}

/**
 * Las cuatro operaciones que el resolutor necesita de UN nivel. Se pasan como funciones y no como
 * el delegado de Prisma para no tener que ensanchar (ni castear) sus tipos generados: cada nivel
 * las construye con SU delegado, ya tipado.
 */
interface PuertoNivel {
  buscarPorCodigo(codigo: string): Promise<NodoResuelto | null>;
  buscarPorNombre(): Promise<NodoResuelto | null>;
  adoptarCodigo(id: string, codigo: string): Promise<void>;
  crear(codigo: string | null): Promise<string>;
}

/**
 * EL RESOLUTOR, uno para los tres niveles.
 *
 *   1. POR CODIGO. Si la fila trae codigo, se busca por `codigo_dta`, que es unico en toda la
 *      tabla. Es lo que hace seguro el renombrado: el nodo se encuentra AUNQUE se llame distinto,
 *      y su `nombre` NO se toca —el .xlsx es la foto de la DTA; el nombre vigente lo decide el
 *      maestro en la pantalla—.
 *   2. POR NOMBRE dentro del padre. El respaldo de siempre, para lo que no tiene codigo. Si el
 *      nodo encontrado no tiene codigo y la fila si lo trae, lo ADOPTA: sin eso el respaldo no
 *      converge nunca y el primer renombrado de ese nodo volveria a duplicarlo. NUNCA pisa un
 *      codigo ya puesto — ese caso lo habria resuelto el paso 1.
 *   3. CREAR, con su codigo si lo hay.
 */
async function resolverNodo(
  puerto: PuertoNivel,
  codigo: string | null,
  stats: ResolucionGeoStats,
): Promise<string> {
  if (codigo !== null) {
    const porCodigo = await puerto.buscarPorCodigo(codigo);
    if (porCodigo !== null) {
      stats.porCodigo += 1;
      return porCodigo.id;
    }
  }

  const porNombre = await puerto.buscarPorNombre();
  if (porNombre !== null) {
    stats.porNombre += 1;
    if (codigo !== null && porNombre.codigoDta === null) {
      await puerto.adoptarCodigo(porNombre.id, codigo);
      stats.codigosAdoptados += 1;
    }
    return porNombre.id;
  }

  const id = await puerto.crear(codigo);
  stats.creados += 1;
  return id;
}

const SELECT_NODO = { id: true, codigoDta: true } as const;

async function upsertProvincia(
  prisma: GeoPrisma,
  nombre: string,
  codigo: string | null,
  stats: ResolucionGeoStats,
): Promise<string> {
  return resolverNodo(
    {
      buscarPorCodigo: (c) =>
        prisma.provincia.findFirst({ where: { codigoDta: c }, select: SELECT_NODO }),
      buscarPorNombre: () => prisma.provincia.findFirst({ where: { nombre }, select: SELECT_NODO }),
      adoptarCodigo: async (id, c) => {
        await prisma.provincia.update({ where: { id }, data: { codigoDta: c }, select: { id: true } });
      },
      crear: async (c) => {
        const fila = await prisma.provincia.create({
          data: { nombre, codigoDta: c },
          select: { id: true },
        });
        return fila.id;
      },
    },
    codigo,
    stats,
  );
}

async function upsertCanton(
  prisma: GeoPrisma,
  provinciaId: string,
  nombre: string,
  codigo: string | null,
  stats: ResolucionGeoStats,
): Promise<string> {
  return resolverNodo(
    {
      buscarPorCodigo: (c) =>
        prisma.canton.findFirst({ where: { codigoDta: c }, select: SELECT_NODO }),
      buscarPorNombre: () =>
        prisma.canton.findFirst({ where: { provinciaId, nombre }, select: SELECT_NODO }),
      adoptarCodigo: async (id, c) => {
        await prisma.canton.update({ where: { id }, data: { codigoDta: c }, select: { id: true } });
      },
      crear: async (c) => {
        const fila = await prisma.canton.create({
          data: { provinciaId, nombre, codigoDta: c },
          select: { id: true },
        });
        return fila.id;
      },
    },
    codigo,
    stats,
  );
}

async function upsertDistrito(
  prisma: GeoPrisma,
  cantonId: string,
  nombre: string,
  codigo: string | null,
  stats: ResolucionGeoStats,
): Promise<string> {
  return resolverNodo(
    {
      buscarPorCodigo: (c) =>
        prisma.distrito.findFirst({ where: { codigoDta: c }, select: SELECT_NODO }),
      buscarPorNombre: () =>
        prisma.distrito.findFirst({ where: { cantonId, nombre }, select: SELECT_NODO }),
      adoptarCodigo: async (id, c) => {
        await prisma.distrito.update({
          where: { id },
          data: { codigoDta: c },
          select: { id: true },
        });
      },
      crear: async (c) => {
        const fila = await prisma.distrito.create({
          data: { cantonId, nombre, codigoDta: c },
          select: { id: true },
        });
        return fila.id;
      },
    },
    codigo,
    stats,
  );
}

export interface GeografiaResult {
  /** terna normalizada `prov::canton::distrito` -> distritoId (para el cruce). */
  distritoByTerna: Map<string, string>;
  distritosPoblados: number;
  filasOmitidas: number;
  /** FICHA 375: como se resolvio cada nodo, sumado sobre los tres niveles. */
  resolucion: ResolucionGeoStats;
}

/**
 * R34/R39: puebla provincia -> canton -> distrito y devuelve el indice del cruce, sin duplicar en
 * re-corridas.
 *
 * ⚠️ FICHA 375 — LA RESOLUCION VA POR `codigo_dta` Y EL NOMBRE ES EL RESPALDO. Ver la cabecera del
 * archivo: mientras cruzara por nombre, un renombrado desde la pantalla creaba un duplicado activo
 * en la siguiente corrida.
 *
 * EL INDICE DEL CRUCE (`distritoByTerna`) SIGUE SIENDO POR NOMBRE, y eso NO es una incoherencia:
 * su clave se compara contra el OTRO .xlsx —`mapa-geografico-costa-rica.xlsx`, la fuente de las
 * zonas—, que no tiene codigos. Las dos fuentes hablan el mismo idioma (los nombres de la DTA), asi
 * que el cruce entre ellas sigue funcionando aunque la base llame al nodo de otra forma.
 */
export async function seedGeografia(prisma: GeoPrisma, rows: GeoRow[]): Promise<GeografiaResult> {
  const distritoByTerna = new Map<string, string>();
  const provinciaIdByKey = new Map<string, string>();
  const cantonIdByKey = new Map<string, string>();
  const resolucion: ResolucionGeoStats = {
    porCodigo: 0,
    porNombre: 0,
    creados: 0,
    codigosAdoptados: 0,
  };
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

    // FICHA 375: los tres codigos salen del codigo del distrito por prefijo. `null` cuando la fila
    // no lo trae o no es un codigo DTA valido -> los tres niveles caen al nombre.
    const codigos = codigosDeLaTerna(row.codigoDta);

    let provinciaId = provinciaIdByKey.get(pk);
    if (provinciaId === undefined) {
      provinciaId = await upsertProvincia(
        prisma,
        row.provincia,
        codigos?.provincia ?? null,
        resolucion,
      );
      provinciaIdByKey.set(pk, provinciaId);
    }

    const cantonMapKey = `${pk}::${ck}`;
    let cantonId = cantonIdByKey.get(cantonMapKey);
    if (cantonId === undefined) {
      cantonId = await upsertCanton(
        prisma,
        provinciaId,
        row.canton,
        codigos?.canton ?? null,
        resolucion,
      );
      cantonIdByKey.set(cantonMapKey, cantonId);
    }

    const distritoId = await upsertDistrito(
      prisma,
      cantonId,
      row.distrito,
      codigos?.distrito ?? null,
      resolucion,
    );
    distritoByTerna.set(`${pk}::${ck}::${dk}`, distritoId);
    distritosPoblados += 1;
  }

  return { distritoByTerna, distritosPoblados, filasOmitidas, resolucion };
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

    // R36 + feature 69/R28: la zona del distrito vive en la N:M `zona_distrito` (feature 24,
    // `@@unique([zonaId, distritoId])`). Upsert sobre el par => idempotente (R39): re-correr el
    // seed no duplica la relacion. `update: {}` porque la fila puente no tiene mas datos que el par.
    await prisma.zonaDistrito.upsert({
      where: { zonaId_distritoId: { zonaId, distritoId } },
      update: {},
      create: { zonaId, distritoId },
    });
    asignados += 1;
  }

  return { asignados, ternasSinCorrespondencia, filasOmitidas };
}

/**
 * Orquesta el seed completo (geografia -> zonas -> cruce) y devuelve el resumen
 * (R38). Idempotente (R39). Recibe el cliente Prisma por parametro para testear.
 */
export async function seedZonasCompleto(
  prisma: GeoPrisma & ZonaPrisma & DistritoPrisma,
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
    resolucion: geo.resolucion,
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
