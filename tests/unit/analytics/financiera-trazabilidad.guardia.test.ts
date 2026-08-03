import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 127 / T F.7 — GUARDIA DE TRAZABILIDAD: R36.
//
// R36 dice, literalmente: «cada requisito R1-R43 DEBE tener al menos un test nombrado por el
// comportamiento y **mapeado en `progress/impl_127.md`**». Es un requisito sobre el proceso, y
// la salida facil era declararlo "sin test posible" y dejar el hueco anotado. Pero la mitad que
// importa —que el mapa este completo y que apunte a tests que EXISTEN— si es comprobable, y un
// mapa que apunta a un archivo borrado es peor que no tener mapa: da la trazabilidad por hecha.
//
// Lo que este guardia exige, y por que cada cosa:
//
//  1. Los 43 numeros, sin saltos y sin repetidos. Un `R` que desaparece de la tabla al editarla
//     es exactamente el fallo que R36 persigue, y es invisible leyendo por encima 43 filas.
//  2. Cada fila cita al menos un archivo `.test.ts` **que existe en el arbol**. Renombrar un
//     archivo de test sin actualizar el mapa deja la trazabilidad rota en silencio.
//  3. La tabla no puede quedarse vacia ni encogerse: se ancla el numero de filas.
//
// Lo que NO puede comprobar, y queda dicho para que nadie lo suponga: que el test citado mida
// de verdad ese requisito. Eso lo sostienen las mutaciones (`progress/impl_127*.md`, seccion
// «Evidencia de mutacion»), no un guardia de texto.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const BITACORA = path.join(REPO_ROOT, "progress", "impl_127.md");
const ENCABEZADO = "## Mapa completo `R1..R43` → test (F.7)";

const TOTAL_REQUISITOS = 43;

interface FilaDelMapa {
  readonly numero: number;
  readonly tests: readonly string[];
}

/** Extrae la seccion del mapa: desde su encabezado hasta el siguiente `## `. */
function seccionDelMapa(): string {
  const texto = fs.readFileSync(BITACORA, "utf8");
  const inicio = texto.indexOf(ENCABEZADO);
  if (inicio < 0) {
    throw new Error(`no se encontro el encabezado "${ENCABEZADO}" en progress/impl_127.md`);
  }
  const resto = texto.slice(inicio + ENCABEZADO.length);
  const fin = resto.indexOf("\n## ");
  return fin < 0 ? resto : resto.slice(0, fin);
}

/** Las filas `| R<n> | ... | `ruta.test.ts` ... |` de la tabla. */
function filasDelMapa(): readonly FilaDelMapa[] {
  const filas: FilaDelMapa[] = [];
  for (const linea of seccionDelMapa().split("\n")) {
    const encabezado = linea.match(/^\|\s*R(\d+)\s*\|/);
    if (!encabezado) continue;
    const tests = [...linea.matchAll(/`([^`]*\.test\.tsx?)`/g)].map((m) => m[1]);
    filas.push({ numero: Number(encabezado[1]), tests });
  }
  return filas;
}

describe("R36 · el mapa R1..R43 esta completo y apunta a tests que existen", () => {
  const filas = filasDelMapa();

  it("la tabla tiene una fila por requisito: los 43, sin saltos ni repetidos", () => {
    const numeros = filas.map((f) => f.numero);
    expect(numeros).toHaveLength(TOTAL_REQUISITOS);
    expect([...new Set(numeros)]).toHaveLength(TOTAL_REQUISITOS);
    expect([...numeros].sort((a, b) => a - b)).toEqual(
      Array.from({ length: TOTAL_REQUISITOS }, (_, i) => i + 1),
    );
  });

  it("ningun requisito se queda sin test citado", () => {
    const sinTest = filas.filter((f) => f.tests.length === 0).map((f) => `R${f.numero}`);
    expect(sinTest).toEqual([]);
  });

  it("y todos los archivos de test citados existen de verdad en el arbol", () => {
    const rotos: string[] = [];
    for (const fila of filas) {
      for (const rel of fila.tests) {
        if (!fs.existsSync(path.join(REPO_ROOT, rel))) rotos.push(`R${fila.numero}: ${rel}`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("el censo no pasa por conjunto vacio: la tabla se leyo y cita varios archivos distintos", () => {
    expect(filas.length).toBeGreaterThan(0);
    const distintos = new Set(filas.flatMap((f) => f.tests));
    // Las cuatro tandas dejaron mas de una decena de archivos; si el parser dejara de encontrar
    // rutas, los dos casos de arriba pasarian sin mirar nada.
    expect(distintos.size).toBeGreaterThanOrEqual(12);
    expect([...distintos].every((rel) => rel.startsWith("tests/"))).toBe(true);
  });

  it("autocomprobacion: el parser detecta la fila borrada y la ruta inventada", () => {
    // Sobre texto sintetico, para no tocar la bitacora real.
    const tabla = "| R1 | algo | `tests/unit/analytics/financiera-fuente.guardia.test.ts` |";
    const parseada = [...tabla.matchAll(/`([^`]*\.test\.tsx?)`/g)].map((m) => m[1]);
    expect(parseada).toEqual(["tests/unit/analytics/financiera-fuente.guardia.test.ts"]);
    expect(fs.existsSync(path.join(REPO_ROOT, parseada[0]))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "tests/unit/analytics/no-existe.test.ts"))).toBe(
      false,
    );
    // Y una fila sin ruta se reconoce como fila sin test.
    expect([...("| R2 | algo | pendiente |".matchAll(/`([^`]*\.test\.tsx?)`/g))]).toHaveLength(0);
  });
});
