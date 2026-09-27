import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// =================================================================================================
// GUARDIA — fix/458-B-async: TODO export de función de un archivo "use server" es `async`
// =================================================================================================
//
// Next.js rechaza al COMPILAR un módulo "use server" que exporta una función no `async` («Server
// Actions must be async functions»), incluidas las firmas de SOBRECARGA. `tsc`, eslint y vitest no lo
// ven: la 458-B dejó diez firmas `export function` en cuatro archivos, la suite entera siguió verde y
// `/wallet` dejó de compilar (build de Vercel del PR #829 en FAILURE). Esta guardia lo mide en la
// fuente: en todo archivo de `lib/` y `app/` cuya primera sentencia es "use server", ningún
// `export function`, `export default function`, ni `export const x = (…) =>` / `function` sin `async`.
//
// Control de NO-VACUIDAD (hay decenas de archivos "use server" y cientos de exports async) y
// CONTRAPRUEBA (la fuente de antes del arreglo cae).

const RAIZ = path.resolve(__dirname, "../../..");

function recorrer(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre.startsWith(".")) continue;
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...recorrer(ruta));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** ¿La primera sentencia del archivo (tras comentarios) es la directiva "use server"? */
function esUseServer(fuente: string): boolean {
  return /^\s*["']use server["'];?/.test(quitarComentarios(fuente));
}

/** Los exports de función NO async de una fuente "use server" (sin comentarios). */
export function exportsNoAsync(fuente: string): string[] {
  const codigo = quitarComentarios(fuente);
  const hallazgos: string[] = [];
  for (const m of codigo.matchAll(/^export\s+(?:default\s+)?function\s*\*?\s*(\w*)/gm)) hallazgos.push(m[1] || "default");
  for (const m of codigo.matchAll(/^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?!async\b)(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)/gm)) {
    hallazgos.push(m[1]);
  }
  return hallazgos;
}

const ARCHIVOS = [...recorrer(path.join(RAIZ, "lib")), ...recorrer(path.join(RAIZ, "app"))]
  .map((abs) => [path.relative(RAIZ, abs).split(path.sep).join("/"), readFileSync(abs, "utf8")] as const)
  .filter(([, fuente]) => esUseServer(fuente));

describe("fix/458-B-async — un archivo \"use server\" solo exporta funciones async", () => {
  it("control de NO-VACUIDAD: hay archivos \"use server\" y exportan actions async", () => {
    expect(ARCHIVOS.length).toBeGreaterThan(50);
    const asyncs = ARCHIVOS.reduce((n, [, f]) => n + (quitarComentarios(f).match(/^export async function/gm)?.length ?? 0), 0);
    expect(asyncs).toBeGreaterThan(200);
    expect(ARCHIVOS.map(([r]) => r)).toContain("lib/actions/liquidacion.ts");
  });

  it("ningún export de función sin `async` (incluidas las firmas de sobrecarga)", () => {
    const infractores = ARCHIVOS.flatMap(([ruta, fuente]) => exportsNoAsync(fuente).map((n) => `${ruta}: ${n}`));
    expect(infractores).toEqual([]);
  });

  it("CONTRAPRUEBA: la fuente de la 458-B (sobrecarga sin async) y un export const flecha caen", () => {
    const antes = [
      '"use server";',
      "export function registrarPagoTiendaAction(input: FormData): Promise<A>;",
      "export function registrarPagoTiendaAction(input: unknown): Promise<B>;",
      "export async function registrarPagoTiendaAction(input: unknown): Promise<A | B> { return x; }",
      "export const otra = (a: string) => a;",
      "export const bien = async (a: string) => a;",
      "// export function soloEnUnComentario() {}",
    ].join("\n");
    expect(esUseServer(antes)).toBe(true);
    expect(exportsNoAsync(antes)).toEqual(["registrarPagoTiendaAction", "registrarPagoTiendaAction", "otra"]);
    // Y un archivo que NO es "use server" no entra en el censo.
    expect(esUseServer('import x from "y";\n"use server";')).toBe(false);
  });
});
