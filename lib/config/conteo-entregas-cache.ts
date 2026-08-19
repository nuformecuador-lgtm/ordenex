// Configuracion de la cache del conteo de entregas. Un numero y su porque, nada mas.
//
// Criterio calcado de `lib/config/analitica-cache.ts`: los numeros viven en UNA constante
// que los declara, no repartidos por el codigo.

/**
 * TTL de una entrada, en segundos. **15 minutos, pedidos explicitamente por el humano el
 * 2026-08-17.**
 *
 * Aqui el TTL SI es el mecanismo, y no una red de seguridad como en la cache del rollup
 * (`ANALITICA_CACHE_TTL_SEGUNDOS`, 3600). La diferencia es la fuente: aquella cachea el
 * rollup diario, que tiene un job que la invalida por evento cuando reescribe una fecha;
 * esta cachea un conteo sobre las tablas VIVAS (`orden`, `gestion_orden`), que cambian con
 * cada gestion registrada y no tienen —ni van a tener— un invalidador por escritura. Lo unico
 * que acota la antiguedad de la cifra es este numero.
 *
 * Consecuencia que la pantalla esta obligada a decir: **la cifra puede tener hasta 15 minutos
 * de retraso.** Por eso el DTO lleva `lastSync` y por eso el anillo lo pinta — sin ese sello,
 * una cifra de hace un cuarto de hora se lee como si fuera de este segundo.
 */
export const CONTEO_ENTREGAS_CACHE_TTL_SEGUNDOS = 900;

/**
 * El kill-switch se REUSA: es `ANALITICA_CACHE_DISABLED`, el mismo de la cache del rollup.
 * Declarar una segunda variable de entorno para lo mismo obligaria a acordarse de las dos el
 * dia que haya que apagar la analitica en produccion — y ese dia nadie va a leer este
 * comentario. Se importa `analiticaCacheHabilitada` en el adaptador; aqui solo queda dicho.
 */
