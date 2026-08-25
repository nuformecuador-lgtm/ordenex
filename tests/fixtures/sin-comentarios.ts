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
 * | `(^\|[^:])//…`   | la de la 209, y la que este escaner sustituye sin perder nada de lo que hacia |
 *
 * ## Que es, desde la feature 283
 *
 * Un ESCANER de un solo recorrido: lee el fuente de izquierda a derecha, caracter a caracter, y
 * en cada posicion sabe en que contexto esta —codigo, comentario de linea, comentario de bloque,
 * cadena `'…'` / `"…"` o plantilla `` `…` `` con sus interpolaciones `${…}` anidadas—. Respeta
 * los escapes (`\"`, `\'`, `` \` ``) y el anidamiento de plantillas con una pila de profundidad.
 *
 * Hasta la 283 eran DOS `replace` independientes, bloques primero y lineas despues, sin estado
 * compartido: un `/*` escrito dentro de un `//` o dentro de una cadena abria bloque y se tragaba
 * todo hasta el siguiente `*\/` del archivo. Medido sobre el arbol el 2026-08-25: **1.387 lineas
 * de codigo real invisibles en 64 archivos**, con dos peores de **386** y **167** lineas. La
 * causa era exactamente la ausencia de estado entre las dos pasadas, y por eso el arreglo no fue
 * un parche al regex sino un recorrido con estado.
 *
 * ## Que sigue SIN hacer, a proposito
 *
 * **No reconoce literales de expresion regular.** Distinguir `/…/` de una division exige el
 * token anterior, o sea un parser de TypeScript, y este modulo esta en el camino caliente de
 * 159 suites. Consecuencia conocida: una regex que contenga `/*` o `//` **sin escapar y fuera de
 * una clase de caracteres** abre comentario. En la practica esos caracteres se escriben
 * escapados (`/\/\//`, `/\/\*\/`), y el censo diferencial de la 283 lo midio: **cero** lineas
 * perdidas en los 2.697 `.ts`/`.tsx` del arbol. Queda afirmado por un caso de prueba en
 * `quitador-comentarios.guardia.test.ts` para que sea un hecho conocido y no una sorpresa.
 *
 * **Una comilla sin pareja no abre cadena.** En un `.tsx` el texto JSX no va entrecomillado, asi
 * que `<p>Don't panic</p>` habria abierto una cadena que se comeria el archivo hasta el
 * siguiente apostrofo: el mismo fallo silencioso que la 283 vino a cerrar, girado de lado. Como
 * en JavaScript una cadena `'…'` o `"…"` no puede abarcar varias lineas, la ventana para buscar
 * la pareja es LA LINEA; si no la hay, la comilla es un caracter cualquiera. Para la plantilla
 * `` ` `` —que si abarca varias lineas— la ventana es el resto del archivo.
 *
 * **Un bloque sin cerrar no se traga el resto del archivo.** Si un `/*` no tiene `*\/` despues,
 * no es un comentario: es texto. Es lo mismo que hacia el regex no avido de la 209, y es lo que
 * garantiza que el escaner nuevo solo pueda RECUPERAR codigo, nunca perderlo.
 *
 * El numero de lineas del resultado es SIEMPRE el del fuente original.
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
 * Indice de la comilla que cierra la cadena abierta en `inicio`, o `-1` si no hay pareja antes
 * del fin de la linea (y entonces no era una cadena: ver el docstring del modulo).
 */
function finDeCadena(fuente: string, inicio: number, comilla: string): number {
  let i = inicio + 1;
  while (i < fuente.length) {
    const c = fuente[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === comilla) return i;
    if (c === "\n") return -1;
    i++;
  }
  return -1;
}

/**
 * Indice de la comilla invertida que cierra la plantilla abierta en `inicio`, o `-1` si no la
 * hay en el resto del archivo. Las interpolaciones `${…}` se saltan enteras para que una
 * plantilla anidada dentro de una de ellas no cierre la de fuera.
 */
function finDePlantilla(fuente: string, inicio: number): number {
  let i = inicio + 1;
  while (i < fuente.length) {
    const c = fuente[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i;
    if (c === "$" && fuente[i + 1] === "{") {
      const fin = finDeInterpolacion(fuente, i + 2);
      if (fin === -1) return -1;
      i = fin + 1;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Indice de la llave que cierra la interpolacion abierta en `inicio` (que apunta justo despues
 * del `${`). Lleva PILA de profundidad, no bandera: dentro de una interpolacion puede haber
 * objetos, otras plantillas y cadenas, y cualquiera de las tres tiene llaves o comillas propias.
 */
function finDeInterpolacion(fuente: string, inicio: number): number {
  let i = inicio;
  let profundidad = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    if (c === "}") {
      if (profundidad === 0) return i;
      profundidad--;
      i++;
      continue;
    }
    if (c === "{") {
      profundidad++;
      i++;
      continue;
    }
    if (c === "`") {
      const fin = finDePlantilla(fuente, i);
      if (fin === -1) return -1;
      i = fin + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const fin = finDeCadena(fuente, i, c);
      i = fin === -1 ? i + 1 : fin + 1;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Quita los comentarios de bloque (`/* … *\/`, y con ellos los de JSX `{/* … *\/}`) y los de
 * linea (`//`) de un fuente TypeScript, TSX o Prisma.
 *
 * Recorre el fuente UNA vez sabiendo en que contexto esta, asi que un `/*` o un `//` que viven
 * dentro de una cadena, de una plantilla o de otro comentario **no abren nada**. El resultado se
 * construye por segmentos y se cierra con un `join("")`: concatenar caracter a caracter
 * convertiria un O(n) en un O(n²) en cuanto el motor no optimice la cuerda.
 *
 * El numero de lineas del resultado es SIEMPRE el del fuente original: los bloques se sustituyen
 * por un espacio **con sus saltos de linea intactos**, y un `//` no consume su `\n`.
 */
export function quitarComentarios(fuente: string): string {
  const salida: string[] = [];
  const n = fuente.length;
  let i = 0;
  let inicioSegmento = 0;

  while (i < n) {
    const c = fuente[i];

    if (c === "/" && fuente[i + 1] === "*") {
      const cierre = fuente.indexOf("*/", i + 2);
      // Sin `*\/` posterior no es un comentario, es texto: el regex no avido de la 209 tampoco
      // casaba, y tragarselo seria la unica forma que tendria este escaner de PERDER codigo.
      if (cierre === -1) {
        i += 2;
        continue;
      }
      if (i > inicioSegmento) salida.push(fuente.slice(inicioSegmento, i));
      salida.push(espacioConSaltos(fuente.slice(i, cierre + 2)));
      i = cierre + 2;
      inicioSegmento = i;
      continue;
    }

    if (c === "/" && fuente[i + 1] === "/") {
      const salto = fuente.indexOf("\n", i);
      const fin = salto === -1 ? n : salto;
      if (i > inicioSegmento) salida.push(fuente.slice(inicioSegmento, i));
      salida.push(" ");
      i = fin;
      inicioSegmento = i;
      continue;
    }

    if (c === "'" || c === '"') {
      const fin = finDeCadena(fuente, i, c);
      // La cadena se emite TAL CUAL: no se toca su contenido, solo se salta.
      i = fin === -1 ? i + 1 : fin + 1;
      continue;
    }

    if (c === "`") {
      const fin = finDePlantilla(fuente, i);
      i = fin === -1 ? i + 1 : fin + 1;
      continue;
    }

    i++;
  }

  if (n > inicioSegmento) salida.push(fuente.slice(inicioSegmento, n));
  return salida.join("");
}

/**
 * Igual, para SQL: bloque `/* … *\/` y linea `--`.
 *
 * Va aparte de `quitarComentarios` A PROPOSITO. Aplicar la pasada de `--` a un fuente
 * TypeScript se comeria `contador--;` y todo lo que le siguiera en la linea, que es
 * exactamente la clase de falso negativo silencioso que este modulo existe para cerrar.
 *
 * **Sigue siendo dos `replace`, y la 283 no lo cambio.** El daño medido el 2026-08-25 sobre los
 * 307 `.sql` de `db/migrations/**` es CERO: 8 archivos llevan un `/*` dentro de una linea `--`
 * (todos citando una ruta con comodin) pero NINGUNO tiene un `*\/` posterior, asi que el regex
 * de bloque no casa en ningun archivo del arbol; y no hay un solo `--` dentro de un literal. El
 * arreglo correcto tampoco seria este escaner: SQL necesita lexer propio —dollar-quoting `$tag$`
 * con tags anidados, escape `''`, identificadores `"…"` y bloques que en Postgres ANIDAN—. Se
 * difirio con un cable trampa que falla NOMBRANDO EL ARCHIVO el dia que aparezca la precondicion
 * del daño (`quitador-comentarios.guardia.test.ts`, «283 — cable trampa de SQL»).
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
 * Es la misma familia de fallo que la feature 209 vino a cerrar, girada de lado. Aquella la dejo
 * escrita como limitacion conocida y por eso dejo `analytics-paleta.test.ts` fuera de su alcance.
 * Desde la 223 ese archivo consume el parser de reglas compartido, asi que la puerta habia que
 * cerrarla: el CSS se lee con esta pasada y no con la de TypeScript.
 *
 * **Esta funcion NO comparte el arreglo de la 283, y es deliberado.** `quitarComentarios` dejo
 * de confundir cadenas y comentarios el 2026-08-25; esta sigue sin entender cadenas, porque el
 * daño medido en el unico `.css` real del repo (`app/globals.css`) es cero: **cero** `//` en
 * todo el archivo y **cero** `/*` dentro de una cadena CSS. La deuda no queda sin vigilancia —
 * el cable trampa de la 283 falla el dia que la hoja estrene un `/*` entrecomillado, y un caso
 * sintetico afirma esta limitacion directamente para que no se vuelva invisible ahora que las
 * dos pasadas dejaron de coincidir en ese caso.
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
 *
 * DELEGA en `quitarComentarios` y no tiene una sola regla propia: es lo que hace que herede el
 * escaner de la 283 sin escribir una linea, y lo que impide que aparezca un segundo juego de
 * reglas que diverja del primero a la siguiente correccion.
 */
export function lineasSinComentarios(fuente: string): string[] {
  return quitarComentarios(fuente).split("\n");
}
