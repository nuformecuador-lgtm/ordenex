import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 186 / T E.3 — GUARDIA DE TRAZABILIDAD: R18.
//
// R18 dice, literalmente: «cada requisito `R1..R18` DEBE tener al menos un test nombrado por el
// comportamiento que verifica, y el mapa `R<n> → test` DEBE quedar escrito en
// `progress/impl_186.md` citando archivos que existan en el arbol». Es un requisito sobre el
// PROCESO, y la salida facil era declararlo «sin test posible» y dejar el hueco anotado en la
// bitacora. Pero la mitad que importa —que el mapa este COMPLETO y que apunte a tests que
// EXISTEN— si es comprobable, y un mapa que apunta a un archivo borrado es peor que no tener
// mapa: da la trazabilidad por hecha.
//
// Calca deliberadamente la forma de `tests/unit/analytics/financiera-180-trazabilidad.guardia.test.ts`
// (feature 180, R32), que a su vez calca el de la 127. Que se parezcan no es duplicacion perezosa:
// son bitacoras distintas con tablas distintas, y fusionarlos obligaria a parametrizar el
// encabezado, el total y la ruta para no ganar nada.
//
// POR QUE ESTE GUARDIA EXISTE EN ESTA FEATURE, con nombre y apellidos: en la 188 tres filas del
// anexo apuntaban a casos que no estaban donde decian. Un mapa se escribe una vez y se lee
// muchas; el dia que un archivo de test se renombra, la unica pieza que lo nota es esta.
//
// LO QUE NO PUEDE COMPROBAR, y queda dicho para que nadie lo suponga: **que el test citado mida
// de verdad ese requisito**. Un guardia de texto lee una tabla; no ejecuta el test ni entiende
// que afirma. Esa mitad la sostienen LAS MUTACIONES anotadas en `progress/impl_186.md` (seccion
// «Evidencia de mutacion»), donde cada requisito caro se rompe a proposito en el codigo de
// PRODUCCION y se anota que test murio. Un mapa completo con tests que no muerden es exactamente
// el mismo agujero, mejor disimulado — y en esta feature dos mutaciones SOBREVIVIERON a la
// primera version de sus casos, que es la prueba de que la advertencia no es retorica.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const BITACORA = path.join(REPO_ROOT, "progress", "impl_186.md");
const ENCABEZADO = "## Mapa completo `R1..R18` → test";

const TOTAL_REQUISITOS = 18;

/**
 * Cota inferior de archivos DISTINTOS citados. La feature deja cuatro (el de componente, el del
 * adaptador, el guardia del tablero y este mismo); se ancla por debajo para que consolidar dos
 * casos en un archivo no ponga rojo el guardia, pero vaciar el parser si.
 */
const MINIMO_ARCHIVOS_DISTINTOS = 4;

interface FilaDelMapa {
  readonly numero: number;
  readonly tests: readonly string[];
}

/** Extrae la seccion del mapa: desde su encabezado hasta el siguiente `## `. */
function seccionDelMapa(): string {
  const texto = fs.readFileSync(BITACORA, "utf8");
  const inicio = texto.indexOf(ENCABEZADO);
  if (inicio < 0) {
    throw new Error(`no se encontro el encabezado "${ENCABEZADO}" en progress/impl_186.md`);
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
    const tests = [...linea.matchAll(/`([^`]*\.test\.tsx?)`/g)].map((m) => m[1]!);
    filas.push({ numero: Number(encabezado[1]), tests });
  }
  return filas;
}

describe("R18 · el mapa R1..R18 esta completo y apunta a tests que existen", () => {
  const filas = filasDelMapa();

  it("el mapa R1..R18 esta completo, sin saltos ni repetidos, y cita tests que existen", () => {
    const numeros = filas.map((f) => f.numero);
    expect(numeros).toHaveLength(TOTAL_REQUISITOS);
    expect([...new Set(numeros)]).toHaveLength(TOTAL_REQUISITOS);
    expect([...numeros].sort((a, b) => a - b)).toEqual(
      Array.from({ length: TOTAL_REQUISITOS }, (_, i) => i + 1),
    );

    const rotos: string[] = [];
    for (const fila of filas) {
      for (const rel of fila.tests) {
        if (!fs.existsSync(path.join(REPO_ROOT, rel))) rotos.push(`R${fila.numero}: ${rel}`);
      }
    }
    expect(rotos, "el mapa cita archivos de test que no estan en el arbol").toEqual([]);
  });

  it("ningun requisito se queda sin test citado", () => {
    const sinTest = filas.filter((f) => f.tests.length === 0).map((f) => `R${f.numero}`);
    expect(sinTest).toEqual([]);
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

  it("cada fila nombra el CASO, no solo el archivo: el mapa se escribio abriendo los tests", () => {
    // La diferencia entre un mapa util y una lista de rutas. Sin esto, dieciocho filas citando
    // el mismo archivo pasarian los casos de arriba y no dirian donde mirar. Se exige un
    // segundo trozo entre comillas invertidas que NO sea una ruta de test.
    const sinCaso = filas
      .filter((fila) => {
        const linea = seccionDelMapa()
          .split("\n")
          .find((l) => l.match(/^\|\s*R(\d+)\s*\|/)?.[1] === String(fila.numero));
        const citas = [...(linea ?? "").matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
        return citas.filter((cita) => !/\.test\.tsx?$/.test(cita)).length === 0;
      })
      .map((fila) => `R${fila.numero}`);

    expect(sinCaso, "citan archivo pero no nombre de caso").toEqual([]);
  });

  it("autocomprobacion: el parser detecta la fila borrada y la ruta inventada", () => {
    // Sobre texto sintetico, para no tocar la bitacora real.
    const tabla = "| R1 | algo | `tests/unit/guards/tablero-financiero.guardia.test.ts` |";
    const parseada = [...tabla.matchAll(/`([^`]*\.test\.tsx?)`/g)].map((m) => m[1]!);
    expect(parseada).toEqual(["tests/unit/guards/tablero-financiero.guardia.test.ts"]);
    expect(fs.existsSync(path.join(REPO_ROOT, parseada[0]!))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "tests/unit/guards/no-existe.test.ts"))).toBe(false);
    // Y una fila sin ruta se reconoce como fila sin test.
    expect([..."| R2 | algo | pendiente |".matchAll(/`([^`]*\.test\.tsx?)`/g)]).toHaveLength(0);
    // Una linea que no empieza por `| R<n> |` no es una fila del mapa: el encabezado de la
    // tabla y su separador no pueden contarse como requisitos.
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
