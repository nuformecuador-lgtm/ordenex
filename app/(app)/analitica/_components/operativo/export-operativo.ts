// Feature 134 (T2.1, design §4.2) — LA PROYECCION del export operativo: de `SerieOperativa`
// a las filas del contrato de descarga de la 151.
//
// Modulo PURO: sin React, sin DOM, sin servicio, sin repositorio, sin Prisma y sin catalogo
// de servidor. Toma lo que la Server Action ya devolvio y lo pone en filas. No consulta
// nada, no resuelve ningun id a un nombre y no vuelve a mirar la sesion.
//
// LO QUE ESTE MODULO NO HACE, Y ES DELIBERADO:
//
//  - **No aplica la politica de identidad.** Ya la aplico el SERVICIO
//    (`AnaliticaOperativaService`), antes de devolver, y su comentario declara por que:
//    hacerlo alli es estrictamente mas fuerte, porque el uuid real no cruza siquiera la
//    frontera servicio→borde y ningun borde futuro —esta feature, textualmente— puede
//    olvidarla. Aqui `punto.dimension` llega YA como etiqueta ordinal cuando la politica lo
//    exige (`lib/types/analitica-operativa.ts:87`), y se escribe TAL CUAL. Rehacer ese paso
//    aqui ademas pondria rojo el guardia R10 de la 131.
//  - **No resuelve ids a identidades.** Ni nombres, ni correos, ni telefonos, ni un hash o
//    prefijo del id (R7/R9): una columna asi seria un mapa de vuelta hacia la persona dentro
//    de un archivo que circula.
//  - **No inventa ni descarta filas.** Una fila por punto, en el orden recibido (R10). Un
//    `valor: null` se escribe como CELDA VACIA, jamas como `0` (R11): un cero es un dato de
//    negocio y `null` es «no se sabe».
//
// D3 — LA COBERTURA Y EL DIA PARCIAL VIAJAN EN COLUMNAS POR FILA, no en un bloque de
// cabecera. La fila es lo unico de un fichero plano que sobrevive a filtrar, ordenar y
// copiar a otra hoja; una cabecera de metadatos rompe `read_csv` y desaparece en cuanto
// alguien reguarda desde Excel — que es justo el momento en que el archivo empieza a
// circular.
//
// D4 — NO HAY CABECERA DE METADATOS. La fecha ya viaja en el nombre del archivo
// (`nombreArchivoDescarga`). Y el motivo importa mas que la decision: escribir ahi el
// `tiendaId`/`zonaId` del actor como «alcance» meteria en un archivo que circula justo la
// clase de identificador que R8/R9 quieren fuera de el.

import type { SerieOperativa } from "@/lib/types/analitica-operativa";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

/* -------------------------------------------------------------------------- */
/* D3 — el vocabulario cerrado de la columna `cobertura`                       */
/* -------------------------------------------------------------------------- */

/** El dia esta cerrado y por encima del horizonte del historial: la cifra es comparable. */
export const COBERTURA_COMPLETO = "completo";

/** El dia EN CURSO: la cifra no ha cerrado y lleva su `corte_at` en la misma fila (R13). */
export const COBERTURA_PARCIAL = "parcial";

/**
 * La fecha cae bajo el horizonte del historial (R14). Sin esta marca, un cero por falta de
 * rollup se descarga como un cero de negocio — y en un archivo que se abre seis meses
 * despues nadie tiene forma de distinguirlos.
 */
export const COBERTURA_NO_COMPARABLE = "no_comparable";

/* -------------------------------------------------------------------------- */
/* El contrato de columnas (design §4.2)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Las OCHO columnas del archivo, en su orden. Toda celda procede de un campo de
 * `SerieOperativa`: no hay ni una que exija consultar nada mas (R7).
 */
export const COLUMNAS_EXPORT_OPERATIVO: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "metrica", encabezado: "Metrica" },
  // Vacia si la serie no esta desagregada. Llega ya etiquetada por el servicio (R8).
  { clave: "dimension", encabezado: "Desglose" },
  // `null` => CELDA VACIA (R11). Nunca `0`, nunca "null", nunca "-".
  { clave: "valor", encabezado: "Valor" },
  // R12 — sin esto una tasa se lee como un conteo, y nada en el archivo lo desmiente.
  { clave: "unidad", encabezado: "Unidad" },
  // D3/R13/R14 — completo | parcial | no_comparable.
  { clave: "cobertura", encabezado: "Cobertura" },
  // R13 — solo con `parcial`: a que hora se corto el dia en curso.
  { clave: "corte_at", encabezado: "Corte" },
  // R15 — la limitacion PERMANENTE, declarada, jamas estimada ni convertida en numero.
  { clave: "limitacion_conocida", encabezado: "Limitacion conocida" },
];

/**
 * Una metrica del panel con su serie. Misma forma que `FuenteSerie` de `agregacion.ts`
 * —la etiqueta la declara el catalogo de paneles— para que el archivo diga de la metrica
 * exactamente lo mismo que la leyenda de la grafica.
 */
export interface FuenteExport {
  readonly etiqueta: string;
  readonly serie: SerieOperativa;
}

/**
 * D3 — la cobertura de UNA fila. `parcial` manda sobre `no_comparable`: el dia en curso no
 * puede estar bajo el horizonte del historial, y si algun dia lo estuviera, lo que el lector
 * necesita saber primero es que la cifra aun no ha cerrado.
 */
function coberturaDeFila(
  fecha: string,
  parcial: true | undefined,
  noComparables: ReadonlySet<string>,
): string {
  if (parcial === true) return COBERTURA_PARCIAL;
  if (noComparables.has(fecha)) return COBERTURA_NO_COMPARABLE;
  return COBERTURA_COMPLETO;
}

/**
 * D6 — un archivo POR PANEL: estas fuentes son las metricas de UN panel, con el mismo grano
 * que la grafica que el usuario esta mirando. Un archivo unico del tablero mezclaria
 * `conteo`, `porcentaje` y `segundos` en una sola hoja.
 *
 * R10 — una fila por punto, en el orden recibido: ni se filtra, ni se rellena, ni se
 * reordena. Ni una fila de mas ni una de menos que las que pinta el panel.
 */
export function filasDeSerie(fuentes: readonly FuenteExport[]): DescargaFila[] {
  return fuentes.flatMap(({ etiqueta, serie }) => {
    const noComparables = new Set(serie.cobertura.fechasNoComparables);
    return serie.puntos.map((punto): DescargaFila => {
      return {
        fecha: punto.fecha,
        metrica: etiqueta,
        // TAL CUAL llega del borde. Sin resolver, sin decorar, sin sufijos derivados.
        dimension: punto.dimension ?? null,
        // R11 — el `null` viaja como `null` y el generador comun lo escribe como celda
        // vacia. Un `?? 0` aqui convertiria «no se sabe» en «cero» dentro del archivo.
        valor: punto.valor,
        unidad: serie.unidad,
        cobertura: coberturaDeFila(punto.fecha, punto.parcial, noComparables),
        corte_at: punto.corteAt ?? null,
        // R15 — se DECLARA, no se estima. Es la constante `PENUMBRA` que trae la respuesta.
        limitacion_conocida: serie.cobertura.penumbra,
      };
    });
  });
}
