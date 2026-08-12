// Feature 207 — el lector de `expect(…)` de la guardia de aserciones de orden, extraído de
// `columnas-asercion-de-orden.guardia.test.ts`.
//
// Vive aparte por la misma razón que `etiquetas-datatable.ts` y `montajes-componente.ts`: no
// tenía test propio y no podía tenerlo sin importar un `.test.ts` desde otro test (vitest
// re-registraría los `describe` de la guardia y ésta correría dos veces por tanda).
import { quitarComentarios } from "../../fixtures/money-safe";

/** Matchers que fijan una secuencia completa. `toContain`/`toHaveLength` no fijan el orden. */
export const MATCHERS_DE_ORDEN = ["toEqual", "toStrictEqual"] as const;

export interface Asercion {
  /** Texto del argumento de `expect(...)`, con los paréntesis internos equilibrados. */
  sujeto: string;
  /** Nombre del matcher encadenado (`toEqual`, `toBe`…), o `""` si no hay ninguno. */
  matcher: string;
}

/**
 * Extrae cada `expect(<sujeto>).<matcher>` de un archivo de test.
 *
 * Hay que equilibrar paréntesis y respetar cadenas: el sujeto típico
 * (`X.map((c) => c.clave)`) trae paréntesis anidados, y una cadena puede contener un `)`
 * suelto.
 *
 * ------------------------------------------------------------------------------------
 * Feature 207 — SE LEE EL CÓDIGO, NO LA PROSA.
 *
 * El docstring de esta función decía «mismo enfoque que `etiquetasDataTable`», y lo era
 * también en el defecto: escaneaba el fuente CRUDO, así que un `expect(...)` COMENTADO contaba
 * como aserción. Es el peor sitio donde podía estar ese fallo — una guardia que cuenta
 * aserciones puede quedar satisfecha por código que no se ejecuta: basta con comentar la
 * aserción de orden de una lista de columnas para que la guardia siga dando esa lista por
 * cubierta mientras nada vigila el orden que el usuario descarga. Y no es una forma rara: hoy
 * mismo hay 41 menciones de `expect(` dentro de comentarios en `tests/` (17 archivos), ninguna
 * de ellas una aserción de orden de `COLUMNAS_DESCARGA_*` — por eso la cobertura no se movió
 * al arreglarlo, pero la puerta estaba abierta.
 *
 * Se quitan los comentarios ANTES de leer, reusando `quitarComentarios` de
 * `tests/fixtures/money-safe.ts` (línea, bloque y JSX). De paso cierra un falso NEGATIVO
 * simétrico: un comentario ENTRE `expect(...)` y su matcher (o entre los argumentos) rompía la
 * lectura y la aserción no contaba. Las dos caras están fijadas en `aserciones-de-orden.test.ts`.
 */
export function aserciones(fuenteBruta: string): Asercion[] {
  const fuente = quitarComentarios(fuenteBruta);
  const salida: Asercion[] = [];
  const apertura = /\bexpect\s*\(/g;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = apertura.exec(fuente)) !== null) {
    let i = encontrado.index + encontrado[0].length;
    const desde = i;
    let profundidad = 1;
    let comilla: string | null = null;
    while (i < fuente.length && profundidad > 0) {
      const c = fuente[i];
      if (comilla !== null) {
        if (c === comilla && fuente[i - 1] !== "\\") comilla = null;
      } else if (c === '"' || c === "'" || c === "`") {
        comilla = c;
      } else if (c === "(") {
        profundidad++;
      } else if (c === ")") {
        profundidad--;
      }
      i++;
    }
    // Tras el `)` de cierre puede venir `.not`, `.resolves`… antes del matcher; se toma el
    // primer identificador `toXxx` de la cadena.
    const cola = fuente.slice(i, i + 120);
    const matcher = /^(?:\s*\.\s*[A-Za-z]+)*?\s*\.\s*(to[A-Za-z]+)/.exec(cola);
    salida.push({ sujeto: fuente.slice(desde, i - 1), matcher: matcher?.[1] ?? "" });
  }
  return salida;
}

/**
 * `true` si el texto contiene una aserción de ORDEN que nombra a `constante`.
 *
 * Exige las tres cosas del contrato: matcher de secuencia, sujeto que proyecta con `.map(` y
 * el NOMBRE de la constante como sujeto de esa proyección. Y, desde la 207, que la aserción
 * esté VIVA: una comentada no cuenta.
 */
export function tieneAsercionDeOrden(fuente: string, constante: string): boolean {
  const proyeccion = new RegExp(`\\b${constante}\\s*\\.\\s*map\\s*\\(`);
  return aserciones(fuente).some(
    (a) =>
      (MATCHERS_DE_ORDEN as readonly string[]).includes(a.matcher) && proyeccion.test(a.sujeto),
  );
}
