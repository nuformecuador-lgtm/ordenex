import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { loadOrdenesConfig } from "@/lib/config/ordenes";

// R33/N1: config sobreescribible por entorno con readPositiveInt (patron auth).
// Feature 155/R30: las dos claves que fijaban el estatus inicial y sus variables de entorno se
// RETIRARON. `OrdenesConfig` queda con las dos cotas de paginacion y nada mas.
const ENV_KEYS = ["ORDENES_DEFAULT_PAGE_SIZE", "ORDENES_MAX_PAGE_SIZE"] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("loadOrdenesConfig valores por defecto (N1/R33)", () => {
  it("usa defaults cuando no hay env", () => {
    const cfg = loadOrdenesConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
  });
});

describe("loadOrdenesConfig overrides por entorno", () => {
  it("respeta valores validos de env", () => {
    process.env.ORDENES_DEFAULT_PAGE_SIZE = "10";
    process.env.ORDENES_MAX_PAGE_SIZE = "50";
    const cfg = loadOrdenesConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(10);
    expect(cfg.MAX_PAGE_SIZE).toBe(50);
  });

  it("ignora env no positivo o no numerico y cae al default (R33)", () => {
    process.env.ORDENES_MAX_PAGE_SIZE = "-5";
    process.env.ORDENES_DEFAULT_PAGE_SIZE = "abc";
    const cfg = loadOrdenesConfig();
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
  });
});

// Feature 155/R30 — el requisito tiene DOS mitades y las dos se verifican aparte:
//   (i)  la config de ordenes ya no expone ninguna clave de estatus inicial;
//   (ii) NO queda NINGUNA variable de entorno, en ningun modulo, capaz de fijar en que estado
//        nace una orden. La (ii) es la que importa: retirar la clave y dejar la palanca en otro
//        archivo no cumpliria el requisito.
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if ([".ts", ".tsx"].includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Lecturas de entorno del archivo, en sus dos formas: `process.env.X` y `process.env["X"]`. */
function variablesDeEntornoLeidas(fuente: string): string[] {
  const nombres: string[] = [];
  for (const m of fuente.matchAll(/process\.env\.([A-Z0-9_]+)/g)) nombres.push(m[1]);
  for (const m of fuente.matchAll(/process\.env\[\s*["'`]([A-Z0-9_]+)["'`]\s*\]/g)) {
    nombres.push(m[1]);
  }
  return nombres;
}

describe("155/R30 — ninguna variable de entorno fija el estado en que nace una orden", () => {
  it("(i) OrdenesConfig expone EXACTAMENTE las dos cotas de paginacion", () => {
    expect(Object.keys(loadOrdenesConfig()).sort()).toEqual([
      "DEFAULT_PAGE_SIZE",
      "MAX_PAGE_SIZE",
    ]);
  });

  it("(i) el modulo de config no nombra ninguna variable de estatus en su codigo", () => {
    // El comentario de cabecera cita los nombres retirados para explicar POR QUE se fueron; la
    // asercion va contra el codigo EJECUTABLE, sin las lineas de comentario.
    const ejecutable = fs
      .readFileSync(path.join(REPO_ROOT, "lib", "config", "ordenes.ts"), "utf8")
      .split(/\r?\n/)
      .filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea))
      .join("\n");
    expect(ejecutable).not.toMatch(/ESTATUS/i);
    // Las unicas claves de entorno que quedan nombradas son las dos cotas de paginacion.
    expect([...ejecutable.matchAll(/"(ORDENES_[A-Z0-9_]+)"/g)].map((m) => m[1]).sort()).toEqual(
      [...ENV_KEYS].sort(),
    );
  });

  it("(ii) ningun archivo de app/ ni lib/ lee una variable de entorno de estatus/estado", () => {
    // El nombre de una palanca de este tipo no puede evitar mencionar el concepto: se censa
    // cualquier variable leida cuyo nombre contenga ESTATUS o ESTADO.
    const ofensores: string[] = [];
    for (const rel of ["app", "lib"]) {
      for (const file of walk(path.join(REPO_ROOT, rel))) {
        const sospechosas = variablesDeEntornoLeidas(fs.readFileSync(file, "utf8")).filter((n) =>
          /ESTATUS|ESTADO/.test(n),
        );
        if (sospechosas.length > 0) {
          ofensores.push(`${path.relative(REPO_ROOT, file)} -> ${sospechosas.join(", ")}`);
        }
      }
    }
    expect(ofensores).toEqual([]);
  });
});
