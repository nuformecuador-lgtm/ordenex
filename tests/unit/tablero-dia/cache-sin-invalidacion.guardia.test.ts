import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, arbolDeLaFeature, sinComentarios } from "./_arbol-de-la-feature";

// Feature 192 (B9.8) — R71, R38.
//
// La caché de esta feature expira UNICAMENTE por tiempo. No es una preferencia de diseño: la
// invalidacion por evento haria el comportamiento no auditable y los tests no deterministas, y
// acoplaria rutas de escritura calientes (crear una gestion, mover una orden) a una pantalla
// de lectura. El humano la descarto explicitamente (alternativa 21).
//
// La defensa fuerte es que el PUERTO NO TIENE donde engancharla: un solo metodo, sin `tags` y
// sin `invalidar`. Lo que no existe no se puede colgar de una escritura. Este guardia lo
// atornilla y ademas acota `next/cache` a un unico archivo — un import mal colocado tumbaria
// la suite unitaria del servicio, que corre sin runtime de Next.

const PUERTO = "lib/interfaces/external/ITableroDiaCache.ts";
const ADAPTADOR_DE_NEXT = "lib/cache/next-tablero-dia-cache.ts";

function leer(ruta: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ruta), "utf8");
}

describe("la cache del tablero no tiene invalidacion", () => {
  it("el puerto declara UN solo metodo y no declara invalidar ni tags (R71)", () => {
    const texto = sinComentarios(leer(PUERTO));
    expect(texto).toContain("envolver<T>(clave: string, producir: () => Promise<T>): Promise<T>;");
    expect(texto).not.toMatch(/\binvalidar\s*\(/);
    expect(texto).not.toMatch(/\btags\s*:/);
    // Un solo metodo declarado en la interfaz, contado sobre el codigo.
    expect(texto.match(/^\s{2}\w+[<(]/gm) ?? []).toHaveLength(1);
  });

  it("ningun archivo de la feature importa revalidateTag / revalidatePath / updateTag (R71)", () => {
    for (const { ruta, codigo } of arbolDeLaFeature()) {
      for (const prohibido of ["revalidateTag", "revalidatePath", "updateTag"]) {
        expect(codigo.includes(prohibido), `${ruta} usa ${prohibido}`).toBe(false);
      }
    }
  });

  it("solo el adaptador de produccion importa next/cache", () => {
    for (const { ruta, codigo } of arbolDeLaFeature()) {
      if (ruta === ADAPTADOR_DE_NEXT) continue;
      expect(codigo.includes("next/cache"), `${ruta} importa next/cache`).toBe(false);
    }
    expect(leer(ADAPTADOR_DE_NEXT)).toContain('from "next/cache"');
  });

  it("el adaptador de produccion solo usa unstable_cache con TTL, sin tags", () => {
    const texto = sinComentarios(leer(ADAPTADOR_DE_NEXT));
    expect(texto).toContain("unstable_cache");
    expect(texto).toContain("revalidate: TABLERO_DIA_CACHE_TTL_SEGUNDOS");
    expect(texto).not.toMatch(/tags\s*:/);
    // Sin `revalidate: false`: una entrada sin TTL no expiraria nunca y, sin invalidacion,
    // congelaria la cifra para siempre.
    expect(texto).not.toContain("revalidate: false");
  });

  it("la feature no reutiliza el puerto ni la caché de la analitica (R38)", () => {
    for (const { ruta, codigo } of arbolDeLaFeature()) {
      for (const prohibido of [
        "IAnaliticaCache",
        "next-analitica-cache",
        "analytics_daily",
        "rollup-dia",
      ]) {
        expect(codigo.includes(prohibido), `${ruta} se apoya en ${prohibido}`).toBe(false);
      }
    }
  });

  it("el TTL se declara en un unico sitio (R72)", () => {
    const config = leer("lib/config/tablero-dia-cache.ts");
    expect(config).toContain("export const TABLERO_DIA_CACHE_TTL_SEGUNDOS");
    for (const { ruta, codigo } of arbolDeLaFeature()) {
      if (ruta === "lib/config/tablero-dia-cache.ts") continue;
      expect(/TABLERO_DIA_CACHE_TTL_SEGUNDOS\s*=/.test(codigo), `${ruta} redeclara el TTL`).toBe(
        false,
      );
    }
  });
});
