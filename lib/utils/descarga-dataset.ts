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
  DescargaConfig,
  DescargaTipo,
} from "@/lib/types/descarga";
import { buildCsvRows } from "@/lib/utils/csv-template";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";

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

/** Cero-rellena a 2 digitos (componentes locales de la fecha). */
function dos(valor: number): string {
  return String(valor).padStart(2, "0");
}

/** `YYYY-MM-DD` con los componentes LOCALES de la fecha recibida. */
function fechaISO(fecha: Date): string {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/**
 * Nombre del archivo (R7, R8): `<slug del titulo>-YYYY-MM-DD.<extension>`. La fecha
 * llega por parametro para ser determinista en test, mismo patron que
 * `nombreArchivoErrores` (feature 143) y `manifiestoFileName` (feature 148).
 */
export function nombreArchivoDescarga(
  titulo: string,
  tipo: DescargaTipo,
  fecha: Date,
): string {
  return `${slugTitulo(titulo)}-${fechaISO(fecha)}.${tipo}`;
}

/**
 * Construye el contenido de una descarga de listado.
 *
 * - `tipo` ausente -> `xlsx` (R2).
 * - `xlsx` -> libro de UNA hoja nombrada con el titulo (saneado por `nombreHoja`, que
 *   respeta las reglas de Excel), cabecera + una fila por elemento en el orden
 *   recibido (R3, R8).
 * - `csv` -> texto con una linea de cabecera y una por elemento, todo escapado (R4).
 * - Se emiten EXACTAMENTE las columnas declaradas, en su orden (R5); una fila que no
 *   aporta la clave deja la celda vacia (R6).
 *
 * @throws si `columnas` esta vacio: no se produce archivo alguno (R9), mismo contrato
 * defensivo que `buildXlsxTemplate`/`buildXlsxRows`/`buildCsvRows`.
 */
export async function construirDescarga(
  config: DescargaConfig,
  fecha: Date = new Date(),
): Promise<DescargaArchivo> {
  const { titulo, columnas, filas } = config;

  if (columnas.length === 0) {
    throw new Error(
      "construirDescarga: se requiere al menos una columna para generar el archivo",
    );
  }

  const tipo = config.tipo ?? TIPO_POR_DEFECTO;
  const nombreArchivo = nombreArchivoDescarga(titulo, tipo, fecha);
  // Traduccion del vocabulario del contrato (clave/encabezado) al de los generadores
  // reusados (key/header). Es lo UNICO que este despachador aporta sobre ellos.
  const columnasGenerador = columnas.map((columna) => ({
    key: columna.clave,
    header: columna.encabezado,
  }));

  if (tipo === "csv") {
    return {
      contenido: buildCsvRows(columnasGenerador, filas),
      mime: CSV_MIME,
      nombreArchivo,
    };
  }

  return {
    // El nombre de la HOJA se sanea (ver `nombreHoja`); el del ARCHIVO conserva el slug
    // del titulo entero, que es donde el usuario reconoce lo que descargo.
    contenido: await buildXlsxRows(columnasGenerador, filas, nombreHoja(titulo)),
    mime: XLSX_MIME,
    nombreArchivo,
  };
}
