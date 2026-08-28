// Feature 318 (T2.4, design §1.2, R36) — gemelo EN SQL de `normalizarTerminoBusqueda`
// (`lib/utils/busqueda-orden.ts`).
//
// POR QUE EXISTE. El input de busqueda libre del histórico tiene que encontrar un hilo tambien
// por el NOMBRE DEL MENSAJERO, y ese dato NO esta en `orden.busqueda_texto`: la columna
// generada concatena guia, remision, telefono, destinatario y producto, nada mas
// (`db/schema.prisma`, migracion `20260808120000_orden_busqueda_producto`). El nombre vive en
// tres columnas de `usuario` (`nombre`, `primer_apellido`, `segundo_apellido`) y hay que
// normalizarlo EN LA CONSULTA, porque es una COLUMNA: Prisma no puede normalizarla en el
// `where`, igual que pasa con `orden.telefono_dest` y por eso existe `sqlNormalizarTelefonoCr`
// (`lib/utils/telefono-cr-sql.ts`), cuyo patron este archivo copia.
//
// LA TRAMPA QUE ESTO CIERRA. El termino que teclea el usuario se normaliza en Node; el lado de
// la columna lo normaliza Postgres. Si las dos normalizaciones no coinciden EXACTAMENTE, la
// busqueda «no encuentra» y NADA PETA: ni error, ni log, ni forma de deducirlo leyendo codigo.
// Es el mismo riesgo nº 3 que documenta `busqueda-orden.ts`. Por eso:
//
//   - el mapa de plegado NO se vuelve a escribir aqui: se IMPORTA de `busqueda-orden.ts`
//     (`ACENTOS_FROM` / `ACENTOS_TO`), asi que en TypeScript hay UNA sola copia;
//   - `tests/integration/db/busqueda-texto-sql-paridad.test.ts` evalua ESTA expresion contra
//     un Postgres real sobre un corpus literal y exige que produzca el MISMO texto que la
//     funcion de TypeScript, caso por caso.
//
// El orden de las operaciones es el de la columna generada y el del normalizador de Node, y no
// es intercambiable: `translate()` va ANTES de `lower()` porque `lower()` depende de la
// collation (en una base `LC_CTYPE=C`, `lower('Á')` devuelve `'Á'`). Plegando primero, a
// `lower()` solo se le pide bajar ASCII y el resultado es correcto en cualquier locale; por eso
// el mapa lleva tambien las 24 mayusculas.
import { ACENTOS_FROM, ACENTOS_TO } from "@/lib/utils/busqueda-orden";

/**
 * Clase de espacios ESCRITA EXPLICITA, no `\s`. El `\s` de Postgres y el de JavaScript no
 * cubren lo mismo (el de JS incluye NBSP y U+2028), y la columna generada usa esta forma
 * literal: cualquier otra cosa reintroduciria asimetria justo donde este modulo la cierra.
 *
 * Ojo con el doble backslash: la cadena SQL resultante contiene `\t`, `\n`, … de un solo
 * caracter backslash, que es lo que el motor de regex de Postgres interpreta.
 */
const CLASE_ESPACIOS_SQL = "'[ \\t\\n\\r\\f\\v]+'";

/**
 * Devuelve la expresion SQL que normaliza `expr` igual que `normalizarTerminoBusqueda`:
 *
 *   btrim(regexp_replace(lower(translate(expr, FROM, TO)), '[ \t\n\r\f\v]+', ' ', 'g'))
 *
 * `expr` es una EXPRESION SQL (una columna, o una concatenacion de columnas) y se interpola SIN
 * escapar: los llamantes DEBEN pasar un literal del codigo —`"u.nombre"`, o el `concat_ws` de
 * las tres columnas del nombre—, jamas algo que venga de una request. El termino con el que se
 * compara sigue viajando como PARAMETRO, que es lo unico que puede venir de fuera.
 */
export function sqlNormalizarTextoBusqueda(expr: string): string {
  return `btrim(regexp_replace(lower(translate(${expr}, '${ACENTOS_FROM}', '${ACENTOS_TO}')), ${CLASE_ESPACIOS_SQL}, ' ', 'g'))`;
}
