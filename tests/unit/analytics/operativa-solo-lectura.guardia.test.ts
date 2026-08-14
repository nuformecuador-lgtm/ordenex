import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

// Feature 126 / T12.1 — R2 y R31.
//
// R2: la 126 es DE SOLO LECTURA sobre el rollup y sobre el dominio. El escritor de
// `analytics_daily` es la 124 y sigue siendo el unico; `orden`, `gestion_orden` y
// `orden_historial_estado` son de sus propias features. Una escritura desde aqui no daria un
// numero equivocado: corromperia la fuente que todos los tableros leen.
//
// R31: ningun `new Date()` ni `Date.now()` dentro del servicio. El reloj se INYECTA, y esa es
// la unica razon por la que dos llamadas iguales dan lo mismo. Un `new Date()` escondido
// convierte el servicio en no determinista de una forma que no falla nunca en un test rapido y
// falla siempre en la frontera de la medianoche CR.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Los modulos de la 126 que este guardia vigila, por ruta EXACTA. */
const MODULOS_126 = [
  "lib/actions/analitica-operativa.ts",
  "lib/services/AnaliticaOperativaService.ts",
  "lib/repositories/AnaliticaOperativaRollupRepository.ts",
  "lib/repositories/AnaliticaOperativaVivaRepository.ts",
  "lib/analytics/oraculo-mensajero.ts",
  "lib/types/analitica-operativa.ts",
  "lib/interfaces/services/IAnaliticaOperativaService.ts",
  "lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts",
  "lib/interfaces/repositories/IAnaliticaOperativaVivaRepository.ts",
];

const SERVICIO = "lib/services/AnaliticaOperativaService.ts";

function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

function leerCodigo(rel: string): string {
  return soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

/** Escrituras por cliente Prisma sobre cualquiera de las cuatro tablas de la 126. */
const MODELOS = ["analyticsDaily", "orden", "gestionOrden", "ordenHistorialEstado"];
const METODOS_ESCRITURA =
  "create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany";

const ESCRITURAS_SQL = [
  /\bINSERT\s+INTO\s+"?(analytics_daily|orden|gestion_orden|orden_historial_estado)"?/i,
  /\bUPDATE\s+"?(analytics_daily|orden|gestion_orden|orden_historial_estado)"?\s+SET/i,
  /\bDELETE\s+FROM\s+"?(analytics_daily|orden|gestion_orden|orden_historial_estado)"?/i,
  /\$executeRaw/,
];

function escrituras(codigo: string): string[] {
  const hallazgos: string[] = [];
  for (const modelo of MODELOS) {
    const patron = new RegExp(`\\b${modelo}\\s*\\.\\s*(${METODOS_ESCRITURA})\\b`);
    if (patron.test(codigo)) hallazgos.push(`${modelo}.<escritura>`);
  }
  for (const patron of ESCRITURAS_SQL) {
    if (patron.test(codigo)) hallazgos.push(patron.source);
  }
  return hallazgos;
}

describe("R2 · ningun modulo de la 126 muta el rollup ni el dominio", () => {
  it("los modulos vigilados existen todos (un allowlist muerto no restringe nada)", () => {
    for (const rel of MODULOS_126) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} no existe`).toBe(true);
    }
  });

  it("ningun modulo de la 126 muta el rollup ni el dominio", () => {
    const infractores = MODULOS_126.flatMap((rel) =>
      escrituras(leerCodigo(rel)).map((m) => `${rel} :: ${m}`),
    );
    expect(
      infractores,
      "la 126 es de SOLO LECTURA (R2). El escritor de `analytics_daily` es la 124 y las tablas " +
        "vivas son de sus features. Hallazgos: " + infractores.join(", "),
    ).toEqual([]);
  });

  it("el detector DISCRIMINA: caza un upsert al rollup y un UPDATE crudo", () => {
    // Sin esto, un detector roto dejaria el caso anterior verde para siempre.
    expect(escrituras(`await prisma.analyticsDaily.upsert({ where: {} });`)).not.toEqual([]);
    expect(escrituras(`await prisma.orden.updateMany({ data: {} });`)).not.toEqual([]);
    expect(escrituras(`await prisma.$queryRaw\`UPDATE "gestion_orden" SET x = 1\`;`)).not.toEqual([]);
    // Y no marca una LECTURA legitima, que es lo que la 126 hace todo el rato.
    expect(escrituras(`await prisma.analyticsDaily.groupBy({ by: ["fecha"] });`)).toEqual([]);
    expect(escrituras(`await prisma.$queryRaw\`SELECT 1 FROM "gestion_orden"\`;`)).toEqual([]);
  });
});

describe("R31 · el servicio no construye fechas por su cuenta", () => {
  it("el servicio no construye fechas por su cuenta", () => {
    const codigo = leerCodigo(SERVICIO);
    // `new Date()` SIN argumentos y `Date.now()` son las dos formas de saltarse el reloj
    // inyectado. `new Date(x)` con argumento es legitimo (parsear una fecha ya recibida).
    expect(/new\s+Date\s*\(\s*\)/.test(codigo), "hay un `new Date()` en el servicio").toBe(false);
    expect(/Date\s*\.\s*now\s*\(/.test(codigo), "hay un `Date.now()` en el servicio").toBe(false);
  });

  it("y recibe el reloj por constructor: `deps.now` existe en la firma", () => {
    const codigo = leerCodigo(SERVICIO);
    expect(codigo).toMatch(/deps\s*:\s*AnaliticaOperativaDeps/);
    expect(codigo).toMatch(/this\.deps\.now\(\)/);
  });

  it("el detector DISCRIMINA entre el reloj propio y el parseo legitimo", () => {
    expect(/new\s+Date\s*\(\s*\)/.test("const ahora = new Date();")).toBe(true);
    expect(/new\s+Date\s*\(\s*\)/.test('const d = new Date("2026-08-03");')).toBe(false);
  });

  it("el servicio tampoco conoce Next.js: ni Request, ni Response, ni next/headers", () => {
    const codigo = leerCodigo(SERVICIO);
    expect(codigo).not.toMatch(/next\/headers|next\/cache|NextResponse|["']server-only["']/);
    // Ni Prisma: el servicio compone y decide; quien consulta es el repositorio.
    expect(codigo).not.toMatch(/@prisma\/client|\$queryRaw|getPrismaClient/);
  });
});
