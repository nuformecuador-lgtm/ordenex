// FICHA 345 — EL PARSER DEL TEXTO DE PRODUCTO. El corazon de la ficha.
//
// `orden.producto` es una columna `String` NOT NULL de texto LIBRE (`db/schema.prisma:578`) que
// las tiendas escriben a mano. Lo que hay dentro, MEDIDO en produccion antes de escribir esto
// (768 ordenes, 2026-09-01):
//
//   - el formato es `cantidad * nombre` en 761 de 768; las 7 restantes son datos de prueba
//     (`PRUEBA`, `PRUEBA 27 08 26`, `Camiseta talla M`) y NO deben romper nada;
//   - el 12 % de las ordenes lleva VARIOS productos, separados por punto + espacio;
//   - los nombres llevan PUNTO DENTRO (`1 * Base Dr. 1 * BASE C.`), asi que partir por `. ` es
//     ambiguo;
//   - los nombres llevan BARRAS VERTICALES de marketing
//     (`BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA`), asi que la barra
//     tampoco separa: eso es UN producto, no tres.
//
// ⚠ POR QUE SE PARTE POR EL MARCADOR Y NO POR EL PUNTO. Esta medido: la regex razonable con
// anticipacion —`(\d+)\s*\*\s*(.+?)(?=\s*\d+\s*\*|$)`— produce **125** productos distintos donde
// el parseo correcto produce **84**. 41 fantasmas, y con un sintoma concreto: un producto
// llamado `"Base Dr. 1 * BASE C"`, que son DOS productos fundidos en uno. Por eso el algoritmo
// localiza los MARCADORES (`<entero> *`) y corta EN ellos: el nombre de un item es todo lo que
// va desde su marcador hasta el siguiente. De ahi salen, sin ningun caso especial, tanto el
// punto interno como la barra vertical.
//
// R1 (modulo puro, vigilado por `tests/unit/analytics/modulo-puro.guardia.test.ts`, que barre el
// directorio entero): este archivo NO IMPORTA NADA. Ni Prisma, ni `db`, ni repositorios, ni
// servicios, ni `next/*`. Sin reloj, sin entorno y sin efectos al importarse.
//
// La funcion es PURA y TOTAL (R22): no lanza con cadena vacia, con solo espacios, con un `*`
// suelto ni con un texto de miles de caracteres, y la misma entrada produce siempre la misma
// salida.

/** Un item de producto ya interpretado. Las CANTIDADES SON ENTEROS: no son dinero, no hay
 *  decimales, y esta ficha no emite ninguna cifra monetaria por producto. */
export interface ItemProducto {
  /** entero >= 1 (R21) */
  readonly cantidad: number;
  /** forma VISIBLE, ya limpia: sin espacios sobrantes y sin puntos finales (R16) */
  readonly nombre: string;
  /** clave de agrupacion: `nombre` en minusculas (R17) */
  readonly clave: string;
}

/**
 * Un marcador de cantidad: un entero seguido de `*` (con espacios opcionales en medio).
 *
 * Global y sin anticipacion A PROPOSITO: aqui solo se localizan los CORTES. Lo que hay entre
 * dos cortes es el nombre, y no se le pide a la regex que lo describa — ese intento es
 * exactamente el que funde `Base Dr. 1 * BASE C` en un solo producto.
 */
const MARCADOR = /(\d+)\s*\*/g;

/** Espacios repetidos (incluidos saltos y tabuladores) que se colapsan a uno. */
const ESPACIOS = /\s+/g;

/** Puntos y espacios FINALES: el punto es el terminador del item, no parte del nombre. */
const TERMINADORES = /[.\s]+$/;

/**
 * `trim` -> colapsar espacios -> quitar puntos y espacios finales -> `trim`.
 *
 * Los puntos finales se van porque **son el terminador del item** y no hay forma de
 * distinguirlos de una abreviatura sin una lista de excepciones. Consecuencia asumida y
 * declarada (⟨Q1⟩ del spec): `Base Dr.` se muestra `Base Dr`.
 */
function limpiar(texto: string): string {
  return texto.trim().replace(ESPACIOS, " ").replace(TERMINADORES, "").trim();
}

/**
 * La clave de agrupacion (R17): dos nombres que solo difieren en mayusculas, en espacios
 * repetidos o en puntos finales son EL MISMO producto.
 *
 * `toLowerCase()` **sin locale** a proposito: `toLocaleLowerCase` depende del entorno (la `I`
 * turca) y esta clave decide que se funde con que. Determinismo antes que correccion
 * tipografica. Medido: normalizar asi no colapsa ninguno de los 84 nombres de produccion — la
 * normalizacion no esta para fundir productos distintos, esta para que el mismo producto
 * escrito con un espacio de mas no se cuente dos veces.
 *
 * NO hay equivalencia por tildes, ni por singular/plural, ni alias (⟨Q6⟩): eso fundiria
 * productos que las tiendas escribieron distintos a proposito.
 */
export function claveDeProducto(nombre: string): string {
  return limpiar(nombre).toLowerCase();
}

/**
 * El nombre VISIBLE de un fragmento de texto.
 *
 * ⚠ LA REGLA DEL ASTERISCO, y es la unica del parser que no sale de una cadena real medida.
 * R14 prohibe que un nombre contenga `*`. Un `*` puede sobrevivir a la particion por dos vias:
 * un marcador INVALIDO (`0 * X`, o una cifra que no es un entero seguro, §R21) o un `*` suelto
 * sin cifra delante. En los dos casos se descarta todo lo anterior al ULTIMO `*` y lo que queda
 * es el nombre (`0 * X` => `X`, cantidad 1).
 *
 * Se escribe explicita para que la invariante R14 sea cierta POR CONSTRUCCION y no por suerte:
 * cualquier nombre que salga de aqui esta libre de `*`, venga de la rama que venga.
 */
function nombreVisible(fragmento: string): string {
  const ultimo = fragmento.lastIndexOf("*");
  return limpiar(ultimo === -1 ? fragmento : fragmento.slice(ultimo + 1));
}

/** Un item, o `null` si el fragmento no deja nombre: un producto sin nombre no es un producto. */
function item(cantidad: number, fragmento: string): ItemProducto | null {
  const nombre = nombreVisible(fragmento);
  if (nombre === "") return null;
  // La clave sale de `claveDeProducto` y NO de un `toLowerCase()` escrito aqui: el servicio
  // agrupa por esta clave y la pantalla la vuelve a calcular sobre nombres crudos. Dos
  // implementaciones de «la misma clave» divergen en el primer cambio de normalizacion.
  return { cantidad, nombre, clave: claveDeProducto(nombre) };
}

interface Marcador {
  /** entero >= 1 */
  readonly cantidad: number;
  /** indice donde EMPIEZA el marcador (donde termina el nombre anterior) */
  readonly inicio: number;
  /** indice donde TERMINA el marcador (donde empieza su nombre) */
  readonly fin: number;
}

/**
 * Los marcadores VALIDOS del texto, en orden.
 *
 * R21 — una aparicion cuenta como marcador solo si su cifra es un entero SEGURO mayor o igual
 * que 1. Lo que no lo sea (`0 *`, un numero de 30 digitos que `parseInt` redondea) **no parte
 * nada** y se queda dentro del nombre que lo contiene: mejor un nombre feo que una unidad
 * inventada.
 */
function marcadoresValidos(texto: string): Marcador[] {
  const encontrados: Marcador[] = [];
  // `lastIndex` a cero antes de empezar. `MARCADOR` es global y se comparte entre llamadas, y
  // una regex global que arranca a medio texto devuelve OTRA COSA para la misma entrada.
  //
  // ⚠ HONESTIDAD SOBRE ESTA LINEA: hoy es REDUNDANTE y esta MEDIDO (2026-09-01) — el bucle de
  // abajo corre hasta que `exec` devuelve `null`, y en ese momento el propio motor pone
  // `lastIndex` a 0. Quitarla no rompe ningun test, y no porque falte cobertura: es que no
  // cambia el comportamiento. Se conserva porque la garantia depende de la FORMA del bucle —el
  // dia que alguien meta un `break` o un `return` temprano, la siguiente llamada empezaria
  // desplazada y el fallo seria mudo—, y esa clase de fallo aqui no lo caza nadie.
  MARCADOR.lastIndex = 0;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = MARCADOR.exec(texto)) !== null) {
    const cantidad = Number.parseInt(encontrado[1], 10);
    if (!Number.isSafeInteger(cantidad) || cantidad < 1) continue;
    encontrados.push({
      cantidad,
      inicio: encontrado.index,
      fin: encontrado.index + encontrado[0].length,
    });
  }
  return encontrados;
}

/**
 * El texto de producto de UNA orden, interpretado como una lista de items (R10).
 *
 * Los pasos, en este orden:
 *
 *  1. texto vacio o solo espacios => `[]` (R20): la orden cuenta como «sin producto
 *     interpretable», que es un hecho distinto de «no tiene productos».
 *  2. sin ningun marcador valido => UN item de cantidad 1 con el texto entero (R15). Es la rama
 *     por la que pasan las 7 filas de prueba medidas (`PRUEBA`, `Camiseta talla M`, ...).
 *  3. el texto ANTERIOR al primer marcador, si deja nombre, produce su propio item de cantidad
 *     1 (R19): nada se descarta en silencio. Hoy no existe ningun caso asi en produccion;
 *     existe para que nada se pierda el dia que aparezca.
 *  4. un item por marcador, cuyo nombre va desde el final del marcador hasta el comienzo del
 *     siguiente (o hasta el final del texto). **Se parte por el marcador, no por el punto ni
 *     por la barra** (R11): de ahi salen R12 y R13 sin ningun caso especial.
 *
 * NO deduplica: dos items del mismo producto en la misma orden salen los dos, y fundirlos
 * —sumando cantidades y contando la orden UNA vez, R26— es trabajo del servicio, que es quien
 * sabe que es «una orden».
 */
export function parsearProducto(texto: string): readonly ItemProducto[] {
  // Total ante entrada basura: esta funcion se llama con lo que haya en una columna de texto
  // libre, y una excepcion aqui tumbaria la lectura entera de la pantalla.
  if (typeof texto !== "string" || texto.trim() === "") return [];

  const marcadores = marcadoresValidos(texto);

  if (marcadores.length === 0) {
    const unico = item(1, texto);
    return unico === null ? [] : [unico];
  }

  const items: ItemProducto[] = [];

  const prefijo = item(1, texto.slice(0, marcadores[0].inicio));
  if (prefijo !== null) items.push(prefijo);

  for (let i = 0; i < marcadores.length; i += 1) {
    const marcador = marcadores[i];
    const siguiente = marcadores[i + 1];
    const fragmento = texto.slice(marcador.fin, siguiente ? siguiente.inicio : texto.length);
    const producido = item(marcador.cantidad, fragmento);
    if (producido !== null) items.push(producido);
  }

  return items;
}
