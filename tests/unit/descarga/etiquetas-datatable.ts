// Feature 207 — el lector de `<DataTable>` del censo, extraído de la guardia.
//
// Vive aparte de `cobertura-tablas.guardia.test.ts` por una razón concreta: hasta hoy la
// función no tenía NINGÚN test propio, y no lo tenía porque no se podía escribir sin
// importar un archivo `.test.ts` desde otro (vitest re-registraría los `describe` de la
// guardia y ésta correría dos veces). Con el lector en un módulo normal —igual que
// `censo-tablas.ts`, que también vive en esta carpeta sin ser un test— la guardia lo importa
// y `etiquetas-datatable.test.ts` lo examina directamente.
import { quitarComentarios } from "../../fixtures/money-safe";

/**
 * Devuelve el TEXTO de la etiqueta de apertura de cada `<DataTable …>` del archivo.
 *
 * Hay que parsear de verdad y no partir por líneas: un archivo puede montar dos tablas
 * (`CierresAdminModule`) y solo una declarar `descarga`. Se respetan los parámetros
 * genéricos (`<DataTable<OrdenConError>`), las llaves anidadas de los atributos y las
 * cadenas, de modo que la etiqueta termina en el primer `>` de nivel cero.
 *
 * ------------------------------------------------------------------------------------
 * Feature 207 — SE ESCANEA EL CÓDIGO, NO LA PROSA.
 *
 * El escaneo se hacía sobre el fuente CRUDO, así que nombrar la etiqueta dentro de un
 * comentario contaba como una tabla DE ESE ARCHIVO. Mordió dos veces:
 *
 *  - feature 200 (tanda 2): un comentario que citaba la etiqueta hizo que el archivo
 *    declarase DOS tablas y puso la guardia en rojo;
 *  - feature 205: `RepartoPrevisualizacion.tsx` NO monta ninguna tabla —pinta una lista de
 *    `li` y ni siquiera importa el componente— y la guardia lo denunció igual por una frase
 *    de su cabecera.
 *
 * El daño no es el rojo, es a qué entrena: en la segunda ocurrencia se llegó a encargar
 * registrar en el censo una tabla que no existe. Una guardia con falsos positivos enseña a
 * saltársela, que es lo contrario de para lo que existe.
 *
 * Por eso los comentarios se quitan ANTES de escanear, con el mismo `quitarComentarios` que
 * ya usan los barridos money-safe (`tests/fixtures/money-safe.ts`). Cubre las tres formas de
 * citar la etiqueta en prosa: el comentario de línea, el de bloque —que es también el de los
 * docstrings— y el de JSX, que es un comentario de bloque envuelto en llaves y por tanto cae
 * con el mismo barrido, dejando atrás un par de llaves vacío que no engaña al parser. El de
 * línea no se confunde con el `//` de una URL.
 *
 * Quitarlos arregla además dos falsos NEGATIVOS del mismo origen, porque hasta ahora el
 * parser leía el interior de un comentario metido ENTRE los atributos de una etiqueta real:
 * un `descarga=` comentado contaba como descarga declarada, y un apóstrofo o un `>` en una
 * frase en español abrían una cadena o cerraban la etiqueta antes de tiempo.
 *
 * Lo que NO cambia: un `<DataTable` real sigue contando, genéricos incluidos. Los totales
 * del censo no se movieron con el arreglo (31 archivos / 32 instancias, medido antes y
 * después). Las dos caras están fijadas en `etiquetas-datatable.test.ts`.
 */
export function etiquetasDataTable(fuenteBruta: string): string[] {
  const fuente = quitarComentarios(fuenteBruta);
  const etiquetas: string[] = [];
  const inicio = /<DataTable[\s<>]/g;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = inicio.exec(fuente)) !== null) {
    let i = encontrado.index + "<DataTable".length;
    // Parámetro genérico: `<DataTable<Foo>` — se salta contando `<` y `>`.
    if (fuente[i] === "<") {
      let anguloProfundidad = 0;
      do {
        if (fuente[i] === "<") anguloProfundidad++;
        else if (fuente[i] === ">") anguloProfundidad--;
        i++;
      } while (i < fuente.length && anguloProfundidad > 0);
    }
    let llaveProfundidad = 0;
    let comilla: string | null = null;
    const desde = i;
    while (i < fuente.length) {
      const c = fuente[i];
      if (comilla !== null) {
        if (c === comilla && fuente[i - 1] !== "\\") comilla = null;
      } else if (c === '"' || c === "'" || c === "`") {
        comilla = c;
      } else if (c === "{") {
        llaveProfundidad++;
      } else if (c === "}") {
        llaveProfundidad--;
      } else if (c === ">" && llaveProfundidad === 0) {
        break;
      }
      i++;
    }
    etiquetas.push(fuente.slice(desde, i));
  }
  return etiquetas;
}
