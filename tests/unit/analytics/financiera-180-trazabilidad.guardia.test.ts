import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 180 / T5.x — GUARDIA DE TRAZABILIDAD: R32.
//
// R32 dice, literalmente: «cada requisito `R1..R32` DEBE tener al menos un test nombrado por el
// comportamiento que verifica, y el mapa `R<n> → test` DEBE quedar escrito en
// `progress/impl_180.md`». Es un requisito sobre el PROCESO, y la salida facil era declararlo
// «sin test posible» y dejar el hueco anotado en la bitacora. Pero la mitad que importa —que el
// mapa este COMPLETO y que apunte a tests que EXISTEN— si es comprobable, y un mapa que apunta a
// un archivo borrado es peor que no tener mapa: da la trazabilidad por hecha.
//
// Calca deliberadamente la forma de `financiera-trazabilidad.guardia.test.ts` (feature 127, R36),
// que hace exactamente esto sobre `progress/impl_127.md` y sus 43 requisitos. Que los dos guardias
// se parezcan no es duplicacion perezosa: son dos bitacoras distintas con dos tablas distintas, y
// fusionarlos obligaria a parametrizar el encabezado, el total y la bitacora para no ganar nada.
//
// Lo que este guardia exige, y por que cada cosa:
//
//  1. Los 32 numeros, sin saltos y sin repetidos. Un `R` que desaparece de la tabla al editarla es
//     exactamente el fallo que R32 persigue, y es invisible leyendo por encima 32 filas.
//  2. Cada fila cita al menos un archivo `.test.ts` / `.test.tsx` **que existe en el arbol**.
//     Renombrar un archivo de test sin actualizar el mapa deja la trazabilidad rota en silencio, y
//     esta feature renombro y anadio archivos de sobra para que eso pase de verdad.
//  3. La tabla no puede quedarse vacia ni encogerse: se ancla el numero de filas y el numero de
//     archivos distintos citados. Sin lo segundo, un parser que dejara de encontrar rutas volveria
//     los dos casos de arriba decorativos.
//
// LO QUE NO PUEDE COMPROBAR, y queda dicho para que nadie lo suponga: **que el test citado mida de
// verdad ese requisito**. Un guardia de texto lee una tabla; no ejecuta el test ni entiende que
// afirma. Esa mitad la sostienen LAS MUTACIONES anotadas en `progress/impl_180.md` (seccion
// «Evidencia de mutacion»), donde cada requisito caro se rompe a proposito en el codigo de
// PRODUCCION y se anota que test murio y con que mensaje. Un mapa completo con tests que no
// muerden es exactamente el mismo agujero, mejor disimulado.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const BITACORA = path.join(REPO_ROOT, "progress", "impl_180.md");
const ENCABEZADO = "## Mapa completo `R1..R32` → test";

const TOTAL_REQUISITOS = 32;

/**
 * Cota inferior de archivos DISTINTOS citados. La feature dejo 16 (nueve propios, cinco guardias
 * heredados que amplio, la integracion y este mismo guardia); se ancla por debajo para que
 * consolidar dos casos en un archivo no ponga rojo el guardia, pero vaciar el parser si.
 */
const MINIMO_ARCHIVOS_DISTINTOS = 14;

interface FilaDelMapa {
  readonly numero: number;
  readonly tests: readonly string[];
}

/** Extrae la seccion del mapa: desde su encabezado hasta el siguiente `## `. */
function seccionDelMapa(): string {
  const texto = fs.readFileSync(BITACORA, "utf8");
  const inicio = texto.indexOf(ENCABEZADO);
  if (inicio < 0) {
    throw new Error(`no se encontro el encabezado "${ENCABEZADO}" en progress/impl_180.md`);
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

describe("R32 · el mapa R1..R32 esta completo y apunta a tests que existen", () => {
  const filas = filasDelMapa();

  it("la tabla tiene una fila por requisito: los 32, sin saltos ni repetidos", () => {
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
    expect(distintos.size).toBeGreaterThanOrEqual(MINIMO_ARCHIVOS_DISTINTOS);
    expect([...distintos].every((rel) => rel.startsWith("tests/"))).toBe(true);
  });

  it("los archivos citados no son cascarones: todos tienen cuerpo de test de verdad", () => {
    // Contrapeso del caso anterior. «Existe» es barato: un archivo vacio con el nombre correcto
    // pasaria. Se exige que cada uno declare al menos un caso.
    const distintos = [...new Set(filas.flatMap((f) => f.tests))];
    const vacios = distintos.filter((rel) => {
      const fuente = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      return fuente.length < 500 || !/\bit\s*\(/.test(fuente);
    });
    expect(vacios).toEqual([]);
  });

  it("autocomprobacion: el parser detecta la fila borrada y la ruta inventada", () => {
    // Sobre texto sintetico, para no tocar la bitacora real.
    const tabla = "| R1 | algo | `tests/unit/analytics/cubo-temporal.test.ts` |";
    const parseada = [...tabla.matchAll(/`([^`]*\.test\.tsx?)`/g)].map((m) => m[1]);
    expect(parseada).toEqual(["tests/unit/analytics/cubo-temporal.test.ts"]);
    expect(fs.existsSync(path.join(REPO_ROOT, parseada[0]))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "tests/unit/analytics/no-existe.test.ts"))).toBe(
      false,
    );
    // Y una fila sin ruta se reconoce como fila sin test.
    expect([...("| R2 | algo | pendiente |".matchAll(/`([^`]*\.test\.tsx?)`/g))]).toHaveLength(0);
    // Una linea que no empieza por `| R<n> |` no es una fila del mapa: el encabezado de la tabla
    // y su separador no pueden contarse como requisitos.
    expect("| Requisito | Comportamiento | Test |".match(/^\|\s*R(\d+)\s*\|/)).toBeNull();
    expect("|---|---|---|".match(/^\|\s*R(\d+)\s*\|/)).toBeNull();
  });

  it("autocomprobacion: la seccion se corta en el siguiente `## `, no se come la bitacora entera", () => {
    const seccion = seccionDelMapa();
    expect(seccion.length).toBeGreaterThan(0);
    // El cuerpo de la seccion no puede contener otro encabezado de nivel 2: si lo contuviera,
    // filas de otras tablas de la bitacora entrarian en el censo.
    expect(seccion).not.toContain("\n## ");
  });
});
