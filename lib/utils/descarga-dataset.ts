/**
 * Feature 151 (design.md §3) — FUNCION COMUN de descarga: dado `{tipo, titulo,
 * columnas, filas}` produce el contenido del archivo, su MIME y su nombre (R1, R7).
 *
 * Modulo DELIBERADAMENTE ciego al dominio: no importa `lib/actions`, `lib/services`,
 * `lib/types/orden` ni nada de `app/`. Tampoco toca el DOM ni React (R10): el side
 * effect de entregar el archivo vive en `components/shared/descargar-blob.ts` y el
 * binario se arma en el NAVEGADOR (design.md §1), nunca en el servidor.
 *
 * Es un DESPACHADOR delgado: el trabajo real lo hacen los generadores que ya existian
 * (`buildXlsxRows`, `buildCsvRows`), y de ellos hereda R5 (solo las columnas declaradas,
 * en su orden) y R6 (valor ausente -> celda vacia). `exceljs` NO se importa aqui: su
 * import dinamico sigue viviendo dentro de `buildXlsxRows`.
 */
import type {
  DescargaArchivo,
  DescargaColumna,
  DescargaConfig,
  DescargaTipo,
} from "@/lib/types/descarga";
import { buildCsvRows } from "@/lib/utils/csv-template";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { buildXlsxLibro, buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";

/** MIME del CSV con codificacion explicita, para el `Blob` de descarga (R7). */
export const CSV_MIME = "text/csv;charset=utf-8";

/** Tipo aplicado cuando la configuracion no declara ninguno (R2). */
const TIPO_POR_DEFECTO: DescargaTipo = "xlsx";

/** Base del nombre de archivo cuando el titulo no deja ningun caracter utilizable. */
const SLUG_FALLBACK = "descarga";

/** Rango de marcas diacriticas combinantes que NFD separa de su letra base. */
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Slug del titulo para el nombre de archivo: sin diacriticos, en minusculas y con
 * todo lo que no sea `[a-z0-9]` colapsado a "-". Se implementa aqui, y no se reusa
 * `slugify` de `api-key-identity`, porque aquel deriva identidades sinteticas y su
 * contrato (poder devolver "" y que el borde lo traduzca a error) no es este: aqui
 * un titulo raro debe producir un nombre de archivo valido, no un fallo.
 */
function slugTitulo(titulo: string): string {
  const slug = titulo
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? SLUG_FALLBACK : slug;
}

// ---------------------------------------------------------------------------
// Nombre de la HOJA (feature 170, T G.1)
// ---------------------------------------------------------------------------

/**
 * Reglas que `exceljs` impone al nombre de una hoja (verificadas en
 * `exceljs/lib/doc/worksheet.js`, v4.4.0):
 *
 *  - LANZA si contiene `* ? : \ / [ ]`;
 *  - LANZA si empieza o termina con comilla simple;
 *  - LANZA si es exactamente `History` (nombre reservado de Excel);
 *  - AVISA por consola y TRUNCA a 31 caracteres si se pasa de largo.
 *
 * Hasta la 170 el `titulo` del listado viajaba tal cual. Con títulos fijos («Órdenes»,
 * «Usuarios») daba igual, pero el rollout introdujo títulos COMPUESTOS CON DATOS —
 * `Desglose de <mensajero>`, `<Resultado> · <mensajero>`— y ahí las dos primeras reglas
 * dejan de ser teóricas: un nombre con una barra convertiría la descarga en «no se pudo
 * generar el archivo», sin archivo y sin explicación útil.
 *
 * Se sanea AQUÍ, en la función común, y no en el contrato del `DataTable`: el nombre de la
 * hoja es un detalle del `xlsx` que este módulo ya posee (igual que posee el slug del
 * nombre de archivo). El `titulo` que declara cada tabla sigue intacto — es el nombre
 * accesible del control y la base del nombre del archivo, y NO se recorta.
 */
const CARACTERES_PROHIBIDOS_HOJA = /[*?:/\\[\]]/g;

/** Máximo de caracteres del nombre de una hoja en Excel. */
const MAX_NOMBRE_HOJA = 31;

/** Nombre reservado por Excel que `exceljs` rechaza. */
const NOMBRE_HOJA_RESERVADO = "History";

/** Base del nombre de hoja cuando el título no deja nada utilizable. */
const HOJA_FALLBACK = "Datos";

/**
 * Nombre de hoja válido y ESTABLE a partir del título del listado.
 *
 * El recorte se marca con «…» en vez de cortar en seco: una pestaña que termina a mitad de
 * palabra parece un archivo corrupto; una que termina en puntos suspensivos dice lo que es.
 * No se retrocede hasta el espacio anterior a propósito — sacrificaría hasta una palabra
 * entera de un nombre propio para ganar estética en una etiqueta, y como cada archivo lleva
 * UNA sola hoja, no hay dos pestañas que distinguir entre sí.
 */
export function nombreHoja(titulo: string): string {
  const saneado = titulo
    .replace(CARACTERES_PROHIBIDOS_HOJA, "-")
    .replace(/^'+|'+$/g, "")
    .trim();

  if (saneado === "" || saneado === NOMBRE_HOJA_RESERVADO) return HOJA_FALLBACK;
  if (saneado.length <= MAX_NOMBRE_HOJA) return saneado;

  return `${saneado.slice(0, MAX_NOMBRE_HOJA - 1).trimEnd()}…`;
}

/**
 * Ficha 464 (design §2.1, R42) — nombres de hoja DISTINTOS entre si, para un libro de varias hojas.
 *
 * Excel compara los nombres de hoja SIN distinguir mayusculas (y `exceljs` lanza con un duplicado),
 * asi que «Detalle» y «detalle» chocan. El primero que llega conserva su nombre; cada repeticion
 * gana « (2)», « (3)»… y, si con el sufijo se pasaria de 31 caracteres, la base se recorta con «…»
 * ANTES del sufijo (el sufijo es justo lo que distingue a las dos pestañas, no se puede perder).
 *
 * Recibe nombres YA saneados por `nombreHoja`. Con un solo nombre es la identidad: el archivo de
 * una hoja no cambia (R41).
 */
export function nombresDeHojaUnicos(nombres: readonly string[]): string[] {
  const usados = new Set<string>();
  return nombres.map((nombre) => {
    let candidato = nombre;
    for (let n = 2; usados.has(candidato.toLowerCase()); n += 1) {
      const sufijo = ` (${n})`;
      candidato =
        nombre.length + sufijo.length <= MAX_NOMBRE_HOJA
          ? `${nombre}${sufijo}`
          : `${nombre.slice(0, MAX_NOMBRE_HOJA - sufijo.length - 1).trimEnd()}…${sufijo}`;
    }
    usados.add(candidato.toLowerCase());
    return candidato;
  });
}

/**
 * Nombre del archivo (R7, R8): `<slug del titulo>-YYYY-MM-DD.<extension>`. La fecha
 * llega por parametro para ser determinista en test, mismo patron que
 * `nombreArchivoErrores` (feature 143) y `manifiestoFileName` (feature 148).
 *
 * La fecha es el DIA CALENDARIO EN COSTA RICA de ese instante (`fechaCalendarioCR`), no el del
 * reloj del navegador: el recorrido de la 457 (observacion O3) midio un navegador en UTC−5 que a
 * las 23:xx de CR ya nombraba el archivo con el dia siguiente, mientras la columna Fecha de dentro
 * salia en hora de CR. El nombre y el contenido hablan ahora del mismo dia.
 */
export function nombreArchivoDescarga(
  titulo: string,
  tipo: DescargaTipo,
  fecha: Date,
): string {
  return `${slugTitulo(titulo)}-${fechaCalendarioCR(fecha)}.${tipo}`;
}

/**
 * Construye el contenido de una descarga de listado.
 *
 * - `tipo` ausente -> `xlsx` (R2).
 * - `xlsx` -> libro de UNA hoja nombrada con el titulo (saneado por `nombreHoja`, que
 *   respeta las reglas de Excel), cabecera + una fila por elemento en el orden
 *   recibido (R3, R8). Ficha 464: con `hojasAdicionales`, esas hojas siguen a la
 *   principal, en su orden y con nombres distintos (`nombresDeHojaUnicos`).
 * - `csv` -> texto con una linea de cabecera y una por elemento, todo escapado (R4).
 * - Se emiten EXACTAMENTE las columnas declaradas, en su orden (R5); una fila que no
 *   aporta la clave deja la celda vacia (R6).
 *
 * @throws si `columnas` esta vacio: no se produce archivo alguno (R9), mismo contrato
 * defensivo que `buildXlsxTemplate`/`buildXlsxRows`/`buildCsvRows`. Ficha 464: tambien
 * con `csv` + hojas adicionales (R12) y con una hoja adicional sin columnas.
 */
export async function construirDescarga(
  config: DescargaConfig,
  fecha: Date = new Date(),
): Promise<DescargaArchivo> {
  const { titulo, columnas, filas } = config;
  const hojasAdicionales = config.hojasAdicionales ?? [];

  if (columnas.length === 0) {
    throw new Error(
      "construirDescarga: se requiere al menos una columna para generar el archivo",
    );
  }

  const tipo = config.tipo ?? TIPO_POR_DEFECTO;
  // Ficha 464 (R12): un csv no tiene hojas. Pedir hojas adicionales en csv es un error del
  // consumidor y NO produce archivo: antes que un csv al que le falta la mitad del contenido.
  if (tipo === "csv" && hojasAdicionales.length > 0) {
    throw new Error(
      "construirDescarga: las hojas adicionales solo existen en xlsx; un csv no puede llevarlas",
    );
  }
  const nombreArchivo = nombreArchivoDescarga(titulo, tipo, fecha);
  // Traduccion del vocabulario del contrato (clave/encabezado) al de los generadores
  // reusados (key/header). Es lo UNICO que este despachador aporta sobre ellos.
  // Ficha 468 (R22): `formato` viaja SOLO si la columna lo declara; sin el, la columna del generador es
  // exactamente la de siempre (R59). El csv no lo mira (R58).
  const aColumnaGenerador = (columna: DescargaColumna) => ({
    key: columna.clave,
    header: columna.encabezado,
    ...(columna.formato !== undefined ? { formato: columna.formato } : {}),
  });
  const columnasGenerador = columnas.map(aColumnaGenerador);

  if (tipo === "csv") {
    return {
      contenido: buildCsvRows(columnasGenerador, filas),
      mime: CSV_MIME,
      nombreArchivo,
    };
  }

  if (hojasAdicionales.length === 0) {
    return {
      // El nombre de la HOJA se sanea (ver `nombreHoja`); el del ARCHIVO conserva el slug
      // del titulo entero, que es donde el usuario reconoce lo que descargo.
      // Ficha 464 (R41): sin hojas adicionales, EXACTAMENTE el camino de siempre.
      contenido: await buildXlsxRows(columnasGenerador, filas, nombreHoja(titulo), config.filasDestacadas),
      mime: XLSX_MIME,
      nombreArchivo,
    };
  }

  // Ficha 464 (R10/R42): la principal primero y las adicionales despues, con nombres validos y
  // distintos. Una hoja adicional sin columnas no produce archivo (mismo contrato que la principal).
  for (const hoja of hojasAdicionales) {
    if (hoja.columnas.length === 0) {
      throw new Error(
        "construirDescarga: cada hoja adicional necesita al menos una columna",
      );
    }
  }
  const nombres = nombresDeHojaUnicos([
    nombreHoja(titulo),
    ...hojasAdicionales.map((hoja) => nombreHoja(hoja.titulo)),
  ]);
  return {
    contenido: await buildXlsxLibro([
      {
        nombre: nombres[0],
        columns: columnasGenerador,
        rows: filas,
        ...(config.filasDestacadas !== undefined ? { destacadas: config.filasDestacadas } : {}),
      },
      ...hojasAdicionales.map((hoja, i) => ({
        nombre: nombres[i + 1],
        columns: hoja.columnas.map(aColumnaGenerador),
        rows: hoja.filas,
        ...(hoja.filasDestacadas !== undefined ? { destacadas: hoja.filasDestacadas } : {}),
      })),
    ]),
    mime: XLSX_MIME,
    nombreArchivo,
  };
}
