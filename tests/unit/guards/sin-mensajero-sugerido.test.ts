import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 159 (R18, R19, R20): guard de higiene del retiro de la "sugerencia de
// mensajero". El criterio de exito de esta feature no es "funciona", es "no queda
// rastro": recorre el codigo de PRODUCCION y falla ante cualquiera de los
// identificadores prohibidos. Modelado sobre el guard hermano de la feature 28.
//
// Solo audita produccion: `specs/`, `progress/` y las migraciones historicas
// documentan el retiro y por definicion citan el nombre retirado.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

// Raices de PRODUCCION auditadas (design §7). `db/schema.prisma` entra como
// archivo suelto: el resto de `db/` son migraciones historicas, que deben poder
// citar la columna que crearon y la que la dropea.
const SCAN_DIRS = ["app", "lib", "components", "hooks"];
const SCAN_FILES = ["db/schema.prisma"];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  "build",
  // `.claude/worktrees/` contiene checkouts anidados del propio repo: sin este
  // ignore el guard se encuentra copias y falla por su reflejo (mismo motivo
  // documentado en el guard hermano de la feature 28).
  ".claude",
]);

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".prisma"]);

// R18/R19/R20: los identificadores que NO deben sobrevivir en produccion.
const PROHIBIDOS = [
  "mensajero_sugerido_id",
  "mensajeroSugeridoId",
  "mensajeroSugerido",
  "MensajeroSugerido",
  "asignarMensajeroSugerido",
  "ordenesColumnsMensajeroSugerido",
  "ESTADOS_MENSAJERO_SUGERIDO",
];

// `MensajeroSugerido` es subcadena de varios de los anteriores, asi que una
// coincidencia se reporta una sola vez por linea: basta con saber que la linea
// tiene rastro.
const PATRON = new RegExp(PROHIBIDOS.join("|"));

interface Hallazgo {
  file: string;
  line: number;
  text: string;
}

function toRelPosix(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function revisarArchivo(abs: string, hallazgos: Hallazgo[]): void {
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (PATRON.test(line)) {
      hallazgos.push({ file: toRelPosix(abs), line: idx + 1, text: line.trim() });
    }
  });
}

function walk(dir: string, hallazgos: Hallazgo[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, hallazgos);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    revisarArchivo(abs, hallazgos);
  }
}

describe("guard sin-mensajero-sugerido (R18, R19, R20)", () => {
  it("el codigo de produccion no contiene ningun identificador de la sugerencia", () => {
    const hallazgos: Hallazgo[] = [];

    for (const dir of SCAN_DIRS) {
      const abs = path.join(REPO_ROOT, dir);
      if (fs.existsSync(abs)) walk(abs, hallazgos);
    }
    for (const file of SCAN_FILES) {
      const abs = path.join(REPO_ROOT, file);
      if (fs.existsSync(abs)) revisarArchivo(abs, hallazgos);
    }

    if (hallazgos.length > 0) {
      const detalle = hallazgos
        .map((h) => `${h.file}:${h.line}: ${h.text}`)
        .join("\n");
      throw new Error(
        `Quedan referencias a la sugerencia de mensajero en produccion:\n${detalle}`,
      );
    }

    expect(hallazgos).toHaveLength(0);
  });

  it("no existe la Server Action de asignacion de mensajero sugerido (R19)", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "lib/actions/mensajeros.ts"))).toBe(false);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "lib/services/AsignacionMensajeroService.ts")),
    ).toBe(false);
  });
});
