// Ficha 470 (design §3.4/§4.1) — el SOBRE con el que `prepararDescargaAction` entrega el resultado de
// una accion de descarga al navegador. Vive SOLO entre esa accion y `descargarDatos` (cliente): las
// acciones de descarga registradas no cambian su tipo de retorno.
//
// Modulo de TIPOS: sin dependencias (se importa desde servidor y cliente).

/**
 * - `directo`: el resultado de la accion tal cual (el MISMO objeto que devolveria hoy), porque su
 *   serializacion no supera el umbral de entrega (R6).
 * - `almacen`: el resultado se dejo como objeto temporal (`tmp/<uuid>.json.gz`, gzip de
 *   `serializarDescarga`) en el bucket privado; `url` es la URL firmada para leerlo una vez (R5/R10).
 */
export type ResultadoPreparado<R> = { modo: "directo"; resultado: R } | { modo: "almacen"; url: string };
