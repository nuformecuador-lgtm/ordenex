/**
 * Ficha 470 (design §4.4, R2) — la guardia de Excel en el ARMADO del archivo.
 *
 * Excel admite 1.048.576 filas por hoja, cabecera incluida (`EXCEL_FILAS_DATOS_POR_HOJA` de datos).
 * Desde la 470 el servidor ya no corta en 5.000, así que el único máximo que queda es ese, y se
 * comprueba hoja por hoja ANTES de llamar a `exceljs`: un libro que no cabe no se arma (ni se gasta
 * memoria en él) y el control dice cuántas filas tendría y qué hacer.
 *
 * Módulo propio, sin dependencias de `exceljs`: el control de descarga lo importa estáticamente para
 * reconocer el error sin arrastrar el generador al bundle inicial (`construirDescarga` sigue con su
 * import dinámico).
 */
import { EXCEL_FILAS_DATOS_POR_HOJA } from "@/lib/config/descarga";

/** Una hoja vista por la guardia: su nombre visible y cuántas filas de datos llevaría. */
export interface HojaAContar {
  titulo: string;
  filas: { readonly length: number };
}

/** R2 — una hoja del archivo superaría el límite de Excel: no se produce archivo. */
export class LimiteExcelExcedidoError extends Error {
  readonly hoja: string;
  readonly filas: number;
  readonly limite: number;

  constructor(hoja: string, filas: number, limite: number = EXCEL_FILAS_DATOS_POR_HOJA) {
    super(`la hoja «${hoja}» tendría ${filas} filas; Excel admite hasta ${limite}`);
    this.name = "LimiteExcelExcedidoError";
    this.hoja = hoja;
    this.filas = filas;
    this.limite = limite;
  }
}

/**
 * R2 — comprueba cada hoja, en orden; la primera que pase de `EXCEL_FILAS_DATOS_POR_HOJA` lanza.
 * Exactamente el límite NO lanza. Solo cuenta: no mira ni copia las filas.
 */
export function comprobarLimiteExcel(hojas: readonly HojaAContar[]): void {
  for (const hoja of hojas) {
    if (hoja.filas.length > EXCEL_FILAS_DATOS_POR_HOJA) {
      throw new LimiteExcelExcedidoError(hoja.titulo, hoja.filas.length);
    }
  }
}
