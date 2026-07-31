import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

// Feature 135 / T2.1 — GUARDIA de R1 (modulo puro) y R2 (fuente unica del catalogo).
//
// Por que existe, con todas las letras: `lib/analytics/` es el modulo FUNDACIONAL del
// lote 122-134. Trece features van a importarlo. Si un solo archivo de aqui arrastra
// `@/lib/db`, un repositorio, un servicio, `next/headers` o el cliente Prisma, el
// contrato deja de poder importarse desde un test unitario, desde un script o desde un
// entorno sin base de datos, y las trece features heredan ese acoplamiento sin darse
// cuenta. Lo mismo con `'use server'`: convertiria el catalogo en un endpoint.
//
// R2 es la otra mitad: el catalogo se declara UNA vez, en `lib/analytics/metrics.ts`.
// Si alguna feature consumidora se declara "su" metrica en `app/` o en un servicio,
// el catalogo deja de ser fuente unica y las cifras divergen en silencio.
//
// ---------------------------------------------------------------------------
// DECISION DOCUMENTADA: QUE SE CENSA, EL CODIGO O TAMBIEN LOS COMENTARIOS
// ---------------------------------------------------------------------------
// Se censa **solo el codigo**: se retiran comentarios de bloque y de linea antes de
// buscar. Es la misma decision (y las mismas dos funciones) de
// `tests/unit/analytics/ranges-reuso.guardia.test.ts`, y por la misma razon: la
// documentacion de estos modulos esta OBLIGADA a nombrar lo que no debe usar.
//   - `ranges.ts` tiene que citar `RankingService` y su ventana 18:00-18:00 (tasks
//     T4.1(c) / D6), y el guardia de reuso incluso lo EXIGE.
//   - las cabeceras de los cuatro modulos declaran a proposito "no importa @/lib/db,
//     ni repositorios, ni servicios, ni next/headers, ni @prisma/client".
// Censar el texto crudo convertiria esas frases —que son el contrato escrito— en
// violaciones. Nombrar la trampa es obligatorio; usarla es lo prohibido.
//
// El censo de imports NO es textual sino por especificador de modulo: se extrae el
// modulo de cada `import`/`export ... from`, `import(...)` y `require(...)`, y se
// juzga la RUTA, no la linea. Asi `// no importes @/lib/db` es inocuo y
// `import { db } from "@/lib/db"` cae, sin depender del formato del import.
//
// Excepcion explicita de `@prisma/client`: se prohibe como import de VALOR (arrastra
// el cliente generado, que exige `DATABASE_URL` y un `prisma generate` previo) y se
// permite como `import type`, que se borra en compilacion y no existe en runtime.
// Nota: hoy ningun archivo de `lib/analytics/` importa `@prisma/client` ni siquiera
// como tipo — `types.ts` declara `RolAnalitica` como union literal propia y la ata al
// esquema desde `types.test.ts`. La distincion se mantiene porque la consistencia con
// el esquema puede querer resolverse asi mas adelante sin romper R1.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_ANALYTICS = path.join(REPO_ROOT, "lib", "analytics");
const METRICS_PATH = path.join(DIR_ANALYTICS, "metrics.ts");

/**
 * Los modulos del contrato: los cuatro de la 135 (T1.1, T3.1, T4.1, T5.1) y los cinco
 * de la 122 (alcance, alcance-columnas, consulta, identidad, auditoria). Los cargadores son
 * `import()` con literal estatico a proposito: un `import(\`.../${variable}\`)` no lo
 * puede resolver el bundler y el test pasaria a depender de resolucion en runtime.
 */
const CARGADORES = {
  types: () => import("@/lib/analytics/types"),
  metrics: () => import("@/lib/analytics/metrics"),
  ranges: () => import("@/lib/analytics/ranges"),
  filters: () => import("@/lib/analytics/filters"),
  // Feature 122 (T5.1 / D8): los cinco modulos del resolutor de alcance entran en el
  // MISMO guardia. No hay un segundo guardia de pureza: hay uno, y es este.
  alcance: () => import("@/lib/analytics/alcance"),
  "alcance-columnas": () => import("@/lib/analytics/alcance-columnas"),
  consulta: () => import("@/lib/analytics/consulta"),
  identidad: () => import("@/lib/analytics/identidad"),
  auditoria: () => import("@/lib/analytics/auditoria"),
} as const;

const MODULOS = Object.keys(CARGADORES) as (keyof typeof CARGADORES)[];

/* -------------------------------------------------------------------------- */
/* Utilidades de censo                                                         */
/* -------------------------------------------------------------------------- */

/** Quita comentarios de bloque, de linea y trailing, para censar solo el codigo. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

interface ReferenciaModulo {
  /** La ruta del modulo importado, tal cual aparece entre comillas. */
  readonly especificador: string;
  /** `true` si es `import type` / `export type`, que desaparece en compilacion. */
  readonly soloTipo: boolean;
}

/**
 * Extrae toda referencia a otro modulo del codigo dado: imports estaticos (incluido
 * el de solo efecto `import "x"`), re-exports, `import()` dinamico y `require()`.
 * Se apoya en que ningun `import` estatico contiene `;` ni comillas antes del `from`.
 */
function referenciasDeModulo(codigo: string): ReferenciaModulo[] {
  const referencias: ReferenciaModulo[] = [];

  const estatico = /\b(?:import|export)\s+(type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of codigo.matchAll(estatico)) {
    referencias.push({ especificador: m[2], soloTipo: m[1] !== undefined });
  }

  const dinamico = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of codigo.matchAll(dinamico)) {
    referencias.push({ especificador: m[1], soloTipo: false });
  }

  return referencias;
}

/**
 * Segmentos significativos de una ruta de modulo: se descartan `.`, `..` y el alias
 * `@`. Se juzga por segmento y no por prefijo literal para que un rodeo relativo
 * (`../db/client`, `../../services/Foo`) caiga igual que `@/lib/services/Foo`.
 */
function segmentos(especificador: string): string[] {
  return especificador.split("/").filter((s) => s !== "" && s !== "." && s !== ".." && s !== "@");
}

/** Capas del repo que un modulo puro no puede tocar (R1). */
const CAPAS_PROHIBIDAS = ["db", "repositories", "services", "actions"] as const;

/** Modulos de runtime de Next prohibidos: leen la peticion, luego exigen servidor. */
const MODULOS_DE_PETICION = ["next/headers", "next/cache", "server-only"];

interface Violacion {
  readonly archivo: string;
  readonly motivo: string;
}

function violacionesDeImports(nombreArchivo: string, fuente: string): Violacion[] {
  const violaciones: Violacion[] = [];

  for (const ref of referenciasDeModulo(soloCodigo(fuente))) {
    const partes = segmentos(ref.especificador);
    const capa = CAPAS_PROHIBIDAS.find((c) => partes.includes(c));
    if (capa) {
      violaciones.push({
        archivo: nombreArchivo,
        motivo: `importa la capa "${capa}" via "${ref.especificador}"`,
      });
    }
    if (MODULOS_DE_PETICION.includes(ref.especificador)) {
      violaciones.push({
        archivo: nombreArchivo,
        motivo: `importa "${ref.especificador}", que solo existe en el servidor`,
      });
    }
    // `@prisma/client` SOLO como import de tipo: como valor arrastra el cliente
    // generado y con el la exigencia de `DATABASE_URL`.
    if (partes[0] === "@prisma" || ref.especificador.startsWith("@prisma/")) {
      if (!ref.soloTipo) {
        violaciones.push({
          archivo: nombreArchivo,
          motivo: `importa "${ref.especificador}" como VALOR (solo se admite import type)`,
        });
      }
    }
  }

  return violaciones;
}

/** Directiva que convertiria el catalogo en un endpoint. */
function declaraUseServer(fuente: string): boolean {
  return /(^|\s)["']use server["']/.test(soloCodigo(fuente));
}

function archivosDeAnalytics(): string[] {
  return fs
    .readdirSync(DIR_ANALYTICS)
    .filter((nombre) => nombre.endsWith(".ts"))
    .map((nombre) => path.join(DIR_ANALYTICS, nombre));
}

/** Recorre `.ts`/`.tsx` de un directorio del repo, sin artefactos ni dependencias. */
const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

function archivosDeCodigo(raiz: string): string[] {
  if (!fs.existsSync(raiz)) return [];
  const encontrados: string[] = [];
  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    const completa = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      if (DIRS_IGNORADOS.has(entrada.name)) continue;
      encontrados.push(...archivosDeCodigo(completa));
    } else if (entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx")) {
      encontrados.push(completa);
    }
  }
  return encontrados;
}

/** Las cuatro carpetas que R2 obliga a censar. */
function archivosCensablesDelRepo(): string[] {
  return ["app", "lib", "components", "scripts"].flatMap((d) =>
    archivosDeCodigo(path.join(REPO_ROOT, d)),
  );
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/* -------------------------------------------------------------------------- */
/* R1 · el modulo es puro                                                      */
/* -------------------------------------------------------------------------- */

describe("R1 · lib/analytics no importa infraestructura", () => {
  it("censa los nueve modulos del contrato y ninguno mas se cuela sin vigilancia", () => {
    // Si manana alguien anade `lib/analytics/rollup.ts`, el censo lo cubre solo
    // (se lee el directorio, no una lista fija). Esta asercion solo garantiza que
    // los cuatro que el spec nombra estan presentes.
    const nombres = archivosDeAnalytics().map((a) => path.basename(a, ".ts"));
    for (const modulo of MODULOS) {
      expect(nombres, `falta lib/analytics/${modulo}.ts`).toContain(modulo);
    }
  });

  it("no declara use server en ningun archivo de lib/analytics", () => {
    for (const archivo of archivosDeAnalytics()) {
      expect(declaraUseServer(fs.readFileSync(archivo, "utf8")), relativa(archivo)).toBe(false);
    }
  });

  it("no importa @/lib/db, repositorios, servicios ni acciones en lib/analytics", () => {
    const violaciones = archivosDeAnalytics().flatMap((archivo) =>
      violacionesDeImports(relativa(archivo), fs.readFileSync(archivo, "utf8")).filter((v) =>
        v.motivo.startsWith("importa la capa"),
      ),
    );
    expect(violaciones.map((v) => `${v.archivo}: ${v.motivo}`)).toEqual([]);
  });

  it("no importa next/headers ni ningun modulo de peticion en lib/analytics", () => {
    const violaciones = archivosDeAnalytics().flatMap((archivo) =>
      violacionesDeImports(relativa(archivo), fs.readFileSync(archivo, "utf8")).filter((v) =>
        v.motivo.includes("solo existe en el servidor"),
      ),
    );
    expect(violaciones.map((v) => `${v.archivo}: ${v.motivo}`)).toEqual([]);
  });

  it("no importa @prisma/client como valor en lib/analytics", () => {
    const violaciones = archivosDeAnalytics().flatMap((archivo) =>
      violacionesDeImports(relativa(archivo), fs.readFileSync(archivo, "utf8")).filter((v) =>
        v.motivo.includes("@prisma"),
      ),
    );
    expect(violaciones.map((v) => `${v.archivo}: ${v.motivo}`)).toEqual([]);
  });

  it("no lee variables de entorno en lib/analytics", () => {
    // R1 dice "sin variables de entorno" con todas las letras: un `process.env.X`
    // al importar convierte el contrato en dependiente de la configuracion.
    for (const archivo of archivosDeAnalytics()) {
      const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
      expect(/process\s*\.\s*env/.test(codigo), relativa(archivo)).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R1 · el modulo se importa sin base de datos y sin efectos                    */
/* -------------------------------------------------------------------------- */

describe("R1 · lib/analytics se importa sin DATABASE_URL y sin efectos", () => {
  const ENV_ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Vacia el entorno de todo lo que huela a base de datos o a Supabase. */
  function entornoSinBaseDeDatos(): void {
    for (const clave of Object.keys(process.env)) {
      if (/DATABASE|POSTGRES|PRISMA|SUPABASE/i.test(clave)) delete process.env[clave];
    }
    expect(process.env.DATABASE_URL).toBeUndefined();
  }

  it("importa los nueve modulos sin DATABASE_URL y ninguno lanza", async () => {
    entornoSinBaseDeDatos();
    vi.resetModules();

    for (const modulo of MODULOS) {
      const cargado = await CARGADORES[modulo]();
      const exportados = Object.keys(cargado).length;
      expect(exportados, `lib/analytics/${modulo}.ts no exporto nada`).toBeGreaterThan(0);
    }
  });

  it("importar los nueve modulos no ejecuta efectos observables", async () => {
    entornoSinBaseDeDatos();
    vi.resetModules();

    // Los tres efectos que delatarian a un modulo no puro: hablar por consola,
    // salir a la red o escribir en el entorno del proceso.
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    const consola = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    const envAntes = JSON.stringify(process.env);

    for (const modulo of MODULOS) {
      await CARGADORES[modulo]();
    }

    expect(fetchEspia, "un modulo de analytics salio a la red al importarse").not.toHaveBeenCalled();
    expect(consola.log).not.toHaveBeenCalled();
    expect(consola.warn).not.toHaveBeenCalled();
    expect(consola.error).not.toHaveBeenCalled();
    expect(JSON.stringify(process.env)).toBe(envAntes);
  });

  it("importar dos veces devuelve exactamente los mismos valores congelados", async () => {
    entornoSinBaseDeDatos();
    vi.resetModules();

    const primera = await import("@/lib/analytics/metrics");
    const segunda = await import("@/lib/analytics/metrics");

    // Misma referencia: el modulo no reconstruye el catalogo en cada acceso, o sea
    // no hay estado que dependa del momento de importacion.
    expect(segunda.METRICAS).toBe(primera.METRICAS);
  });
});

/* -------------------------------------------------------------------------- */
/* R2 · fuente unica del catalogo                                              */
/* -------------------------------------------------------------------------- */

/**
 * Una declaracion de metrica se reconoce por su campo `dominio` con uno de los dos
 * literales cerrados del contrato. Es la firma mas barata y la que pide la tabla de
 * trazabilidad de R2. No confunde el TIPO (`dominio: MetricaDominio`, sin comillas,
 * en `types.ts` y en la firma de `listarMetricas`) con el DATO.
 */
const RE_DECLARACION_METRICA = /\bdominio\s*:\s*["'](operativa|financiera)["']/;

/** R30: el cubo de las ordenes sin mensajero se escribe UNA vez, en `types.ts`. */
const RE_CUBO_SIN_ASIGNAR = /["']sin_asignar["']/;

describe("R2 · el catalogo de metricas se declara una sola vez", () => {
  it("metrics.ts es el unico archivo del repo que declara metricas", () => {
    const infractores = archivosCensablesDelRepo()
      .filter((archivo) => path.resolve(archivo) !== path.resolve(METRICS_PATH))
      .filter((archivo) => RE_DECLARACION_METRICA.test(soloCodigo(fs.readFileSync(archivo, "utf8"))))
      .map(relativa);

    expect(
      infractores,
      "declaran metricas fuera de lib/analytics/metrics.ts (R2: fuente unica)",
    ).toEqual([]);
  });

  it("metrics.ts si declara metricas: el censo mira donde debe", () => {
    // Contrapeso del caso anterior: si el censo dejara de encontrar NADA, el test de
    // arriba pasaria por vacio en vez de por limpio.
    const codigo = soloCodigo(fs.readFileSync(METRICS_PATH, "utf8"));
    expect(RE_DECLARACION_METRICA.test(codigo)).toBe(true);
  });

  it("el cubo sin_asignar se escribe una sola vez, en lib/analytics (R30)", () => {
    const infractores = archivosCensablesDelRepo()
      .filter((archivo) => !path.resolve(archivo).startsWith(path.resolve(DIR_ANALYTICS)))
      .filter((archivo) => RE_CUBO_SIN_ASIGNAR.test(soloCodigo(fs.readFileSync(archivo, "utf8"))))
      .map(relativa);

    expect(
      infractores,
      "escriben el literal sin_asignar a mano en vez de usar MENSAJERO_SIN_ASIGNAR",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Autocomprobacion del guardia                                                */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion · el censo detecta lo que dice detectar", () => {
  // Un guardia que dejara de detectar seguiria en verde para siempre. Estos casos
  // le pasan al censo codigo prohibido escrito a mano y exigen que caiga.

  it("detecta un import de valor de @/lib/db, @/lib/repositories y @/lib/services", () => {
    const casos = [
      'import { db } from "@/lib/db";',
      'import { OrdenRepository } from "@/lib/repositories/OrdenRepository";',
      'import { RankingService } from "@/lib/services/RankingService";',
      'import { db } from "../db/client";', // el rodeo relativo cae igual
      'export { db } from "@/lib/db";',
      'const { db } = require("@/lib/db");',
      'const m = await import("@/lib/services/CorteDiarioService");',
    ];
    for (const caso of casos) {
      expect(violacionesDeImports("ejemplo.ts", caso), caso).not.toEqual([]);
    }
  });

  it("detecta un import de next/headers", () => {
    expect(violacionesDeImports("ejemplo.ts", 'import { cookies } from "next/headers";')).not.toEqual(
      [],
    );
  });

  it("detecta @prisma/client como valor y admite el import de tipo", () => {
    expect(
      violacionesDeImports("ejemplo.ts", 'import { PrismaClient } from "@prisma/client";'),
    ).not.toEqual([]);
    expect(
      violacionesDeImports("ejemplo.ts", 'import type { Prisma } from "@prisma/client";'),
    ).toEqual([]);
  });

  it("no marca los imports legitimos que los modulos si usan hoy", () => {
    const legitimos = [
      'import type { OrderStatusValue } from "@/lib/types/order-status";',
      'import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";',
      'import { z } from "zod";',
      'import {\n  fechaCalendarioCR,\n  inicioDelDiaCREnUtc,\n} from "@/lib/utils/fecha-cr";',
    ];
    for (const caso of legitimos) {
      expect(violacionesDeImports("ejemplo.ts", caso), caso).toEqual([]);
    }
  });

  it("detecta la directiva use server y no la confunde con su mencion en un comentario", () => {
    expect(declaraUseServer('"use server";\nexport async function x() {}')).toBe(true);
    expect(declaraUseServer("'use server'\n")).toBe(true);
    expect(declaraUseServer('// este archivo no lleva "use server"\n')).toBe(false);
    expect(declaraUseServer('/* prohibido declarar "use server" aqui */\n')).toBe(false);
  });

  it("detecta una declaracion de metrica escrita a mano y no el tipo homonimo", () => {
    expect(RE_DECLARACION_METRICA.test('{ id: "mias", dominio: "operativa" }')).toBe(true);
    expect(RE_DECLARACION_METRICA.test("{ dominio: 'financiera' }")).toBe(true);
    expect(RE_DECLARACION_METRICA.test("readonly dominio: MetricaDominio;")).toBe(false);
    expect(RE_DECLARACION_METRICA.test("dominio?: MetricaDominio;")).toBe(false);
  });

  it("el censo del repo mira archivos de verdad en las cuatro carpetas de R2", () => {
    // Si `archivosCensablesDelRepo()` devolviera [] (ruta mal calculada, filtro roto),
    // los censos de R2 pasarian por vacio.
    const censados = archivosCensablesDelRepo().map(relativa);
    expect(censados.length).toBeGreaterThan(100);
    for (const carpeta of ["app/", "lib/", "components/", "scripts/"]) {
      expect(
        censados.some((f) => f.startsWith(carpeta)),
        `el censo de R2 no esta mirando ${carpeta}`,
      ).toBe(true);
    }
    expect(censados.some((f) => f.includes("node_modules"))).toBe(false);
  });
});

/* ========================================================================== */
/* Feature 122 (T5.1 / D8) — PUREZA **TRANSITIVA** (R35, R36)                 */
/* ========================================================================== */
//
// Por que se AMPLIA este archivo y no se crea otro: dos guardias de pureza es la forma
// mas rapida de que uno se quede atras y de que nadie sepa cual manda. D8 lo autorizo
// expresamente y R35 lo exige: **un solo guardia**.
//
// Que faltaba. Hasta aqui el censo miraba los imports DIRECTOS de `lib/analytics/`. Un
// archivo limpio que importe otro archivo sucio pasaba: `@/lib/auth/acceso-total` no es
// ninguna capa prohibida, pero ese archivo SI importa `@prisma/client` COMO VALOR
// (`lib/auth/acceso-total.ts:1`). La 122 esta obligada a reutilizarlo (D7 de la 135: el
// criterio de acceso total no se duplica), asi que la dependencia transitiva existe y
// alguien tiene que vigilarla.
//
// Que se hace. Se recorre la CLAUSURA de imports partiendo de `lib/analytics/**` hasta
// punto fijo (con conjunto de visitados: los ciclos no cuelgan), se aplican las reglas
// de arriba a CADA ARISTA, y la unica excepcion vive en una allowlist NOMINAL de una
// sola entrada.
//
// Por que la excepcion no es un agujero — tres candados que hay que romper a la vez:
//   1. es de ARISTA y NOMBRE, no de archivo ni de paquete: `acceso-total.ts` puede
//      importar `RolValue` y nada mas; un import de `PrismaClient` ahi la rompe;
//   2. es finita y vigilada: el guardia afirma `ARISTAS_PERMITIDAS.length === 1`, asi que
//      crecerla es un diff visible en un archivo llamado "guardia de pureza";
//   3. NO sustituye a la prueba empirica: la clausura entera se importa en un proceso sin
//      `DATABASE_URL`. Si algun dia el cliente generado adquiriese efectos al importarse,
//      la allowlist seguiria diciendo "permitido" y el import fallaria igual — que es el
//      orden correcto de prioridades. La lista solo evita un falso rojo estatico; la
//      verdad la dice la ejecucion.

/** R36 — allowlist NOMINAL de aristas. Exactamente UNA entrada, con su motivo escrito. */
const ARISTAS_PERMITIDAS = [
  {
    desde: "lib/auth/acceso-total.ts",
    especificador: "@prisma/client",
    nombres: ["RolValue"],
    motivo:
      "D7 de la 135 obliga a reutilizar esAccesoTotal(); RolValue es un enum generado, " +
      "objeto congelado sin efectos ni conexion (el cliente solo conecta al construirse). " +
      "La prueba real no es esta lista: es el import de la clausura sin DATABASE_URL.",
  },
] as const;

type FormaDeImport = "nombrada" | "default" | "namespace" | "efecto";

interface Arista {
  /** Ruta relativa al repo del archivo que importa. */
  readonly desde: string;
  readonly especificador: string;
  readonly soloTipo: boolean;
  readonly forma: FormaDeImport;
  readonly nombres: readonly string[];
}

/** Extensiones que se prueban al resolver un especificador local a un archivo real. */
const EXTENSIONES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js"];

function esLocal(especificador: string): boolean {
  return especificador.startsWith("@/") || especificador.startsWith(".");
}

function resolverLocal(desdeArchivo: string, especificador: string): string | null {
  const base = especificador.startsWith("@/")
    ? path.join(REPO_ROOT, especificador.slice(2))
    : path.resolve(path.dirname(desdeArchivo), especificador);

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONES) {
    const candidato = base + ext;
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  return null;
}

/**
 * Analiza la clausula de un import para saber QUE nombres trae y de que forma. La
 * allowlist de R36 es nominal: sin esto, "permitir la arista" seria permitir el paquete
 * entero, que es justo lo que D8 no concede.
 */
function analizarClausula(clausula: string): { forma: FormaDeImport; nombres: string[] } {
  const limpia = clausula.trim();
  if (limpia === "") return { forma: "efecto", nombres: [] };
  if (limpia.startsWith("*")) return { forma: "namespace", nombres: ["*"] };
  if (!limpia.startsWith("{")) {
    return { forma: "default", nombres: [limpia.split(",")[0].trim()] };
  }
  const nombres = limpia
    .replace(/[{}]/g, "")
    .split(",")
    .map((n) => n.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((n) => n !== "");
  return { forma: "nombrada", nombres };
}

/** Aristas (con nombres) que salen de un archivo. */
function aristasDe(archivo: string): Arista[] {
  const codigo = soloCodigo(fs.readFileSync(archivo, "utf8"));
  const aristas: Arista[] = [];
  const desde = relativa(archivo);

  const estatico = /\b(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of codigo.matchAll(estatico)) {
    const { forma, nombres } = analizarClausula(m[2] ?? "");
    aristas.push({ desde, especificador: m[3], soloTipo: m[1] !== undefined, forma, nombres });
  }

  const soloEfecto = /\bimport\s+["']([^"']+)["']/g;
  for (const m of codigo.matchAll(soloEfecto)) {
    aristas.push({ desde, especificador: m[1], soloTipo: false, forma: "efecto", nombres: [] });
  }

  // `import("x")` aparece en DOS posiciones que NO son lo mismo: un import dinamico de
  // verdad (`await import("x")`, que existe en runtime) y una referencia de TIPO
  // (`import("x").Fila`, que TypeScript borra). Confundirlas hacia que una anotacion de
  // tipo de `lib/types/order-status.ts:91` contase como "importa la capa repositories".
  const dinamico = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)(\s*\.)?/g;
  for (const m of codigo.matchAll(dinamico)) {
    const antes = codigo.slice(Math.max(0, (m.index ?? 0) - 10), m.index ?? 0);
    const posicionDeTipo = m[2] !== undefined && !/await\s*$/.test(antes);
    aristas.push({
      desde,
      especificador: m[1],
      soloTipo: posicionDeTipo,
      forma: posicionDeTipo ? "efecto" : "namespace",
      nombres: posicionDeTipo ? [] : ["*"],
    });
  }

  return aristas;
}

/**
 * Recorre la clausura de imports desde los archivos de `lib/analytics/` hasta punto fijo.
 * Solo se DESCIENDE por especificadores locales; los paquetes de `node_modules` se juzgan
 * por su especificador (que es lo que ya hace la regla de `@prisma/client`) pero no se
 * recorren: su interior no es codigo del repo y su pureza la dice el import empirico.
 */
function clausuraDeAristas(entradas: readonly string[]): Arista[] {
  const visitados = new Set<string>();
  const pendientes = [...entradas];
  const todas: Arista[] = [];

  while (pendientes.length > 0) {
    const archivo = pendientes.pop() as string;
    const clave = path.resolve(archivo);
    if (visitados.has(clave)) continue; // los ciclos no cuelgan
    visitados.add(clave);

    for (const arista of aristasDe(archivo)) {
      todas.push(arista);
      // Solo se DESCIENDE por aristas que existen en runtime: un `import type` se borra en
      // compilacion y no puede arrastrar codigo al proceso. La prohibicion mas dura —"ni
      // siquiera como tipo"— sigue vigente donde importa, en el censo DIRECTO de
      // `lib/analytics/**` de arriba, que no distingue y no se ha tocado.
      if (arista.soloTipo || !esLocal(arista.especificador)) continue;
      const destino = resolverLocal(archivo, arista.especificador);
      if (destino && !visitados.has(path.resolve(destino))) pendientes.push(destino);
    }
  }

  return todas;
}

/** La arista esta explicitamente permitida, con SUS nombres y en forma nombrada. */
function estaPermitida(arista: Arista): boolean {
  return ARISTAS_PERMITIDAS.some(
    (p) =>
      p.desde === arista.desde &&
      p.especificador === arista.especificador &&
      arista.forma === "nombrada" &&
      arista.nombres.length > 0 &&
      arista.nombres.every((n) => (p.nombres as readonly string[]).includes(n)),
  );
}

/** Aplica a UNA arista las mismas reglas que `violacionesDeImports` aplica a un archivo. */
function violacionesDeArista(arista: Arista): string[] {
  // Una arista de solo tipo se borra en compilacion: no existe en el proceso y no puede
  // romper la pureza. Se registra en la clausura (para poder mirarla) pero no se juzga por
  // capas. `@prisma/client` se sigue evaluando siempre porque su regla YA distingue tipo
  // de valor y es justo la que sostiene la excepcion de D8.
  if (arista.soloTipo && !arista.especificador.startsWith("@prisma")) return [];

  const motivos: string[] = [];
  const partes = segmentos(arista.especificador);

  const capa = CAPAS_PROHIBIDAS.find((c) => partes.includes(c));
  if (capa) motivos.push(`importa la capa "${capa}" via "${arista.especificador}"`);
  if (MODULOS_DE_PETICION.includes(arista.especificador)) {
    motivos.push(`importa "${arista.especificador}", que solo existe en el servidor`);
  }
  if ((partes[0] === "@prisma" || arista.especificador.startsWith("@prisma/")) && !arista.soloTipo) {
    motivos.push(`importa "${arista.especificador}" como VALOR (solo se admite import type)`);
  }

  if (motivos.length > 0 && estaPermitida(arista)) return [];
  return motivos.map((m) => `${arista.desde}: ${m}`);
}

function clausuraDeAnalytics(): Arista[] {
  return clausuraDeAristas(archivosDeAnalytics());
}

describe("R35 · la pureza se comprueba sobre la CLAUSURA TRANSITIVA, no solo los imports directos", () => {
  it("la clausura sale de lib/analytics y llega a archivos que ningun import directo nombra", () => {
    const aristas = clausuraDeAnalytics();
    const origenes = new Set(aristas.map((a) => a.desde));

    // Si la clausura no bajara de nivel, `origenes` serian solo los de lib/analytics.
    expect(origenes.size).toBeGreaterThan(archivosDeAnalytics().length);
    expect([...origenes]).toContain("lib/auth/acceso-total.ts");
  });

  it("ninguna arista de la clausura viola las reglas de pureza, salvo la permitida por D8", () => {
    const violaciones = clausuraDeAnalytics().flatMap(violacionesDeArista);
    expect(violaciones).toEqual([]);
  });

  it("distingue una arista de TIPO (borrada) de una de VALOR (real) fuera de lib/analytics", () => {
    const deTipo: Arista = {
      desde: "lib/types/order-status.ts",
      especificador: "@/lib/interfaces/repositories/IOrdenRepository",
      soloTipo: true,
      forma: "nombrada",
      nombres: ["OrderStatusLiteRow"],
    };
    const deValor: Arista = { ...deTipo, soloTipo: false };

    expect(violacionesDeArista(deTipo), "un import type no llega al proceso").toEqual([]);
    expect(violacionesDeArista(deValor), "un import de valor si").not.toEqual([]);
  });

  it("dentro de lib/analytics la regla dura sigue intacta: ni siquiera como tipo", () => {
    // El censo DIRECTO no distingue, y eso no ha cambiado con la ampliacion.
    expect(
      violacionesDeImports("alcance.ts", 'import type { Actor } from "@/lib/interfaces/services/IOrdenService";'),
    ).not.toEqual([]);
  });

  it("no existe un segundo guardia de pureza en tests/unit/analytics: hay uno, y es este", () => {
    const dir = __dirname;
    const propio = path.basename(__filename);
    const otros = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".ts") && n !== propio)
      .filter((n) =>
        /CAPAS_PROHIBIDAS|MODULOS_DE_PETICION|ARISTAS_PERMITIDAS/.test(
          fs.readFileSync(path.join(dir, n), "utf8"),
        ),
      );
    expect(otros, "hay mas de un guardia de pureza (R35 exige uno solo)").toEqual([]);
  });
});

describe("R36 · la allowlist es de UNA arista, nominal y verificada empiricamente", () => {
  it("ARISTAS_PERMITIDAS tiene exactamente una entrada y lleva su motivo escrito", () => {
    expect(ARISTAS_PERMITIDAS.length).toBe(1);
    expect(ARISTAS_PERMITIDAS[0].desde).toBe("lib/auth/acceso-total.ts");
    expect(ARISTAS_PERMITIDAS[0].especificador).toBe("@prisma/client");
    expect([...ARISTAS_PERMITIDAS[0].nombres]).toEqual(["RolValue"]);
    expect(ARISTAS_PERMITIDAS[0].motivo.length).toBeGreaterThan(80);
  });

  it("la arista permitida existe de verdad hoy: si desapareciera, la lista sobraria", () => {
    const arista = clausuraDeAnalytics().find(
      (a) => a.desde === "lib/auth/acceso-total.ts" && a.especificador === "@prisma/client",
    );
    expect(arista, "la clausura ya no llega a acceso-total: retirar la entrada").toBeDefined();
    expect(arista && [...arista.nombres]).toEqual(["RolValue"]);
    expect(violacionesDeArista(arista as Arista)).toEqual([]);
  });

  it("autocomprobacion: la misma arista con el cliente, con default o con namespace sale ROJA", () => {
    const base = {
      desde: "lib/auth/acceso-total.ts",
      especificador: "@prisma/client",
      soloTipo: false,
    } as const;

    const conElCliente: Arista = {
      ...base,
      forma: "nombrada",
      nombres: ["RolValue", "PrismaClient"],
    };
    const porDefecto: Arista = { ...base, forma: "default", nombres: ["prisma"] };
    const porNamespace: Arista = { ...base, forma: "namespace", nombres: ["*"] };

    for (const infractora of [conElCliente, porDefecto, porNamespace]) {
      expect(violacionesDeArista(infractora), infractora.forma).not.toEqual([]);
    }
  });

  it("autocomprobacion: otra arista transitiva prohibida, inyectada a mano, sale ROJA", () => {
    const infractoras: Arista[] = [
      {
        desde: "lib/utils/fecha-cr.ts",
        especificador: "@/lib/db/prisma-client",
        soloTipo: false,
        forma: "nombrada",
        nombres: ["getPrismaClient"],
      },
      {
        desde: "lib/auth/acceso-total.ts",
        especificador: "next/headers",
        soloTipo: false,
        forma: "nombrada",
        nombres: ["cookies"],
      },
      {
        desde: "lib/types/order-status.ts",
        especificador: "@/lib/services/OrdenService",
        soloTipo: false,
        forma: "nombrada",
        nombres: ["OrdenService"],
      },
      {
        // La MISMA excepcion desde otro archivo: la allowlist es de arista, no de paquete.
        desde: "lib/analytics/alcance.ts",
        especificador: "@prisma/client",
        soloTipo: false,
        forma: "nombrada",
        nombres: ["RolValue"],
      },
    ];
    for (const arista of infractoras) {
      expect(violacionesDeArista(arista), `${arista.desde} -> ${arista.especificador}`).not.toEqual(
        [],
      );
    }
  });

  it("autocomprobacion: el analizador de clausulas distingue nombrada, default y namespace", () => {
    expect(analizarClausula("{ RolValue }")).toEqual({ forma: "nombrada", nombres: ["RolValue"] });
    expect(analizarClausula("{ RolValue as Rol, type Otro }")).toEqual({
      forma: "nombrada",
      nombres: ["RolValue", "Otro"],
    });
    expect(analizarClausula("Cliente")).toEqual({ forma: "default", nombres: ["Cliente"] });
    expect(analizarClausula("* as todo")).toEqual({ forma: "namespace", nombres: ["*"] });
  });

  it("la clausura completa se importa SIN DATABASE_URL y no lanza (la prueba que manda)", async () => {
    const ENV = { ...process.env };
    try {
      for (const clave of Object.keys(process.env)) {
        if (/DATABASE|POSTGRES|PRISMA|SUPABASE/i.test(clave)) delete process.env[clave];
      }
      expect(process.env.DATABASE_URL).toBeUndefined();
      vi.resetModules();

      for (const modulo of MODULOS) {
        const cargado = await CARGADORES[modulo]();
        expect(
          Object.keys(cargado).length,
          `lib/analytics/${modulo}.ts no exporto nada`,
        ).toBeGreaterThan(0);
      }
      // Y la arista permitida, importada directamente: el enum llega usable y sin conectar.
      const accesoTotal = await import("@/lib/auth/acceso-total");
      expect(accesoTotal.esAccesoTotal("maestro")).toBe(true);
      expect(accesoTotal.esAccesoTotal("mensajero")).toBe(false);
    } finally {
      process.env = ENV;
      vi.resetModules();
    }
  });
});
