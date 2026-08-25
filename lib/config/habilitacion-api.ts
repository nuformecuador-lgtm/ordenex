// Feature 266 (D2, design §3.2) — topes del endpoint de HABILITACION POR LOTE del canal por API
// key (`POST /api/ordenes/api-key/habilitar`).

/**
 * **Tope de filas por lote: 100** (D2, firmada por el humano el 2026-08-23).
 *
 * Lo aplica el ENVOLTORIO del cuerpo (zod, 422 global, R6) antes de procesar ninguna fila.
 *
 * **NO se reusa `cargaMasivaConfig.MAX_CHUNK_ROWS`**, aunque el numero coincida hoy: aquel
 * dimensiona UN insert masivo y este dimensiona N transacciones cortas independientes —el lote se
 * recorre secuencialmente, una transaccion por fila—. Compartir la constante ataria dos
 * presupuestos que no tienen nada que ver, y el dia que uno se ajuste el otro se moveria solo.
 *
 * **Sin palanca de entorno, a diferencia del resto de `lib/config/`**, y es deliberado: el numero
 * es parte del CONTRATO PUBLICO —el OpenAPI del canal se lo promete al integrador por escrito
 * (R28)— y una variable de entorno lo dejaria diciendo una cosa en el documento y otra en
 * produccion, sin que nada rompiera. Cambiarlo es cambiar el contrato, y eso cuesta un commit que
 * toque las dos mitades a la vez.
 */
export const TOPE_FILAS_HABILITAR = 100;

/** Tope de la `nota` de cada fila (R7). El MISMO de `orden_nota.cuerpo`, y por eso no se inventa otro. */
export const TOPE_CARACTERES_NOTA_HABILITAR = 200;
