import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Feature 209 — EL quitador de comentarios del repo. Uno solo.
 *
 * ## Por que existe este archivo
 *
 * Decenas de guardias de este repo no ejecutan nada: ESCANEAN EL FUENTE. Censan quien nombra
 * una columna, quien monta un componente, quien llama a `parseFloat`, quien escribe en una
 * tabla. Todas tienen el mismo problema de base: los comentarios de este arbol NOMBRAN A
 * PROPOSITO lo que el codigo tiene prohibido («money-safe: sin `parseFloat`/`Number`», «ni un
 * `INSERT`»), asi que un barrido sobre el texto crudo denuncia la EXPLICACION y obliga a
 * borrarla para pasar el guardia.
 *
 * Y una guardia que escanea prosa como si fuera codigo no falla ruidosamente: **afirma algo
 * falso** —de mas o de menos— y su veredicto se lee igual de verde.
 *
 * El censo de la ficha 207 encontro **74 archivos de `tests/` con su propio quitador escrito a
 * mano, 78 apariciones y CINCO semanticas distintas** para la misma pasada. La misma linea
 * contaba o no segun que guardia la leyera:
 *
 * | Variante | Que se le escapa |
 * | --- | --- |
 * | `(^\|\s)//.*$`   | exige espacio o inicio de linea antes del `//`: `};// nota` sobrevive |
 * | `^\s*\/\/.*$`    | SOLO lineas de comentario completas: un `// nota` al final de una linea de codigo sobrevive entero |
 * | `//.*$`          | se come el `//` de cualquier URL y con el, el resto de la linea |
 * | `(^\|[^:])//…`   | la correcta, y la que se promueve aqui |
 *
 * ## Que NO es
 *
 * No es un parser de TypeScript. No entiende cadenas ni expresiones regulares: un `//` dentro
 * de un literal se lleva por delante el resto de la linea. Eso esta ELEGIDO: el fallo cae del
 * lado seguro para un censo de prohibiciones (borra codigo -> menos menciones -> el guardia
 * denuncia de menos solo si el infractor comparte linea con una URL), y el caso que de verdad
 * aparece en este arbol —`https://` en una cadena o en un docstring— si esta cubierto.
 */

const RAIZ = path.resolve(__dirname, "../..");

/**
 * Sustituye un comentario de bloque por un espacio CONSERVANDO sus saltos de linea.
 *
 * Sin esto, un bloque multilinea pega la linea de antes con la de despues y un censo que
 * numere lineas —o que ancle con `^`/`$`— pasa a hablar de una linea que no existe.
 */
function espacioConSaltos(bloque: string): string {
  return " " + bloque.replace(/[^\n]/g, "");
}

/**
 * Quita los comentarios de bloque (`/* … *\/`, y con ellos los de JSX `{/* … *\/}`) y los de
 * linea (`//`) de un fuente TypeScript, TSX o Prisma.
 *
 * El `(^|[^:])` es la unica sutileza: impide confundir el `//` de `https://` con el inicio de
 * un comentario. El numero de lineas del resultado es SIEMPRE el del fuente original.
 */
export function quitarComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, espacioConSaltos)
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
}

/**
 * Igual, para SQL: bloque `/* … *\/` y linea `--`.
 *
 * Va aparte de `quitarComentarios` A PROPOSITO. Aplicar la pasada de `--` a un fuente
 * TypeScript se comeria `contador--;` y todo lo que le siguiera en la linea, que es
 * exactamente la clase de falso negativo silencioso que este modulo existe para cerrar.
 */
export function quitarComentariosSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, espacioConSaltos).replace(/--[^\n]*/g, " ");
}

/** Codigo (ya sin comentarios) de un archivo del repo, por su ruta relativa a la raiz. */
export function codigoSinComentarios(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
}

/**
 * Las lineas del fuente con los comentarios ya fuera, alineadas UNA A UNA con las del
 * original: `lineasSinComentarios(f)[i]` es la linea `i + 1` de `f`.
 *
 * Es lo que necesita un censo que informe «archivo:linea»; sin la garantia de alineacion,
 * el numero que reporta al humano apunta a otro sitio.
 */
export function lineasSinComentarios(fuente: string): string[] {
  return quitarComentarios(fuente).split("\n");
}
