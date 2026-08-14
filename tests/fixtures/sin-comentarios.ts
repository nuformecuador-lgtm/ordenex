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

/**
 * Igual, para CSS: **SOLO** bloques `/* … *\/`.
 *
 * Va aparte de `quitarComentarios` por la MISMA razon que `quitarComentariosSql`, y en la
 * direccion contraria: **en CSS no existe el comentario de linea `//`**. Aplicarle la pasada de
 * `//` a una hoja de estilos no quita ningun comentario —no hay ninguno que quitar— pero SI se
 * come una URL protocolo-relativa (`url(//cdn/x)`) **y todo lo que le siga en esa linea**. La
 * declaracion siguiente desaparece del texto que el censo lee, y un censo al que le falta una
 * declaracion no falla: **afirma de menos, en verde**.
 *
 * Es la misma familia de fallo que la feature 209 vino a cerrar, girada de lado. La 209 la dejo
 * escrita como limitacion conocida (`quitador-comentarios.guardia.test.ts`, «un `//` que abre una
 * cadena si se lo lleva») y por eso dejo `analytics-paleta.test.ts` fuera de su alcance. Desde la
 * 223 ese archivo consume el parser de reglas compartido, asi que la puerta habia que cerrarla:
 * el CSS se lee con esta pasada y no con la de TypeScript.
 *
 * Medido en `app/globals.css` el 2026-08-14: **cero** ocurrencias de `//` fuera de un comentario
 * de bloque, asi que hoy las dos pasadas dan el MISMO resultado. El riesgo era latente, no vivo —
 * y el sitio para cerrarlo es antes de que llegue el CSS que lo despierte.
 *
 * Conserva los saltos de linea, igual que las otras dos: un censo que informe `archivo:linea` —o
 * que vuelva al fuente crudo a leer el comentario de una regla, como hacen las guardias de la 217
 * y la 223— depende de que el recuento no cambie.
 */
export function quitarComentariosCss(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, espacioConSaltos);
}

/** Codigo (ya sin comentarios) de un archivo del repo, por su ruta relativa a la raiz. */
export function codigoSinComentarios(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
}

/** Lo mismo para una hoja de ESTILOS: sin la pasada de `//`, que en CSS solo hace daño. */
export function codigoCssSinComentarios(rutaRelativa: string): string {
  return quitarComentariosCss(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
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
