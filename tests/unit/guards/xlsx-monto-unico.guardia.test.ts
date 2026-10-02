import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Ficha 468 (T2, design §5, R22) — GUARDIA: `celdaMonto` (`lib/utils/xlsx-monto.ts`) es el UNICO punto
 * de la ruta de descarga del libro de la wallet que convierte un importe a numero.
 *
 * Si un modulo de columnas, el adaptador del kardex o el generador convirtiera por su cuenta, la
 * comprobacion de la vuelta (que es lo que garantiza el centimo) dejaria de cubrir esa celda.
 *
 * La ruta medida: el generador comun, los tipos y utilidades del kardex y del detalle por guia, y TODO
 * modulo sin React de `components/shared/wallet/` (alli vive el adaptador que coloca los montos). Los
 * archivos que aun no existen se saltan; los tres del generador DEBEN existir (no-vacuidad).
 */

const RAIZ = path.resolve(__dirname, "../../..");
const CONVERSIONES = [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/];

const OBLIGATORIOS = ["lib/utils/descarga-dataset.ts", "lib/utils/xlsx-template.ts", "lib/utils/csv-template.ts"];
const OPCIONALES = [
  "lib/types/descarga.ts",
  "lib/types/libro-kardex.ts",
  "lib/utils/detalle-por-guia.ts",
  "lib/utils/caja-kardex.ts",
  "lib/utils/estado-cuenta-kardex.ts",
];

function rutaDeDescarga(): string[] {
  const wallet = "components/shared/wallet";
  const deWallet = readdirSync(path.join(RAIZ, wallet))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `${wallet}/${f}`);
  return [...OBLIGATORIOS, ...OPCIONALES.filter((f) => existsSync(path.join(RAIZ, f))), ...deWallet];
}

function convierte(codigo: string): boolean {
  return CONVERSIONES.some((re) => re.test(codigo));
}

describe("468 — R22: celdaMonto es el unico punto de conversion de la descarga", () => {
  it("R22: ningun modulo de la ruta de descarga convierte un importe a numero", () => {
    const archivos = rutaDeDescarga();
    for (const f of OBLIGATORIOS) expect(archivos, `falta ${f}`).toContain(f);
    expect(archivos.length).toBeGreaterThanOrEqual(OBLIGATORIOS.length + 3);
    const culpables = archivos.filter((f) => convierte(codigoSinComentarios(f)));
    expect(culpables).toEqual([]);
  });

  it("contraprueba: la guardia SI ve la conversion de xlsx-monto.ts y una sintetica", () => {
    expect(convierte(codigoSinComentarios("lib/utils/xlsx-monto.ts"))).toBe(true);
    expect(convierte(quitarComentarios("const n = Number(fila.monto);"))).toBe(true);
    expect(convierte(quitarComentarios("// Number(x) citado en un comentario\nconst y = 1;"))).toBe(false);
  });
});
