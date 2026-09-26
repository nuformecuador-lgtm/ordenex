// Ficha 458 (design §7, A7 descartada) — las guardias de la 458 descubren sus archivos POR CARPETA,
// nunca por lista: una pantalla nueva de la wallet entra sola en el barrido. Este modulo NO es un
// test (no casa `*.test.*`): es el censo compartido por las guardias de la 458.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

export const RAIZ = path.resolve(__dirname, "../../..");

/** Las carpetas de las superficies de la wallet (requirements, «Vocabulario»). */
export const CARPETAS_WALLET = [
  "app/(app)/wallet",
  "app/(app)/mi-wallet",
  // Nacen en 458-C/458-D; hoy pueden no existir. Una carpeta ausente aporta 0 archivos.
  "components/shared/estado-cuenta",
  "components/shared/wallet",
] as const;

function recorrer(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...recorrer(ruta));
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Rutas RELATIVAS (con `/`) de todo `.ts`/`.tsx` bajo las carpetas dadas. */
export function archivosBajo(carpetas: readonly string[]): string[] {
  return carpetas
    .map((c) => path.join(RAIZ, c))
    .filter((abs) => existsSync(abs))
    .flatMap(recorrer)
    .map((abs) => path.relative(RAIZ, abs).split(path.sep).join("/"))
    .sort();
}

/** Los archivos de las superficies de la wallet. */
export function archivosDeLaWallet(): string[] {
  return archivosBajo(CARPETAS_WALLET);
}

/** La fuente sin comentarios (los comentarios pueden NOMBRAR lo prohibido para explicarlo). */
export function codigo(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8").replace(/\r\n/g, "\n"));
}

/** La fuente CON comentarios (para las guardias de textos y comentarios desactualizados). */
export function fuente(rutaRelativa: string): string {
  return readFileSync(path.join(RAIZ, rutaRelativa), "utf8").replace(/\r\n/g, "\n");
}
