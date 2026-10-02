// Feature 151 (design.md §3) — contrato de la descarga de un dataset de listado.
//
// Modulo DELIBERADAMENTE puro: no importa React, Prisma, `lib/services`, `lib/actions`
// ni nada de `app/`. Lo consumen por igual el generador comun (`lib/utils`), el control
// del `DataTable` (cliente) y las columnas de export de cada consumidor, asi que
// cualquier dependencia de dominio aqui arrastraria el dominio a las ~30 tablas de la
// app (D1/D5).

/** Formatos soportados por la descarga (R2/R3/R4). */
export type DescargaTipo = "xlsx" | "csv";

/**
 * Celda de export: valor CRUDO. Espejo deliberado de `XlsxCellValue` (D5): una hoja de
 * calculo no admite `ReactNode`. `null` = celda vacia (R6).
 */
export type DescargaCelda = string | number | null;

/** Columna de export, declarada APARTE de `Column<T>` del DataTable (D5). */
export interface DescargaColumna {
  clave: string;
  encabezado: string;
}

/** Fila del dataset, indexada por la `clave` de las columnas declaradas. */
export type DescargaFila = Record<string, DescargaCelda>;

/**
 * Ficha 464 (design §2.1) — una hoja MAS del libro: nombre, columnas y filas. Mismo vocabulario que
 * la hoja principal y la misma ceguera al dominio: el generador no sabe que es un «detalle».
 */
export interface DescargaHoja {
  /** Nombre de la hoja; se sanea igual que el de la principal (`nombreHoja`). */
  titulo: string;
  /** Se emiten EXACTAMENTE estas columnas, en este orden. Vacio => error, sin archivo. */
  columnas: DescargaColumna[];
  filas: DescargaFila[];
}

/** Unico insumo del generador comun: sin filtros, sin roles, sin dominio (R1). */
export interface DescargaConfig {
  /** R2: ausente => "xlsx". */
  tipo?: DescargaTipo;
  /** R8: nombre de la hoja (xlsx) y base del nombre de archivo (todo tipo). */
  titulo: string;
  /** R5/R9: se emiten EXACTAMENTE estas columnas, en este orden. Vacio => error. */
  columnas: DescargaColumna[];
  filas: DescargaFila[];
  /**
   * Ficha 464 (R10/R12/R41/R42) — hojas que siguen a la principal, en este orden. SOLO xlsx: con
   * `tipo: "csv"` y alguna hoja, el generador lanza y no produce archivo (un csv no tiene hojas).
   * Ausente o vacio => el MISMO archivo de siempre: una hoja (R41).
   */
  hojasAdicionales?: DescargaHoja[];
}

/** Salida del generador comun: contenido + como entregarlo (R7). */
export interface DescargaArchivo {
  contenido: ArrayBuffer | string;
  mime: string;
  nombreArchivo: string;
}
