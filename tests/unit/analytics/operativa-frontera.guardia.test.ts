import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 126 / T12.3 — R1. La analitica operativa entra por Server Action y por NINGUNA otra
// puerta.
//
// `docs/architecture.md`: las mutaciones y lecturas internas del mismo proyecto van por Server
// Action; los route handlers existen para lo que necesita CORS o API publica —webhooks e
// integraciones—. Una ruta bajo `app/api/` para analitica seria una segunda superficie con su
// propio gating, su propio parseo y su propia forma de olvidarse de auditar el denegado.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const EXT = new Set([".ts", ".tsx"]);

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

/** Las formas de consultar analitica operativa desde donde no toca. */
const CONSULTA_OPERATIVA = [
  /AnaliticaOperativaService/,
  /AnaliticaOperativaRollupRepository/,
  /AnaliticaOperativaVivaRepository/,
  /consultarAnaliticaOperativa/,
];

describe("R1 · ninguna ruta de app/api consulta analitica operativa", () => {
  it("ninguna ruta de app/api consulta analitica operativa", () => {
    const infractores = archivos("app/api")
      .map((rel) => ({ rel, codigo: soloCodigo(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")) }))
      .filter(({ codigo }) => CONSULTA_OPERATIVA.some((p) => p.test(codigo)))
      .map(({ rel }) => rel);
    expect(
      infractores,
      "la analitica operativa se sirve por Server Action (`lib/actions/analitica-operativa.ts`). " +
        "Una ruta de `app/api` seria una segunda superficie con su propio gating y su propia " +
        "forma de olvidarse de auditar el denegado. Archivos: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("el censo mira rutas de verdad (si no, seria verde por vacio)", () => {
    // `app/api` existe y tiene handlers: el guardia esta mirando algo.
    expect(archivos("app/api").length).toBeGreaterThan(5);
  });

  it("el censo DISCRIMINA: detectaria un handler que importara el servicio", () => {
    const handlerInfractor = `
      import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService";
      export async function GET() { return Response.json({}); }
    `;
    expect(CONSULTA_OPERATIVA.some((p) => p.test(soloCodigo(handlerInfractor)))).toBe(true);
    // Y no marca un handler que solo lo MENCIONA en prosa.
    const soloProsa = `// pendiente: quiza el AnaliticaOperativaService\nexport async function GET() {}`;
    expect(CONSULTA_OPERATIVA.some((p) => p.test(soloCodigo(soloProsa)))).toBe(false);
  });

  it("la Server Action existe y declara `use server`", () => {
    const accion = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts"),
      "utf8",
    );
    expect(accion.startsWith('"use server"')).toBe(true);
  });
});

describe("R3 · el nombre generico `lib/actions/analitica.ts` esta prohibido", () => {
  it("no existe `lib/actions/analitica.ts`: es de las dos features y por tanto de ninguna", () => {
    // La regla 1 del arnes permite dos features backend a la vez SOLO si no hay conflicto de
    // archivos. La 126 y la 127 escribirian las dos en ese nombre.
    expect(fs.existsSync(path.join(REPO_ROOT, "lib", "actions", "analitica.ts"))).toBe(false);
  });

  it("y la accion de la 126 vive en su nombre propio", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, "lib", "actions", "analitica-operativa.ts")),
    ).toBe(true);
  });
});
