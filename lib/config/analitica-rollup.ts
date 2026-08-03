// Feature 124 (D9 / R47) — LA UNICA cifra de volumen del rollup diario.
//
// No hay ni un dato de volumen medido en este repo: `analytics_daily` nace vacia (R44 de la
// 123) y esta feature es su primer escritor. Por eso NO se inventa ningun tope: la corrida
// registra SIEMPRE filas escritas, filas retiradas y milisegundos (R47), y con esa medicion
// real la feature 125 fijara los umbrales de verdad.
//
// ⚠️ PROVISIONAL Y NO MEDIDA. La cifra de abajo es un aviso, no un limite: nada se rechaza
// ni se trunca por superarla. Esta puesta para que la primera corrida que se salga de lo
// esperado deje rastro en el log, no para gobernar el comportamiento del job. Cuando exista
// medicion (T8.3 y las primeras corridas reales), la 125 la sustituye por un numero con
// procedencia.
//
// R47, segunda mitad: esta constante vive SOLO aqui. Duplicar la cifra en otro archivo pone
// rojo el guard de constante unica; si hace falta en otro sitio, se importa.
export const UMBRAL_AVISO_FILAS_CORRIDA = 20000;

/**
 * Feature 125 (R14, design §5) — fallos CONSECUTIVOS que abortan una pasada del backfill.
 *
 * NO es una cifra de volumen: no limita filas, ni cubos, ni dias por invocacion (D5 prohibe fijar
 * un tope de dias sin medicion, y esta entrega no lo trae). Es el corte que separa «un dia raro»
 * de «el entorno esta roto»: si la base se cae o la `DATABASE_URL` es la equivocada, un backfill
 * de 200 dias recorreria las 200 fechas fallando 200 veces. Tres fallos seguidos ya no son una
 * casualidad. Vive aqui, y no en el servicio, porque R47 de la 124 quiere UN solo sitio donde
 * tocar los numeros del job de analitica.
 *
 * Los fallos NO consecutivos no cortan nada a proposito (R13): la unidad de atomicidad es la
 * fecha, la transaccion de la 124 deja la fecha fallida exactamente como estaba, y abortar el
 * rango entero por una fecha enferma castiga a las sanas.
 */
export const FALLOS_CONSECUTIVOS_QUE_ABORTAN = 3;

/**
 * Tiempo maximo de la transaccion unica de la corrida (D9: una fecha, sin lotes). NO es una
 * cifra de volumen: es el limite de la transaccion interactiva de Prisma, cuyo default (5 s)
 * esta pensado para una mutacion de una request, no para una agregacion diaria. Vive en este
 * mismo archivo para que siga habiendo UN solo sitio donde tocar los numeros del job (R47).
 */
export const TIMEOUT_TX_ROLLUP_MS = 120_000;
