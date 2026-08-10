// Feature 184 — analitica financiera: export de la serie (T2.1, design §4.2).
// COLUMNAS DE EXPORT de la analitica financiera y la proyeccion de UNA fila.
//
// ⚠ AVISO DE NUMERACION. En este arbol hay 111 comentarios, una constante `PENDIENTES_184` y
// 60 mensajes de commit que dicen «Feature 184» refiriendose a OTRA ficha: aquella era la 184
// y se renumero a la **188** (`specs/188-deuda-170-listados-completos/requirements.md`). Por eso
// esta cabecera —y todas las de esta feature— se rotulan con NOMBRE y no solo con numero.
//
// POR QUE ESTE ARCHIVO SE LLAMA ASI. El nombre no es decorativo: la guardia perenne de la 170
// (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) descubre POR CONVENCION DE NOMBRE
// (`*-descarga-columnas.ts`) todas las declaraciones de columnas de export del arbol —no hay
// lista fija— y exige que no exista ninguna fuera de esa convencion. Ademas ejecuta la
// proyeccion con una SONDA que delata QUE CAMPO lee cada celda. Declarar estas columnas con
// otro nombre las habria dejado fuera de ese censo (R26).
//
// Modulo PURO: sin React, sin DOM, sin servicio, sin repositorio, sin Prisma y sin catalogo de
// servidor. Toma lo que la Server Action ya devolvio y lo pone en filas.
//
// LO QUE ESTE MODULO NO HACE, Y ES DELIBERADO:
//
//  - **No resuelve ningun identificador a un nombre** (R11). Ni tienda, ni persona, ni cierre.
//    Resolverlos es la ficha 181, que esta feature NO hereda: la excluye por R12 (solo entran
//    las vistas TEMPORALES, cuya clave de cubo es una fecha POR CONSTRUCCION).
//  - **No convierte el dinero a `number`** (R18 / D2). El importe se escribe TAL CUAL llega:
//    cadena de escala 2. `lib/types/analitica-financiera.ts` declara que ningun `number`
//    representa dinero en ninguna frontera, y la unica frontera string->number de la app
//    (`aNumero`) esta declarada «solo para pintar, nunca para calcular» y devuelve `null` en el
//    no finito — un `null` en el archivo se leeria como «no se sabe». Coste ACEPTADO y
//    declarado: en Excel con locale es-EC la columna puede llegar como texto y el usuario tiene
//    que convertirla; a cambio el mismo control ofrece XLSX (R25).
//  - **No decide nada por el id de la metrica** (R14). La forma del importe la decide la `forma`
//    del DTO, y el «saldo al corte» lo decide `esAcumulado` de su cabecera.
//  - **No escribe un codigo de moneda ni un simbolo** (R17): la moneda sale del propio importe.
//  - **No nombra los valores de la granularidad**: `grano` se copia tal cual del DTO, para no
//    crear un segundo hablante del vocabulario que el censo (g) del guardia del tablero
//    centraliza en `adaptar.ts`.
//
// ══════════════════════════════════════════════════════════════════════════════════════════
// AVISO PARA QUIEN PASE POR AQUI — `limitacion_conocida` NO ES UN DESCUIDO, NO LA BORRES.
//
// Es la **UNICA celda del archivo cuyo texto no sale del DTO**, y esta puesta A PROPOSITO por
// la decision **D3** (humana, 2026-08-08). Roza R11, y por eso R11 la nombra como **excepcion
// NOMBRADA Y UNICA** y su test comprueba que no aparezca una segunda: la exencion es de una
// celda, no una puerta abierta.
//
// Existe porque Q2 de la feature 180 decidio —y sigue vigente— que el servicio **no marca** el
// cubo en curso: marcarlo exigiria inyectarle un reloj y romper su determinismo (R26 de la
// 180). Con los presets vigentes el `hasta` es el inicio del dia siguiente, asi que el ultimo
// cubo casi siempre esta a medias y el DTO no lo dice. Sin esta columna, un archivo circula con
// su ultimo punto por debajo de la realidad y nada lo advierte.
//
// NO se estima, NO se convierte en un numero y NO se calcula en el cliente cual es el cubo en
// curso (R30): calcularlo aqui seria inventar la informacion que el servidor se nego a publicar
// **y** meter una segunda definicion del dia de Costa Rica en el navegador.
//
// Va en COLUMNA POR FILA y no en un bloque de cabecera, por la misma razon que D3 de la 134: la
// fila es lo unico de un fichero plano que sobrevive a filtrar, ordenar y copiar a otra hoja;
// una cabecera de metadatos rompe `read_csv` y desaparece en cuanto alguien reguarda desde
// Excel — justo el momento en que el archivo empieza a circular.
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// D4 — EL ARCHIVO NO DECLARA EL RANGO CONSULTADO. Sin columnas `desde`/`hasta`. No es ahorro:
// cuanta menos constante de contexto lleve un archivo que circula, menos superficie hay para
// que un dia alguien escriba ahi el ambito de quien descarga. Una columna constante de contexto
// es la primera piedra de una cabecera de metadatos.

import type { FilaFinanciera } from "@/lib/types/analitica-financiera";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

/* -------------------------------------------------------------------------- */
/* D3 / R30 — la limitacion DECLARADA, constante e identica en todas las filas */
/* -------------------------------------------------------------------------- */

/**
 * El texto CONSTANTE de la columna `limitacion_conocida`. Ver el aviso de la cabecera: es la
 * unica celda cuyo texto no sale del DTO, y esta ahi a proposito.
 *
 * Es la MISMA cadena en todas las filas del archivo. Si algun dia alguien la sustituyera por una
 * marca calculada por fila, el caso de R30 —que comprueba que todas las filas llevan el mismo
 * valor constante— se pone rojo.
 */
export const LIMITACION_ULTIMO_CUBO_EN_CURSO =
  "el ultimo cubo del rango puede estar en curso: el servicio no marca cual, y su importe puede subir despues de esta descarga";

/* -------------------------------------------------------------------------- */
/* R16 — el vocabulario cerrado de la columna `cifra`                          */
/* -------------------------------------------------------------------------- */

/** Movimiento DEL PERIODO: se puede sumar entre fechas. */
export const CIFRA_FLUJO = "flujo";

/**
 * SALDO AL CORTE: el acumulado a la fecha de cierre, no el movimiento del periodo. Sumar dos
 * filas de estas entre si cuenta el mismo dinero dos veces — y en un archivo que se abre seis
 * meses despues nadie tiene forma de distinguirlo si la columna no lo dice.
 */
export const CIFRA_SALDO_AL_CORTE = "saldo al corte";

/* -------------------------------------------------------------------------- */
/* El contrato de columnas (design §4.2)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Las OCHO columnas de una vista cuyos importes publican los DOS campos (R13).
 *
 * Toda celda procede de un campo del DTO salvo `limitacion_conocida` (R11 + D3).
 */
export const COLUMNAS_DESCARGA_ANALITICA_FINANCIERA: DescargaColumna[] = [
  // `fila.cubo`, LITERAL. No se traduce, no se acorta y NO se calcula el fin del cubo: el DTO
  // no lo publica, y el primero y el ultimo estan truncados al rango (⟨D4⟩ de la 186).
  { clave: "periodo", encabezado: "Periodo" },
  // R15 — la granularidad del cubo, copiada TAL CUAL del DTO. Sin esta columna una serie
  // semanal se lee como diaria y afirma siete veces mas dinero por punto.
  { clave: "grano", encabezado: "Grano" },
  // `datos.etiqueta`, la misma que rotula la seccion en pantalla.
  { clave: "metrica", encabezado: "Metrica" },
  // R18 — cadena de escala 2, tal cual llega. Sin `Number`, sin `toFixed`, sin separador.
  { clave: "bruto", encabezado: "Bruto" },
  { clave: "neto", encabezado: "Neto" },
  // R17 — del PROPIO importe. Ni un codigo ISO ni un simbolo escritos aqui.
  { clave: "moneda", encabezado: "Moneda" },
  // R16 — de `esAcumulado` del DTO, nunca de una lista de ids.
  { clave: "cifra", encabezado: "Tipo de cifra" },
  // D3 / R30 — la limitacion DECLARADA. Ver el aviso de la cabecera.
  { clave: "limitacion_conocida", encabezado: "Limitacion conocida" },
];

/**
 * Las SIETE columnas de una vista `solo_bruto` (R13): la de neto **NO EXISTE**, en vez de
 * existir vacia.
 *
 * Una celda ausente significa «no se sabe» (R15 de la 132) y aqui la verdad es **«no aplica»**
 * (R19/R23 de la 183). Un archivo que circula con una columna «Neto» vacia se lee como un dato
 * que se perdio.
 *
 * Se DERIVA del juego completo en vez de reescribirse: los dos comparten los mismos objetos de
 * columna, asi que no pueden divergir en encabezado ni en orden. Lo unico que las separa es
 * exactamente la columna que R13 manda quitar.
 */
export const COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO: DescargaColumna[] =
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.filter((columna) => columna.clave !== "neto");

/**
 * El contexto que una fila necesita y que NO esta en la fila: la etiqueta de la metrica, el
 * grano de su vista y si la metrica es un acumulado. Los tres salen del DTO.
 */
export interface ContextoExportFinanciero {
  /** `datos.etiqueta`: la del catalogo, la que rotula la seccion en pantalla. */
  readonly etiqueta: string;
  /** `vista.granularidad`: se copia, no se interpreta y no se nombra (R15). */
  readonly granularidad: string;
  /** `datos.esAcumulado`: del DTO y no de una lista de ids (R16). */
  readonly esAcumulado: boolean;
}

/**
 * Proyecta UNA fila del DTO a UNA fila del archivo. Es una FACTORIA
 * (`filaDescarga…(contexto)(fila)`) porque la fila necesita dos cosas: la fila y el contexto de
 * su vista.
 *
 * Lo que se lee, y nada mas: `fila.cubo`, `fila.importe.bruto`, `fila.importe.neto`,
 * `fila.importe.moneda` y los tres campos del contexto. Ni un id, ni una URL, ni una ruta.
 *
 * La clave `neto` NO se escribe donde el importe no la publica: ni en `null`, ni en cadena
 * vacia, ni derivada del bruto (R13). El juego de columnas del archivo se elige aparte, por la
 * misma FORMA (`columnasDeVistaFinanciera`), que es lo que hace que columna y celda no puedan
 * desincronizarse.
 */
export function filaDescargaAnaliticaFinanciera(
  contexto: ContextoExportFinanciero,
): (fila: FilaFinanciera) => DescargaFila {
  return (fila: FilaFinanciera): DescargaFila => ({
    periodo: fila.cubo,
    grano: contexto.granularidad,
    metrica: contexto.etiqueta,
    bruto: fila.importe.bruto,
    ...(fila.importe.forma === "bruto_y_neto" ? { neto: fila.importe.neto } : {}),
    moneda: fila.importe.moneda,
    cifra: contexto.esAcumulado ? CIFRA_SALDO_AL_CORTE : CIFRA_FLUJO,
    limitacion_conocida: LIMITACION_ULTIMO_CUBO_EN_CURSO,
  });
}
