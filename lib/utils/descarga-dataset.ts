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
 * - `xlsx` -> libro de UNA hoja nombrada con el titulo, cabecera + una fila por
 *   elemento en el orden recibido (R3, R8).
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
    contenido: await buildXlsxRows(columnasGenerador, filas, titulo),
    mime: XLSX_MIME,
    nombreArchivo,
  };
}
