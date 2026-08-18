// Feature 230 (T3.6, R52) — GUARDIA de la PROSA de la cabecera de
// `cierre-gestiones-descarga-columnas.ts`.
//
// Por qué una guardia y no una revisión. Aquella cabecera (feature 170, P2) decía «no hay un
// archivo único del cierre porque las cinco secciones no comparten columnas». La 230 construye
// justamente ese archivo único, así que la frase pasó a ser FALSA: quien la leyera mañana
// buscaría una descarga fundida, no la encontraría en ese módulo y concluiría que no existe.
// Una afirmación falsa en la cabecera de un módulo de dinero cuesta más que una función mal
// nombrada, porque nadie la compila.
//
// Y la mitad simétrica, que es la que hace que esto no sea un simple `includes`: la RAZÓN
// histórica no se puede borrar. Las cinco descargas por sección NO se retiran (D4/R3), y siguen
// existiendo por el motivo que P2 escribió. Un futuro «limpiador de comentarios» que borre el
// párrafo entero deja el módulo sin explicación de por qué son cinco y no una, que es
// exactamente la pregunta que alguien se hará al ver la fundida al lado.
//
// El detector se AUTOCOMPRUEBA con cadenas sintéticas en las dos direcciones (mismo patrón que
// `columnas-asercion-de-orden.guardia.test.ts`): una guardia de prosa rota no falla, calla.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

const MODULO = "app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts";

/** La cabecera es el primer bloque `/** … *\/` del archivo, antes de cualquier import. */
function cabeceraDe(fuente: string): string {
  const fin = fuente.indexOf("*/");
  return fin === -1 ? "" : fuente.slice(0, fin + 2);
}

/**
 * La afirmación que la feature 230 vuelve FALSA, en las formas en que suele escribirse. No se
 * busca la frase exacta de 2026-08-13: se busca lo que AFIRMA, para que una reescritura con
 * otras palabras no se cuele.
 */
const NIEGA_EL_ARCHIVO_UNICO =
  /\bno\s+(hay|existe|se\s+ofrece)\b[^.]{0,80}\barchivo\s+(único|unico)\b/i;

/** La razón histórica que NO se puede perder: la decisión P2 de la feature 170. */
const CONSERVA_LA_RAZON_P2 = /\bP2\b/;
const CONSERVA_LA_FEATURE_170 = /\b(feature\s+)?170\b/i;
/** Y el porqué en sí: las celdas vacías que fundir las cinco secciones produce. */
const CONSERVA_EL_MOTIVO = /celdas\s+vac(í|i)as/i;

/** Problemas de una cabecera. Vacío = cabecera correcta. */
export function problemasDeLaCabecera(cabecera: string): string[] {
  const problemas: string[] = [];
  if (NIEGA_EL_ARCHIVO_UNICO.test(cabecera)) {
    problemas.push(
      "la cabecera sigue afirmando que NO existe un archivo único del cierre; la feature 230 lo construyó (R52)",
    );
  }
  if (!CONSERVA_LA_RAZON_P2.test(cabecera) || !CONSERVA_LA_FEATURE_170.test(cabecera)) {
    problemas.push(
      "la cabecera perdió la mención a la decisión P2 de la feature 170, que es la razón por la que hay CINCO declaraciones y no una (R52)",
    );
  }
  if (!CONSERVA_EL_MOTIVO.test(cabecera)) {
    problemas.push(
      "la cabecera perdió el motivo de aquella decisión (la hoja con celdas vacías), y sin él la P2 es un número (R52)",
    );
  }
  return problemas;
}

describe("guardia de la prosa de la cabecera de las cinco descargas por sección (R52)", () => {
  it("el detector responde a los dos canarios sintéticos (autocomprobación)", () => {
    // POSITIVO: una cabecera con la frase vieja tiene que MORDER.
    const vieja = `/**
 * **Una declaración POR SECCIÓN** (decisión del humano, P2 ratificada de la feature 170).
 * No hay un archivo único del cierre porque las cinco secciones no comparten columnas.
 * Fundirlas daría una hoja llena de celdas vacías que nadie sabría leer.
 */`;
    expect(problemasDeLaCabecera(vieja)).toEqual([
      "la cabecera sigue afirmando que NO existe un archivo único del cierre; la feature 230 lo construyó (R52)",
    ]);

    // NEGATIVO 1: una cabecera correcta no da ningún problema.
    const corregida = `/**
 * **Una declaración POR SECCIÓN** (decisión del humano, P2 de la feature 170). Fundirlas da
 * una hoja con celdas vacías, y ése fue el motivo de no hacerlo aquí.
 * Feature 230: ese archivo único AHORA EXISTE, en otro módulo y con otro punto de entrada.
 */`;
    expect(problemasDeLaCabecera(corregida)).toEqual([]);

    // NEGATIVO 2: una cabecera que se comió la razón histórica también MUERDE, aunque ya no
    // afirme nada falso. Es la mitad que un `includes` de la frase vieja no cubriría.
    const amputada = `/**
 * Columnas de export de las secciones por resultado del detalle de un cierre.
 * Feature 230: el archivo único vive en el módulo de la hoja fundida.
 */`;
    expect(problemasDeLaCabecera(amputada)).toHaveLength(2);
  });

  it("la cabecera ya no afirma que no existe un archivo único y conserva la razón de la P2", () => {
    const fuente = readFileSync(path.join(RAIZ, MODULO), "utf8");
    const cabecera = cabeceraDe(fuente);

    // No-vacuidad: si el archivo se renombra o la cabecera desaparece, esto lo dice en vez de
    // pasar verde sobre una cadena vacía.
    expect(cabecera.length).toBeGreaterThan(200);
    expect(cabecera).toContain("Una declaración POR SECCIÓN");

    expect(problemasDeLaCabecera(cabecera)).toEqual([]);

    // Y lo que la 230 añadió: dónde vive ahora el archivo único, y que las cinco NO se retiran.
    expect(cabecera).toContain("cierres-gestiones-fundida-descarga-columnas.ts");
    expect(cabecera).toMatch(/no\s+se\s+retiran/i);
  });
});
