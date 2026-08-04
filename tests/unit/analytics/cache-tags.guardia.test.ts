import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ANALITICA_TAGS } from "@/lib/analytics/metrics";

// Feature 128 / T1.1 — GUARDIA DE R20: nadie escribe el literal del tag a mano.
//
// ⚠ ESTE GUARDIA **SOBREVIVE AL MERGE**. No mide el diff contra `dev`: censa CONTENIDO, asi
// que sigue vigente para siempre y no se convierte en un impuesto sobre features ajenas.
// Vive en su PROPIO archivo, y no dentro del guardia de frontera de R19, precisamente porque
// aquel es branch-scoped y se retira en el mismo PR que lo introduce (T8.5): un guardia que
// debe sobrevivir no puede colgar de uno que caduca.
//
// POR QUE IMPORTA. Un tag escrito a mano en dos sitios es exactamente COMO la invalidacion
// deja de coincidir con la lectura: se escribe la entrada con el tag del catalogo y se
// invalida una variante escrita a mano con un guion en vez de dos puntos; nadie falla, no hay
// excepcion, y la cifra se queda vieja para siempre. La
// fuente unica es `ANALITICA_TAGS` (`lib/analytics/metrics.ts`, feature 135), que esta feature
// NO toca.
//
// El literal NO se escribe tampoco AQUI: se lee del catalogo en tiempo de ejecucion. Un
// guardia que contuviera la cadena que prohibe se marcaria a si mismo o exigiria una excepcion
// para si mismo, que es como empiezan las allowlist que acaban tapandolo todo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);
const DIRECTORIOS = ["lib", "app", "scripts", "tests"];

/**
 * Los DOS unicos sitios donde el literal puede aparecer: la declaracion del catalogo y el test
 * que la fija. Cualquier otro archivo que lo escriba es una segunda fuente de verdad.
 */
const FUENTE_UNICA = new Set([
  "lib/analytics/metrics.ts",
  "tests/unit/analytics/metrics.test.ts",
]);

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

const LITERALES = [ANALITICA_TAGS.operativa, ANALITICA_TAGS.financiera];

describe("R20 · ningun archivo escribe el literal del tag", () => {
  it("solo el catalogo de la 135 (y su test) contienen las cadenas de `ANALITICA_TAGS`", () => {
    const infractores = DIRECTORIOS.flatMap((d) => archivos(d))
      .filter((rel) => !FUENTE_UNICA.has(rel))
      .filter((rel) => {
        const fuente = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
        return LITERALES.some((lit) => fuente.includes(lit));
      });

    expect(
      infractores,
      "los tags de cache se derivan de `tagDeDominio()` / `ANALITICA_TAGS` " +
        "(`lib/analytics/metrics.ts`, feature 135) y de ningun otro sitio. Un tag escrito a " +
        "mano en dos lugares es como la invalidacion deja de alcanzar lo que la lectura " +
        "escribio, en silencio. Archivos: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("el censo DISCRIMINA: la fuente unica si contiene el literal (si no, seria verde por vacio)", () => {
    const metrics = fs.readFileSync(path.join(REPO_ROOT, "lib/analytics/metrics.ts"), "utf8");
    expect(LITERALES.every((lit) => metrics.includes(lit))).toBe(true);
    expect(archivos("lib").length).toBeGreaterThan(50);
  });

  it("los archivos de la 128 consumen el catalogo, no una cadena propia", () => {
    const tags = fs.readFileSync(path.join(REPO_ROOT, "lib/analytics/cache-tags.ts"), "utf8");
    expect(tags).toMatch(/tagDeDominio\(/);
    expect(LITERALES.some((lit) => tags.includes(lit))).toBe(false);
  });
});
