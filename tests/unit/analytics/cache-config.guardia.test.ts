import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ANALITICA_CACHE_TTL_SEGUNDOS } from "@/lib/config/analitica-cache";

// Feature 128 / T4.1 — GUARDIA DE R17 (D4): el TTL vive en UNA sola constante.
//
// ⚠ EL CENSO ES **POR AMBITO**, NO GLOBAL, Y ESO SE COMPROBO ANTES DE FIJAR EL VALOR. El
// literal `3600` ya aparece cuatro veces en `lib/` por motivos completamente ajenos a esta
// feature:
//
//   lib/auth/google-sa-token.ts:42   ASSERTION_TTL_S (vida del JWT de assertion de Google)
//   lib/auth/google-adc-token.ts:28  IMPERSONATION_LIFETIME_S
//   lib/config/etiquetas.ts:52       comentario del default del TTL de URL firmada
//   lib/config/etiquetas.ts:69       readPositiveInt("ETIQUETAS_SIGNED_URL_TTL_SECONDS", 3600)
//
// Un guardia que recorriera todo el arbol buscando el numero desnudo NACERIA ROJO por
// literales ajenos y se desarmaria a la primera, dejando de proteger nada (leccion de la 125).
// Si algun dia se ampliara al arbol entero, se hace con allowlist CONTADA por ruta y por
// numero de ocurrencias — el patron ya escrito en
// `tests/unit/analytics/rollup-guards.test.ts:681` (`AJENAS_A_R47`).
//
// Y el TTL es RED DE SEGURIDAD, NO MECANISMO: quien hace el trabajo es la invalidacion
// explicita (R10/R12/R14). Por eso la otra mitad del guardia es que ninguna entrada se escriba
// con `revalidate: false`: sin TTL, un invalidador que no llegue congela la cifra PARA SIEMPRE.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

/** El ambito del censo: la analitica y la cache. Nada mas. */
const AMBITO = ["lib/analytics", "lib/cache", "lib/repositories", "lib/services/jobs"];

/** El unico archivo donde el numero puede aparecer. */
const CONSTANTE = "lib/config/analitica-cache.ts";

function archivos(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      salida.push(...archivos(rel));
    } else if (EXT.has(path.extname(e.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** El numero desnudo, con o sin separador de millares. */
const LITERAL_TTL = /\b3_?600\b/;

describe("R17 · el TTL vive en una sola constante dentro del ambito de la analitica", () => {
  it("ningun archivo del ambito escribe el numero: lo importan", () => {
    const infractores = AMBITO.flatMap((d) => archivos(d))
      .filter((rel) => rel !== CONSTANTE)
      .filter((rel) => LITERAL_TTL.test(soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))));

    expect(
      infractores,
      `el TTL de la cache de analitica vive SOLO en ${CONSTANTE} ` +
        "(`ANALITICA_CACHE_TTL_SEGUNDOS`), con su comentario «provisional y no medida». Una " +
        "cifra duplicada es una cifra que un dia diverge, y aqui divergir significa que el " +
        "adaptador escribe con un TTL y el operador cree que es otro. Archivos: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("y la constante existe, con el aviso de que no esta medida", () => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, CONSTANTE), "utf8");
    expect(fuente).toMatch(/export const ANALITICA_CACHE_TTL_SEGUNDOS = 3600;/);
    expect(fuente).toMatch(/PROVISIONAL Y NO MEDIDA/i);
    expect(ANALITICA_CACHE_TTL_SEGUNDOS).toBe(3600);
    // El ambito mira archivos de verdad: si no, seria verde por vacio.
    expect(AMBITO.flatMap((d) => archivos(d)).length).toBeGreaterThan(30);
  });

  it("el censo NO se sale de su ambito: los cuatro `3600` ajenos siguen ahi y no le importan", () => {
    // Escrito a proposito como asercion y no como comentario: si alguien «arregla» el guardia
    // ampliandolo a todo `lib/`, esto documenta exactamente lo que se rompe.
    const ajenas = [
      "lib/auth/google-sa-token.ts",
      "lib/auth/google-adc-token.ts",
      "lib/config/etiquetas.ts",
    ];
    for (const rel of ajenas) {
      const fuente = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(LITERAL_TTL.test(fuente), `${rel} ya no contiene 3600: revisar el comentario`).toBe(true);
      expect(AMBITO.some((d) => rel.startsWith(`${d}/`))).toBe(false);
    }
  });
});

describe("R17 · ninguna entrada se escribe con `revalidate: false`", () => {
  const adaptador = fs.readFileSync(
    path.join(REPO_ROOT, "lib", "cache", "next-analitica-cache.ts"),
    "utf8",
  );

  it("el adaptador pasa el TTL de la constante", () => {
    expect(soloCodigo(adaptador)).toMatch(/revalidate:\s*ANALITICA_CACHE_TTL_SEGUNDOS/);
  });

  it("y no hay `revalidate: false` en ningun archivo del ambito", () => {
    const infractores = AMBITO.flatMap((d) => archivos(d)).filter((rel) =>
      /revalidate:\s*false/.test(soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))),
    );
    expect(
      infractores,
      "sin TTL, un invalidador que no llegue congela la cifra PARA SIEMPRE. El TTL es la red " +
        "de seguridad de esta feature. Archivos: " + infractores.join(", "),
    ).toEqual([]);
  });
});
