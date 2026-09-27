import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { RAIZ_DEL_REPO, archivosDeCodigoCensados } from "../../fixtures/raices-de-codigo";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// HOTFIX sinpe-build — NINGUN `new PrismaClient()` SIN OPCIONES EN EL ARBOL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PASO. En la release del SINPE, el build de produccion murio en `sembrarSinpe`
// (scripts/migrate-deploy.ts) con `PrismaClientInitializationError: PrismaClient needs to be
// constructed with a non-empty, valid PrismaClientOptions`. Prisma 7 exige el adaptador (PrismaPg)
// y ese camino hacia `new PrismaClient()` a pelo. Ningun test lo vio: los tests del paso inyectan
// efectos dobles y el camino real solo corre en el build contra una base.
//
// LA REGLA. Todo cliente se construye con la fabrica de la app (`getPrismaClient()` de
// `@/lib/db/prisma-client`) o, como minimo, pasando opciones con el adaptador. Esta guardia caza
// la forma sin argumentos en todo el codigo censado (lib/, app/, components/, scripts/, ...).

const CONSTRUCTOR_SIN_OPCIONES = /new\s+PrismaClient\s*\(\s*\)/;

function esCodigoTs(rel: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(rel);
}

function infractores(
  archivos = archivosDeCodigoCensados().filter(esCodigoTs),
  leer: (rel: string) => string = (rel) => fs.readFileSync(path.join(RAIZ_DEL_REPO, rel), "utf8"),
): string[] {
  return archivos.filter((rel) => CONSTRUCTOR_SIN_OPCIONES.test(leer(rel)));
}

describe("hotfix sinpe-build — `new PrismaClient()` sin opciones no vive en el arbol", () => {
  it("ningun archivo de codigo censado construye un PrismaClient sin opciones", () => {
    expect(infractores()).toEqual([]);
  });

  it("el censo mira algo (anti-vacuidad), incluido scripts/migrate-deploy.ts", () => {
    const archivos = archivosDeCodigoCensados().filter(esCodigoTs);
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos).toContain("scripts/migrate-deploy.ts");
    expect(archivos).toContain("lib/db/prisma-client.ts");
  });

  it("CONTRAPRUEBA — el codigo VIEJO de sembrarSinpe pone la guardia roja", () => {
    // Fragmento literal del codigo que murio en el build (commit 2920409f).
    const viejo = [
      'const { PrismaClient } = await import("@prisma/client");',
      "const prisma = new PrismaClient();",
    ].join("\n");
    expect(
      infractores(["scripts/migrate-deploy.ts"], () => viejo),
    ).toEqual(["scripts/migrate-deploy.ts"]);
  });

  it("CONTRAPRUEBA — con opciones (la fabrica de la app) NO es infractor", () => {
    const conOpciones = "new PrismaClient({ adapter, omit: PRISMA_OMIT })";
    expect(infractores(["lib/db/prisma-client.ts"], () => conOpciones)).toEqual([]);
  });

  it("sembrarSinpe usa la fabrica de la app y suelta el singleton tras desconectar", () => {
    const fuente = fs.readFileSync(path.join(RAIZ_DEL_REPO, "scripts/migrate-deploy.ts"), "utf8");
    const inicio = fuente.indexOf("sembrarSinpe: async");
    const fin = fuente.indexOf("sembrar: () =>", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    const bloque = fuente.slice(inicio, fin);
    expect(bloque).toContain('await import("@/lib/db/prisma-client")');
    expect(bloque).toContain("getPrismaClient()");
    // La caida a DIRECT_URL va ANTES de construir el cliente (PrismaPg lee DATABASE_URL al crearse).
    expect(bloque.indexOf("process.env.DIRECT_URL")).toBeLessThan(bloque.indexOf("getPrismaClient()"));
    expect(bloque).toContain("globalThis.__prisma__ = undefined");
  });
});
