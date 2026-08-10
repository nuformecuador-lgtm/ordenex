// Feature 127 (T A.4, ⟨D5⟩ / R40) — LA UNICA cifra configurable de la analitica financiera.
//
// ⚠️ PROVISIONAL Y NO MEDIDA. Nadie ha medido todavia el descuadre tipico entre los `total_*`
// snapshot de los cierres aprobados y lo que los ledgers registraron con origen en esos
// mismos cierres: el volumen de produccion es de decenas de movimientos (medido y anotado en
// `progress/current.md`) y no hay serie historica de la que sacar un umbral con procedencia.
// La cifra de abajo es un AVISO, no un limite: nada se rechaza, nada se trunca y nada se
// vacia por superarla. Solo decide a partir de que diferencia el descuadre deja rastro en el
// `ErrorLogger` ademas de viajar en el DTO ⟨D5⟩. Cuando exista medicion real, se sustituye
// aqui y en ningun otro sitio.
//
// R40, segunda mitad: esta constante vive SOLO en este archivo. Escribir el numero dentro de
// un servicio o de un repositorio pone rojo el censo de literales de umbral, y con razon:
// ajustarlo dejaria de ser un one-liner con su test para volverse una caceria de numeros
// sueltos por el arbol.
//
// STRING y no `number` (S1 / R27): el umbral se compara contra una diferencia de dinero, y
// esa comparacion se hace con `Prisma.Decimal`. Un `number` aqui obligaria a convertir en el
// punto exacto donde la conversion no se debe hacer.

/**
 * Diferencia absoluta, en la moneda configurada (`lib/config/moneda.ts`), a partir de la cual
 * un descuadre de conciliacion se emite ademas por el `ErrorLogger`.
 *
 * `"0.01"` = un centimo: hoy CUALQUIER descuadre se reporta, porque con el volumen actual un
 * descuadre real es una anomalia que interesa ver entera. El dia que haya ruido de fondo
 * medido, este es el numero que sube — y su justificacion se escribe aqui al lado.
 */
export const UMBRAL_AVISO_DESCUADRE_CONCILIACION = "0.01";

// Feature 187 (T2.2 / R10, Q3 cerrada por el humano el 2026-08-08) — LOS DOS TIEMPOS DE LA
// LECTURA CONSISTENTE.
//
// Desde la 187, las metricas de `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` piden su total y su
// desglose DENTRO de una transaccion `repeatable read`, para que las dos (o tres) consultas vean
// el mismo snapshot. Una transaccion interactiva de Prisma necesita dos limites de tiempo, y los
// dos viven AQUI y en ningun otro sitio: R10 prohibe escribir un numero de milisegundos dentro de
// `IngresosAnaliticaRepository` o de `CuentasPorPagarAnaliticaRepository`, y un censo de
// `tests/unit/analytics/financiera-lectura-consistente.test.ts` lo comprueba. Mismo precedente y
// misma forma que `TIMEOUT_TX_ROLLUP_MS` en `lib/config/analitica-rollup.ts`.
//
// ⚠️ CIFRAS ELEGIDAS, NO MEDIDAS. Se dice con estas palabras a proposito (precedente: lo que costo
// no decirlo en la ficha 174). En `docs/`, en `specs/` y en el codigo no hay NI UNA medicion de
// cuanto tardan estas agregaciones contra un ledger real, asi que no se finge una. Lo que si hay
// son dos referencias con procedencia: el default de Prisma son 5 s —pensado para una mutacion
// dentro de una request— y la 124 subio el suyo a 120 s para una agregacion diaria de job. Esto
// es intermedio porque es lo que es: dos agregados de LECTURA dentro de una request de usuario.
// El dia que alguien mida, estos son los dos numeros que cambian, y su justificacion se reescribe
// aqui al lado.

/**
 * Duracion maxima de la lectura consistente, en milisegundos. Si las consultas del alcance no
 * terminan a tiempo, Prisma aborta la transaccion y el error SUBE (R7): no hay importe por
 * defecto, porque un cero servido por un timeout es indistinguible de «hoy no hubo movimiento».
 */
export const TIMEOUT_LECTURA_CONSISTENTE_MS = 15_000;

/**
 * Espera maxima por una conexion del pool antes de abrir la lectura consistente, en milisegundos.
 * Se deja en el default de Prisma: el pool es `DEFAULT_POOL_MAX = 3` por instancia
 * (`lib/db/prisma-client.ts`) y la analitica es de baja concurrencia, asi que esperar mas por una
 * conexion solo alargaria la peticion sin cambiar el desenlace.
 */
export const MAX_WAIT_LECTURA_CONSISTENTE_MS = 5_000;
