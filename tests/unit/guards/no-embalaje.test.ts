import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 28 (R6, R7): guard anti-`embalaje`. Recorre el arbol del repo y falla
// si aparece la palabra `embalaje` (case-insensitive) fuera del whitelist
// confirmado por el humano (decisiones append-only / definicion de la feature).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const GUARD_FILE_ABS = path.join(__dirname, "no-embalaje.test.ts");

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  "build",
  "progress",
  // `.claude/` es estado del harness (worktrees aislados de subagentes,
  // settings, skills), no fuente del repo. En particular `.claude/worktrees/`
  // contiene checkouts anidados del propio repo: sin este ignore el guard se
  // encuentra copias de archivos que SI estan en el whitelist (incluido el
  // propio guard) pero bajo otra ruta relativa, y falla por su reflejo. El
  // guard audita el codigo del proyecto, no copias anidadas de si mismo.
  ".claude",
  // `.vitest/` es el volcado JSON que `pnpm run test:json` deja para que
  // `comparar-baseline-rojos.mjs` sepa que fallo. Es estado del arnes, no
  // fuente del repo, y ademas contiene los NOMBRES de todos los tests: entre
  // ellos los del propio guard, asi que sin este ignore la primera corrida
  // completa dejaba el repo en un estado donde la segunda fallaba por su
  // propio reflejo. Se ignora el DIRECTORIO -- por eso el reporte ya no cae
  // en la raiz-- y no se anota el archivo en el whitelist: lo que no es
  // fuente no deberia necesitar una excepcion nominal.
  ".vitest",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cts",
  ".mts",
  ".json",
  ".md",
  ".sql",
  ".prisma",
  ".toml",
  ".yml",
  ".yaml",
  ".css",
  ".txt",
  ".sh",
]);

// Rutas (relativas a REPO_ROOT, con separadores normalizados a "/") donde SI
// puede aparecer `embalaje` sin que el guard falle.
//
// Ademas de la whitelist confirmada por el humano (specs de esta feature y
// feature_list.json), se whitelistean explicitamente los DOS artefactos que
// R3/R4 exigen crear y que POR DEFINICION deben citar el valor literal
// 'embalaje' para documentar/verificar el rename (el UPDATE de la migracion y
// el test estatico que lo comprueba por regex). Sin esta excepcion el propio
// guard se auto-contradiria con R3/R4.
const WHITELIST_PREFIXES = [
  "specs/rename-embalaje-fulfillment/",
  "db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/",
  // Feature 27: el spec cita 'embalaje' solo para documentar el rename historico de la
  // feature 28 como contexto; no reintroduce el valor.
  "specs/27-fulfillment-tienda/",
  // Feature 135: el spec cita el folder historico *_rename_order_status_embalaje_en_fulfillment
  // como PRECEDENTE del rename por UPDATE (order_status es tabla catalogo, no enum); no
  // reintroduce el valor 'embalaje'. Mismo patron que specs/27 y specs/rename-embalaje-fulfillment.
  "specs/137-order-status-rename-nomenclatura/",
];
const WHITELIST_FILES = new Set([
  "feature_list.json",
  "tests/integration/db/rename-order-status-migration.test.ts",
  // Lote 153-160: estos specs NO citan el value 'embalaje'; citan el NOMBRE DE ARCHIVO de
  // este guard (`tests/unit/guards/no-embalaje.test.ts`) como precedente de modelado para
  // sus propios guards. El guard busca /embalaje/i linea a linea y no distingue el nombre
  // del guard del value prohibido, asi que hay que whitelistearlos por archivo (mas estrecho
  // que whitelistear la carpeta entera del spec, como se hizo con specs/27 y specs/137).
  "specs/155-creacion-bifurcada-fulfillment/design.md",
  "specs/159-quitar-sugerencia-mensajeros/design.md",
  "specs/159-quitar-sugerencia-mensajeros/tasks.md",
  // Feature 167: MISMO caso que los tres de arriba. `design.md §8` cita el NOMBRE DE ARCHIVO de
  // este guard como molde del suyo (`entregas-sin-recoleccion.test.ts`); no menciona el value
  // 'embalaje' por ningun lado. Alta por archivo, no por carpeta.
  "specs/167-apartado-recoleccion-mensajero/design.md",
  // Feature 135: MISMO caso, y era el ULTIMO rojo del repo (2026-07-31). Su `tasks.md:187` narra
  // en la bitacora un flaky de CI nombrando este guard ("timeout del guard `no-embalaje`"); es
  // prosa sobre la herramienta, no una reintroduccion del value. Estuvo rojo dias porque cada
  // feature que lo encontraba lo declaraba deuda ajena y seguia: nadie lo daba de alta.
  "specs/135-analitica-catalogo-kpis-rangos/tasks.md",
  // Feature 122: MISMO caso, y por el MISMO motivo que el de arriba —tanto que su `tasks.md:243`
  // narra en la bitacora que `./init.sh` cae por este guard y, al escribir su nombre, se
  // convierte en la causa de que siga cayendo. Es prosa sobre la herramienta, no una
  // reintroduccion del value 'embalaje'. Se da de alta aqui, en la tanda M de la 170, porque
  // dejaba el gate del repo ENTERO rojo y la regla es que quien lo encuentra lo da de alta en
  // vez de declararlo deuda ajena y seguir. Alta por archivo, no por carpeta.
  "specs/122-analitica-alcance-por-rol/tasks.md",
  // Feature 86 (enmienda 2026-08-08): la landing publica replica el home de
  // ordenex.co, y sus politicas de dano usan `embalaje` en su sentido ordinario
  // del castellano —el material con que se protege un paquete—, copy tomado del
  // sitio publicado. Nada que ver con el value de `order_status` que este guard
  // persigue: no es un estado, no toca la base, no vuelve por la puerta de
  // atras. Alta por archivo (no por carpeta) para que si `app/_landing/` crece
  // con codigo que SI toque estados, el guard lo siga viendo.
  "app/_landing/LandingPoliticas.tsx",
]);

function toRelPosix(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function isWhitelisted(absPath: string): boolean {
  if (absPath === GUARD_FILE_ABS) return true;
  const rel = toRelPosix(absPath);
  if (WHITELIST_FILES.has(rel)) return true;
  return WHITELIST_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

interface Hallazgo {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, hallazgos: Hallazgo[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, hallazgos);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (isWhitelisted(abs)) continue;

    const content = fs.readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/embalaje/i.test(line)) {
        hallazgos.push({ file: toRelPosix(abs), line: idx + 1, text: line.trim() });
      }
    });
  }
}

describe("guard anti-embalaje (R6, R7)", () => {
  it("no queda ninguna referencia a 'embalaje' fuera del whitelist", () => {
    const hallazgos: Hallazgo[] = [];
    walk(REPO_ROOT, hallazgos);

    if (hallazgos.length > 0) {
      const detalle = hallazgos
        .map((h) => `${h.file}:${h.line}: ${h.text}`)
        .join("\n");
      throw new Error(`Se encontraron referencias a 'embalaje' fuera del whitelist:\n${detalle}`);
    }

    expect(hallazgos).toHaveLength(0);
  });
});
