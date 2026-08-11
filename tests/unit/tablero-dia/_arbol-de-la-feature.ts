import fs from "fs";
import path from "path";

/**
 * Feature 192 — EL ARBOL DE LA FEATURE, en un solo sitio.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 *
 * Los guardias censan EL ARBOL y no el diff, a proposito: un guardia que mirase
 * `git diff origin/dev` deja de proteger nada en cuanto la rama se mergea, y peor, pasa a
 * juzgar cualquier rama posterior. Censar los archivos por su ruta sobrevive al merge.
 *
 * Los archivos OBLIGATORIOS se comprueban existentes: si alguien renombra uno y el censo
 * dejara de mirarlo en silencio, el guardia se convertiria en decorado.
 */

export const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Los archivos de backend de la feature. Deben existir todos. */
export const ARCHIVOS_BACKEND = [
  "lib/types/tablero-dia.ts",
  "lib/utils/ventana-dia-cr.ts",
  "lib/interfaces/repositories/ITableroDiaRepository.ts",
  "lib/interfaces/services/ITableroDiaService.ts",
  "lib/interfaces/external/ITableroDiaCache.ts",
  "lib/repositories/TableroDiaRepository.ts",
  "lib/services/TableroDiaService.ts",
  "lib/config/tablero-dia-cache.ts",
  "lib/cache/tablero-dia-cache-nula.ts",
  "lib/cache/tablero-dia-cache-memoria.ts",
  "lib/cache/next-tablero-dia-cache.ts",
  "lib/actions/tablero-dia.ts",
] as const;

/**
 * Directorios de la feature que puede que aun no existan (los escribe el bloque FRONTEND, en
 * paralelo). Se censan SI existen: cuando lleguen, quedan cubiertos sin tocar los guardias.
 */
const DIRECTORIOS_OPCIONALES = ["app/(app)/monitoreo"];

const EXTENSIONES = new Set([".ts", ".tsx"]);

function archivosDe(dir: string): string[] {
  const absoluto = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(absoluto)) return [];
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(absoluto, { withFileTypes: true })) {
    const relativo = path.posix.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosDe(relativo));
    else if (EXTENSIONES.has(path.extname(entrada.name))) salida.push(relativo);
  }
  return salida;
}

/**
 * Los comentarios, fuera. Los archivos de esta feature EXPLICAN por escrito lo que no hacen
 * ("ni un `INSERT`", "no se reutiliza `rollup-dia`"), y un censo que leyera esas frases como
 * infracciones obligaria a borrar la explicacion para pasar el guardia. Se mide el codigo.
 */
export function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

export interface ArchivoDeLaFeature {
  readonly ruta: string;
  /** El archivo tal cual. */
  readonly texto: string;
  /** El archivo SIN comentarios: es lo que censan los guardias. */
  readonly codigo: string;
}

/** Todos los archivos de la feature, con su contenido ya leido. */
export function arbolDeLaFeature(): readonly ArchivoDeLaFeature[] {
  const rutas = [...ARCHIVOS_BACKEND, ...DIRECTORIOS_OPCIONALES.flatMap(archivosDe)];
  return rutas.map((ruta) => {
    const texto = fs.readFileSync(path.join(REPO_ROOT, ruta), "utf8");
    return { ruta, texto, codigo: sinComentarios(texto) };
  });
}
