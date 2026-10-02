/**
 * Ficha 468 (design §5, R22) — el UNICO punto de la app donde el texto de un importe del servidor se
 * convierte en un numero de Excel.
 *
 * Por que existe: un libro de la wallet con los montos como TEXTO no se puede sumar ni filtrar en
 * Excel (lo pidio el humano el 2026-10-02). La 170 decidio «montos como texto» para no perder un
 * centimo en la conversion; esta funcion revierte esa decision SOLO para las columnas que la piden
 * (`formato: "monto"`) y sin perder el centimo, porque lo MIDE en cada celda en vez de suponerlo:
 *
 *  1. si el texto no tiene la forma de un importe escala 2 del servidor (`-?d{1,13}.dd`), se devuelve
 *     el TEXTO tal cual: nunca un numero inventado a partir de algo que no es un importe;
 *  2. se convierte y se COMPRUEBA LA VUELTA: si el numero, escrito con dos decimales, no es
 *     exactamente el texto de entrada, se devuelve el texto.
 *
 * Un `Decimal(12,2)` tiene como mucho 12 cifras significativas y un `double` representa sin perdida 15,
 * asi que con datos reales la comprobacion nunca falla. Existe para que la exactitud sea una propiedad
 * medida en cada celda, no una suposicion.
 *
 * El `Number(` vive AQUI y solo aqui (guardia `xlsx-monto-unico.guardia.test.ts`). No hay aritmetica:
 * el numero no se suma, no se resta ni se redondea; se entrega a Excel tal cual.
 */

/** Forma de un importe escala 2 tal como lo serializa el servidor (`Prisma.Decimal#toFixed(2)`). */
const IMPORTE_ESCALA_2 = /^-?\d{1,13}\.\d{2}$/;

/** Formato de celda de Excel para las columnas de monto: dos decimales y separador de miles. */
export const FORMATO_EXCEL_MONTO = "#,##0.00";

/**
 * El valor de celda de un importe: un `number` exacto si la vuelta lo confirma; si no, el texto.
 * Celda vacia (`null`) se queda vacia.
 */
export function celdaMonto(texto: string | null): number | string | null {
  if (texto === null) return null;
  if (!IMPORTE_ESCALA_2.test(texto)) return texto;
  // La unica conversion de importe a numero de la ruta de descarga (ver cabecera del modulo).
  const n = Number(texto);
  return n.toFixed(2) === texto ? n : texto;
}
