import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 123 / T7 — los dos guards de la feature. Cubren R29 y R44.
//
// T7.1 FRONTERA (R44): la tabla nace SIN consumidores. El job que la puebla es la 124, el
// backfill la 125 y las consultas la 126. Mientras dure esta feature, ningun archivo de
// codigo debe leerla ni escribirla. Es una frontera VERIFICADA, no prometida.
//
// T7.2 TRIPWIRE DE SUMA (R29): `ordenes_estado_stock` es un STOCK al corte y sumarla entre
// fechas cuenta la misma orden una vez por dia que estuvo viva — un numero plausible que
// nadie detecta. Este guard pasa hoy EN VACIO (no hay consumidores) y ahi esta su valor:
// esta armado ANTES de que llegue la 126. Para que no sea una asercion vacia, el propio
// archivo comprueba que DISCRIMINA, alimentando al analizador con cadenas de prueba
// sinteticas: si el analizador dejara de detectar la agregacion sobre un rango, este
// archivo se pone rojo aunque el repo siga limpio.

const ROOT = path.join(__dirname, "..", "..", "..");

/** Directorios de CODIGO que se rastrean. `db/`, `specs/`, `tests/` y `progress/` no. */
const DIRS_CODIGO = ["app", "lib", "scripts", "components", "hooks", "providers", "e2e"];

/** Solo `lib/` y `app/` para el tripwire de suma (R29 lo dice literalmente). */
const DIRS_TRIPWIRE = ["lib", "app"];

const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function recorrer(dir: string): readonly string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      salida.push(...recorrer(rel));
    } else if (EXTENSIONES.includes(path.extname(entrada.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

/** Ruta relativa con separadores POSIX, para comparar igual en Windows y en CI. */
const posix = (p: string) => p.split(path.sep).join("/");

const ARCHIVOS_CODIGO = DIRS_CODIGO.flatMap(recorrer).map(posix);
const ARCHIVOS_TRIPWIRE = DIRS_TRIPWIRE.flatMap(recorrer).map(posix);

function leer(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/* -------------------------------------------------------------------------- */
/* T7.1 — frontera (R44)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Los DOS unicos archivos de codigo que pueden nombrar la tabla, y por que:
 * - `lib/analytics/types.ts`: el literal es el tipo `TablaRollup` del contrato de la 135.
 * - `lib/analytics/metrics.ts`: el catalogo de la 135 DECLARA la fuente de sus 14 metricas
 *   snapshot (`fuente: { tipo: "rollup", tablas: ["analytics_daily"] }`). Es una
 *   declaracion, no un acceso: el caso de abajo comprueba que TODA ocurrencia en ese
 *   archivo esta dentro de un `tablas: [...]` y que no hay ni una consulta.
 *
 * `tasks.md` T7.1 solo cita `types.ts`; `metrics.ts` se admite aqui porque su referencia
 * es anterior a esta feature (135, ya mergeada) y es declarativa. Queda anotado.
 */
const ARCHIVOS_QUE_PUEDEN_NOMBRARLA = ["lib/analytics/types.ts", "lib/analytics/metrics.ts"];

/** Formas de ACCEDER a la tabla. Ninguna es legal en esta feature, ni siquiera en el catalogo. */
const ACCESOS = [
  /prisma\s*\.\s*analyticsDaily/,
  /db\s*\.\s*analyticsDaily/,
  /\banalyticsDaily\s*\.\s*(findMany|findFirst|findUnique|create|createMany|update|updateMany|upsert|delete|deleteMany|aggregate|groupBy|count)\b/,
  /\bFROM\s+"?analytics_daily"?/i,
  /\bINTO\s+"?analytics_daily"?/i,
  /\bUPDATE\s+"?analytics_daily"?/i,
  /\bJOIN\s+"?analytics_daily"?/i,
];

describe("R44 — la tabla nace sin consumidores: frontera con la 124/125/126", () => {
  it("el rastreo encuentra archivos (si no, el guard seria vacio)", () => {
    expect(ARCHIVOS_CODIGO.length).toBeGreaterThan(100);
    for (const permitido of ARCHIVOS_QUE_PUEDEN_NOMBRARLA) {
      expect(ARCHIVOS_CODIGO).toContain(permitido);
    }
  });

  it("ningun archivo de codigo nombra `analytics_daily` ni `analyticsDaily`, salvo el contrato de la 135", () => {
    const infractores = ARCHIVOS_CODIGO.filter(
      (rel) =>
        !ARCHIVOS_QUE_PUEDEN_NOMBRARLA.includes(rel) &&
        /analytics_daily|analyticsDaily/.test(leer(rel)),
    );
    expect(
      infractores,
      `la feature 123 entrega SOLO el DDL (R44): el job es la 124, el backfill la 125 y las consultas la 126. Estos archivos ya la nombran: ${infractores.join(", ")}`,
    ).toEqual([]);
  });

  it("no existe ningun job, servicio, repositorio, Server Action ni ruta que la lea o la escriba", () => {
    const accesos: string[] = [];
    for (const rel of ARCHIVOS_CODIGO) {
      const contenido = leer(rel);
      for (const patron of ACCESOS) {
        if (patron.test(contenido)) accesos.push(`${rel} :: ${patron}`);
      }
    }
    expect(accesos).toEqual([]);
  });

  it("en el catalogo de la 135 el literal es una DECLARACION de fuente, no una consulta", () => {
    // Sin las lineas de comentario: la cabecera del catalogo EXPLICA que ninguna metrica
    // financiera puede citar `analytics_daily`, y esa prosa no es una referencia al codigo.
    const metrics = leer("lib/analytics/metrics.ts").replace(/^\s*\/\/.*$/gm, "");
    const ocurrencias = metrics.match(/analytics_daily/g) ?? [];
    const declaraciones = metrics.match(/tablas: \["analytics_daily"\]/g) ?? [];
    expect(ocurrencias.length).toBeGreaterThan(0);
    expect(declaraciones.length).toBe(ocurrencias.length);

    const types = leer("lib/analytics/types.ts");
    expect(types).toMatch(/type TablaRollup = "analytics_daily"/);
  });

  it("la feature no anade repositorio, servicio ni interfaz de la tabla", () => {
    for (const patron of [/AnalyticsDailyRepo/, /AnalyticsDailyService/, /IAnalyticsDaily/]) {
      expect(ARCHIVOS_CODIGO.filter((rel) => patron.test(leer(rel)))).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* T7.2 — tripwire de suma (R29)                                               */
/* -------------------------------------------------------------------------- */

const COLUMNA_STOCK = /ordenes_estado_stock|ordenesEstadoStock/g;

/** Las tres formas de agregar que cita R29, mas las equivalentes de Prisma. */
const AGREGACION = /\bSUM\s*\(|_sum\b|\bsum\s*:|\bgroupBy\b|\baggregate\b/i;

/**
 * Marcas de que la agregacion abarca VARIAS fechas. `desde`/`hasta` entran porque son el
 * vocabulario de `RangoResuelto` (feature 135), que es justo lo que la 126 va a usar.
 */
const RANGO =
  /\bBETWEEN\b|\bgte\b|\blte\b|\bgt\s*:|\blt\s*:|"?fecha"?\s*(>=|<=|>|<)|fecha\s*:\s*\{|\bdesdeFecha\b|\bhastaFecha\b|\bdesde\b|\bhasta\b/i;

/** Marca de que la consulta esta clavada a UNA fecha: `fecha = x` o `fecha: x` escalar. */
const FECHA_UNICA = /"?fecha"?\s*(?::|=(?!=))\s*(?!\{)/i;

/** Ventana de contexto alrededor de la columna, en caracteres. */
const VENTANA = 400;

/**
 * Devuelve las agregaciones de `ordenes_estado_stock` que NO estan acotadas a una fecha
 * unica. Devolver la lista (y no un booleano) es lo que permite que el mensaje de error
 * diga QUE se encontro, y lo que permite alimentarlo con cadenas sinteticas para
 * comprobar que discrimina.
 */
function agregacionesSinFechaUnica(contenido: string): readonly string[] {
  const hallazgos: string[] = [];
  for (const m of contenido.matchAll(COLUMNA_STOCK)) {
    const i = m.index ?? 0;
    const ventana = contenido.slice(Math.max(0, i - VENTANA), i + VENTANA);
    if (!AGREGACION.test(ventana)) continue;
    if (RANGO.test(ventana) || !FECHA_UNICA.test(ventana)) {
      hallazgos.push(ventana.replace(/\s+/g, " ").trim().slice(0, 200));
    }
  }
  return hallazgos;
}

describe("R29 — el tripwire DISCRIMINA: cadenas de prueba sinteticas", () => {
  it("caza un SUM SQL de la columna sobre un rango de fechas", () => {
    const malo = `
      const filas = await prisma.$queryRaw\`
        SELECT zona_id, SUM(ordenes_estado_stock) AS total
        FROM analytics_daily
        WHERE fecha BETWEEN \${desdeFecha} AND \${hastaFecha}
        GROUP BY zona_id\`;
    `;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("caza el `_sum` de Prisma sobre un rango de fechas", () => {
    const malo = `
      const total = await prisma.analyticsDaily.aggregate({
        _sum: { ordenesEstadoStock: true },
        where: { fecha: { gte: rango.desde, lte: rango.hasta } },
      });
    `;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("caza una agregacion sin ninguna acotacion por fecha", () => {
    const malo = `const total = filas.reduce((acc, f) => acc + f.ordenesEstadoStock, 0); // sum: embudo`;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("NO se queja de una agregacion clavada a UNA fecha (el uso legitimo del embudo)", () => {
    const bueno = `
      SELECT estatus_id, SUM(ordenes_estado_stock) AS total
      FROM analytics_daily
      WHERE fecha = $1
      GROUP BY estatus_id
    `;
    expect(agregacionesSinFechaUnica(bueno)).toEqual([]);
  });

  it("NO se queja del `_sum` de Prisma con la fecha escalar", () => {
    const bueno = `
      const embudo = await prisma.analyticsDaily.groupBy({
        by: ["estatusId"],
        _sum: { ordenesEstadoStock: true },
        where: { fecha: fechaDelCorte },
      });
    `;
    expect(agregacionesSinFechaUnica(bueno)).toEqual([]);
  });

  it("NO se queja de una simple lectura de la columna sin agregar", () => {
    const bueno = `const stock = fila.ordenesEstadoStock;`;
    expect(agregacionesSinFechaUnica(bueno)).toEqual([]);
  });
});

describe("R29 — ningun archivo de `lib/` ni `app/` suma `ordenes_estado_stock` entre fechas", () => {
  it("el rastreo cubre lib/ y app/ (si no, el guard seria vacio)", () => {
    expect(ARCHIVOS_TRIPWIRE.length).toBeGreaterThan(100);
    expect(ARCHIVOS_TRIPWIRE.some((f) => f.startsWith("lib/"))).toBe(true);
    expect(ARCHIVOS_TRIPWIRE.some((f) => f.startsWith("app/"))).toBe(true);
  });

  it("no hay ni una agregacion de la columna fuera de una fecha unica", () => {
    const infracciones: string[] = [];
    for (const rel of ARCHIVOS_TRIPWIRE) {
      for (const hallazgo of agregacionesSinFechaUnica(leer(rel))) {
        infracciones.push(`${rel}: ${hallazgo}`);
      }
    }
    expect(
      infracciones,
      "`ordenes_estado_stock` es un STOCK al corte del dia (R28): sumarla entre fechas cuenta la misma orden una vez por cada dia que estuvo viva. Agrega dentro de UNA fecha, o usa `ordenes_creadas`, que si es un flujo.",
    ).toEqual([]);
  });
});
