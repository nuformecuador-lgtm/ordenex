/**
 * FICHA 458-D (T D.6, design §3.2; R3, R32) — columnas de EXPORT del estado de cuenta de una tienda, un
 * mensajero o una bodega satélite.
 *
 * Módulo PURO (sin React ni DOM). El archivo lleva LAS MISMAS columnas que se ven, incluido el SALDO
 * CORRIDO y la fila del SALDO INICIAL arriba (R32), y ninguna columna de identificador (R3): la fila
 * del servidor lleva `ref` y `consolidacionId`, que viajan y nunca se pintan ni se descargan. Por eso
 * la proyección NO lee el DTO del servidor: lee la `LineaEstadoCuenta`, que es la fila ya rotulada con
 * los diccionarios de la superficie (la misma que pinta la tabla), así que la celda y la columna del
 * archivo no pueden decir cosas distintas.
 *
 * MONEY-SAFE: cargo, abono y saldo salen como el STRING que devolvió el servidor, TAL CUAL (sin símbolo,
 * sin parseo), para que la hoja los pueda sumar.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

/** Una línea del extracto tal como se ve: la del saldo inicial o la de un movimiento. */
export interface LineaEstadoCuenta {
  fecha: string;
  movimiento: string;
  motivo: string | null;
  origen: string | null;
  /** FICHA 458-D — el método y la referencia del pago de la fila, en palabras; `null` si no es un pago. */
  pago: string | null;
  registro: string | null;
  cargo: string | null;
  abono: string | null;
  saldo: string;
  /** «Anulado el … por … · motivo», «Anulación», o `null` si está vigente. */
  estado: string | null;
}

/** Columnas del archivo, en el orden de la pantalla. */
export const COLUMNAS_DESCARGA_ESTADO_CUENTA: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "movimiento", encabezado: "Movimiento" },
  { clave: "motivo", encabezado: "Motivo" },
  { clave: "origen", encabezado: "Origen" },
  { clave: "pago", encabezado: "Cómo se pagó" },
  { clave: "registro", encabezado: "Registró" },
  { clave: "cargo", encabezado: "Cargo" },
  { clave: "abono", encabezado: "Abono" },
  { clave: "saldo", encabezado: "Saldo" },
  { clave: "estado", encabezado: "Estado" },
];

/**
 * FICHA 458-D (R34/R35) — las columnas del archivo de `/mi-wallet`: las mismas SIN «Registró» (la
 * tienda no ve los nombres de la gente de Ordenex: el servidor no los manda y la pantalla no pinta esa
 * línea).
 */
export const COLUMNAS_DESCARGA_MI_ESTADO_CUENTA: DescargaColumna[] = COLUMNAS_DESCARGA_ESTADO_CUENTA.filter(
  (c) => c.clave !== "registro",
);

/**
 * FICHA 464 (R1/R2) — el ámbito del selector de columnas de la hoja de movimientos de CADA estado de
 * cuenta: uno por superficie, aunque compartan catálogo, para que ocultar una columna en el de una
 * tienda no la oculte en el de un mensajero. Se ASIGNAN en el módulo de cada superficie.
 */
export const AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA = "wallet-tienda-estado-cuenta";
export const AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO = "wallet-mensajero-estado-cuenta";
export const AMBITO_DESCARGA_ESTADO_CUENTA_SATELITE = "wallet-satelite-estado-cuenta";
export const AMBITO_DESCARGA_MI_ESTADO_CUENTA = "mi-wallet-estado-cuenta";

/** Proyecta UNA línea del extracto a una fila de export con valores crudos. */
export function filaDescargaEstadoCuenta(linea: LineaEstadoCuenta): DescargaFila {
  return {
    fecha: linea.fecha,
    movimiento: linea.movimiento,
    motivo: linea.motivo ?? null,
    origen: linea.origen ?? null,
    pago: linea.pago ?? null,
    registro: linea.registro ?? null,
    cargo: linea.cargo ?? null,
    abono: linea.abono ?? null,
    saldo: linea.saldo,
    estado: linea.estado ?? null,
  };
}
