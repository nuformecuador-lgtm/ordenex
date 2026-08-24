import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";
import { RolValue } from "@prisma/client";
import { ROLES_ACCESO_TOTAL, esAccesoTotal } from "@/lib/auth/acceso-total";
import { METRICAS } from "@/lib/analytics/metrics";
import type { Metrica } from "@/lib/analytics/types";
import { ROLES_ANALITICA } from "@/lib/analytics/types";
import {
  ROLES_ANALITICA_INTEGRACION,
  ROLES_SIN_ANALITICA,
  rolTieneAccesoTotal,
} from "@/lib/analytics/alcance";

// Feature 122 / T5.2 — GUARDIA de fuente unica (R3, R8) y de `apiKey` (R11 / D9).
//
// Por que existe: la forma mas barata de abrir un agujero multi-tenant no es escribir un
// `where` mal, es escribir una SEGUNDA lista. Dos listas de "roles totales" o dos tablas
// de alcance por rol divergen en el primer rol nuevo, y el rol queda concedido en un sitio
// y negado en otro. Aqui se afirma que hay UNA de cada:
//   - los roles totales los define `esAccesoTotal` (`lib/auth/acceso-total.ts`), R3;
//   - la regla por rol de cada metrica la define `lib/analytics/metrics.ts`, R8;
//   - `apiKey` no es lector de analitica y ninguna metrica le declara nada, R11.
//
// FEATURE 267 (2026-08-23) — DECISION ESCRITA AL LADO, no una relajacion. La 122 particiona
// los seis `RolValue` en DOS listas (`ROLES_ANALITICA` + `ROLES_SIN_ANALITICA`). La 267
// revierte 122/R11-D9 y publica analitica por el canal integrador, asi que la particion pasa
// a ser TERNARIA: se anade `ROLES_ANALITICA_INTEGRACION`. El invariante NO se afloja, se
// refuerza: la union de las TRES tiene que ser exactamente los seis roles Y las tres tienen
// que ser DISJUNTAS DOS A DOS (267/R4), porque con tres listas aparece un modo de fallo que
// con dos no existia — un rol declarado en dos sitios, concedido en uno y negado en otro.
// Lo que NO cambia: `ROLES_ANALITICA` sigue sin contener `apiKey` (267/R3) y ninguna metrica
// declara alcance para `apiKey` (267/R21): la lista blanca de la 267 son IDS, no una tabla
// de alcance por rol.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const METRICS_PATH = path.join(REPO_ROOT, "lib", "analytics", "metrics.ts");
const ALCANCE_PATH = path.join(REPO_ROOT, "lib", "analytics", "alcance.ts");
const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

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

function archivosCensables(): string[] {
  return ["app", "lib", "components", "scripts"].flatMap((d) =>
    archivosDeCodigo(path.join(REPO_ROOT, d)),
  );
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/**
 * Firma de una TABLA DE ALCANCE escrita a mano: un rol mapeado a uno de los tres
 * literales del dominio. Reconoce el DATO (`maestro: "total"`), no el TIPO
 * (`Record<RolAnalitica, AlcanceMetrica>` de `types.ts`, que es la declaracion legitima).
 */
const RE_TABLA_ALCANCE =
  /\b(maestro|admin|adminSatelite|adminTienda|mensajero)\s*:\s*["'](total|acotado|prohibido)["']/;

/** Los roles a los que una metrica concede acceso TOTAL. */
function rolesTotalesDe(metrica: Metrica): string[] {
  return ROLES_ANALITICA.filter((rol) => metrica.alcance[rol] === "total").slice();
}

describe("R3 · el conjunto de roles totales sale de esAccesoTotal, no de una lista propia", () => {
  it("para las 25 metricas, {rol : alcance[rol]==='total'} es exactamente ROLES_ACCESO_TOTAL", () => {
    const esperado = [...ROLES_ACCESO_TOTAL].sort();
    expect(esperado).toEqual(["admin", "maestro"]);
    expect(METRICAS.length).toBe(25); // 23 de la 135 + 2 financieras de la 173 (P4)

    for (const metrica of METRICAS) {
      expect(rolesTotalesDe(metrica).sort(), metrica.id).toEqual(esperado);
    }
  });

  it("el modulo de alcance pregunta a esAccesoTotal y no declara su propia lista de roles totales", () => {
    const codigo = soloCodigo(fs.readFileSync(ALCANCE_PATH, "utf8"));
    expect(codigo).toContain("esAccesoTotal");
    expect(codigo).toContain("@/lib/auth/acceso-total");
    // Una segunda lista literal de roles totales seria justo esto:
    expect(/ROLES_TOTALES|ROLES_ACCESO_TOTAL\s*=/.test(codigo)).toBe(false);
    expect(RE_TABLA_ALCANCE.test(codigo)).toBe(false);
  });

  it("rolTieneAccesoTotal delega en esAccesoTotal para los cinco roles", () => {
    for (const rol of ROLES_ANALITICA) {
      expect(rolTieneAccesoTotal(rol), rol).toBe(esAccesoTotal(rol));
    }
  });

  it("autocomprobacion: detecta una metrica que le abre el acceso total a un tercer rol", () => {
    const infractora = metricaFalsa({
      maestro: "total",
      admin: "total",
      adminSatelite: "total",
      adminTienda: "acotado",
      mensajero: "acotado",
    });
    expect(rolesTotalesDe(infractora).sort()).not.toEqual([...ROLES_ACCESO_TOTAL].sort());
  });
});

describe("R8 · la regla por rol se declara una sola vez, en metrics.ts", () => {
  it("ningun archivo del repo fuera de metrics.ts declara una tabla de alcance por rol", () => {
    const infractores = archivosCensables()
      .filter((a) => path.resolve(a) !== path.resolve(METRICS_PATH))
      .filter((a) => RE_TABLA_ALCANCE.test(soloCodigo(fs.readFileSync(a, "utf8"))))
      .map(relativa);

    expect(infractores, "declaran alcance por rol fuera de lib/analytics/metrics.ts").toEqual([]);
  });

  it("metrics.ts si declara una: el censo mira donde debe y no pasa por vacio", () => {
    expect(RE_TABLA_ALCANCE.test(soloCodigo(fs.readFileSync(METRICS_PATH, "utf8")))).toBe(true);
    expect(archivosCensables().length).toBeGreaterThan(100);
  });

  it("autocomprobacion: el censo reconoce una segunda tabla escrita a mano y no el tipo homonimo", () => {
    expect(RE_TABLA_ALCANCE.test('const MIA = { maestro: "total", mensajero: "acotado" };')).toBe(
      true,
    );
    expect(RE_TABLA_ALCANCE.test("readonly alcance: Readonly<Record<RolAnalitica, AlcanceMetrica>>"))
      .toBe(false);
  });
});

describe("R11 (122) / R3-R5 (267) · la particion de roles de analitica es ternaria y disjunta", () => {
  it("ROLES_ANALITICA no contiene apiKey y son cinco de los seis RolValue", () => {
    expect(ROLES_ANALITICA).not.toContain("apiKey");
    expect(ROLES_ANALITICA.length).toBe(5);
    expect(Object.values(RolValue).length).toBe(6);
  });

  it("las TRES listas cubren exactamente los seis RolValue y son disjuntas dos a dos (267/R4)", () => {
    const listas: Record<string, readonly string[]> = {
      ROLES_ANALITICA,
      ROLES_ANALITICA_INTEGRACION,
      ROLES_SIN_ANALITICA,
    };

    const cubiertos = Object.values(listas).flatMap((l) => [...l]);
    expect(cubiertos.slice().sort()).toEqual(Object.values(RolValue).sort());
    // Union == los seis Y ninguno repetido: cada rol pertenece a EXACTAMENTE una lista.
    expect(new Set(cubiertos).size).toBe(cubiertos.length);

    for (const [a, b] of paresDeListas(listas)) {
      expect(interseccion(listas[a], listas[b]), `${a} ∩ ${b}`).toEqual([]);
    }
  });

  it("autocomprobacion: el invariante de disyuncion sale ROJO si un rol vive en dos listas", () => {
    // Copias LOCALES: el guardia se prueba a si mismo sin tocar el modulo real.
    const contaminadas: Record<string, readonly string[]> = {
      ROLES_ANALITICA: [...ROLES_ANALITICA],
      ROLES_ANALITICA_INTEGRACION: [...ROLES_ANALITICA_INTEGRACION],
      // Un rol futuro mal fichado: declarado denegado Y lector de integracion a la vez.
      ROLES_SIN_ANALITICA: [...ROLES_SIN_ANALITICA, "apiKey"],
    };

    const cubiertos = Object.values(contaminadas).flatMap((l) => [...l]);
    // La union SIGUE siendo los seis roles: sin la disyuncion, el guardia viejo no lo veia.
    expect(new Set(cubiertos).size).toBe(6);
    // Con la disyuncion, salta:
    expect(new Set(cubiertos).size).not.toBe(cubiertos.length);
    const pares = paresDeListas(contaminadas).map(
      ([a, b]) => interseccion(contaminadas[a], contaminadas[b]).length,
    );
    expect(pares.some((n) => n > 0)).toBe(true);
  });

  it("ROLES_SIN_ANALITICA sigue exportada, tipada y consultada aunque este VACIA (267/R5)", () => {
    // El mecanismo de denegacion por rol se conserva: un `RolValue` futuro tiene donde
    // declararse denegado sin volver a inventarlo.
    expect(Array.isArray(ROLES_SIN_ANALITICA)).toBe(true);
    expect(ROLES_SIN_ANALITICA).toEqual([]);
    // ...y `resolverAlcance` la sigue consultando: el literal esta en el codigo, no solo
    // en la exportacion.
    const codigo = soloCodigo(fs.readFileSync(ALCANCE_PATH, "utf8"));
    expect(codigo).toContain("export const ROLES_SIN_ANALITICA");
    expect(codigo.split("ROLES_SIN_ANALITICA").length - 1).toBeGreaterThan(1);
  });

  it("ninguna metrica del catalogo declara alcance para apiKey", () => {
    for (const metrica of METRICAS) {
      expect(Object.keys(metrica.alcance), metrica.id).not.toContain("apiKey");
    }
  });

  it("autocomprobacion: el guardia sale rojo si apiKey se cuela entre los roles lectores", () => {
    const rolesConApiKey = [...ROLES_ANALITICA, "apiKey"];
    expect(rolesConApiKey).toContain("apiKey");
    // La afirmacion que protege el catalogo, aplicada al conjunto contaminado, falla:
    expect(rolesConApiKey.length).not.toBe(5);
    const conAlcance = metricaFalsa({
      maestro: "total",
      admin: "total",
      adminSatelite: "acotado",
      adminTienda: "acotado",
      mensajero: "acotado",
      apiKey: "acotado",
    } as unknown as Metrica["alcance"]);
    expect(Object.keys(conAlcance.alcance)).toContain("apiKey");
  });
});

/** Los tres pares no ordenados de listas, por nombre, para reportar cual choca con cual. */
function paresDeListas(listas: Record<string, readonly string[]>): [string, string][] {
  const nombres = Object.keys(listas);
  const pares: [string, string][] = [];
  for (let i = 0; i < nombres.length; i++) {
    for (let j = i + 1; j < nombres.length; j++) pares.push([nombres[i], nombres[j]]);
  }
  return pares;
}

function interseccion(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((x) => b.includes(x));
}

function metricaFalsa(alcance: Metrica["alcance"]): Metrica {
  return {
    id: "metrica_de_prueba_del_guardia",
    etiqueta: "Metrica de prueba",
    descripcion: "Fixture del guardia de fuente unica: no pertenece al catalogo.",
    dominio: "operativa",
    clase: "live",
    unidad: "conteo",
    unidadDeConteo: "orden",
    estadoProduccion: "declarada",
    granos: ["fecha"],
    fuente: { tipo: "tabla_viva", tablas: ["orden"] },
    alcance,
    definicion: {},
  };
}
