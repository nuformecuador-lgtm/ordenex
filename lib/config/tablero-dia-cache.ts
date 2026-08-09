// Feature 192 (B9.2, design.md §5.quater) — CONFIGURACION DE LA CACHE DEL TABLERO.
//
// Un unico sitio declara el TTL (R72): esparcir el `15` por el adaptador y por los tests es
// como se acaba teniendo dos verdades sobre cuanto vive un dato.

/**
 * TTL de una entrada, en segundos.
 *
 * 15 s es la MITAD del refresco de 30 s de la pantalla (R31), y esa proporcion es el punto:
 * colapsa en una sola produccion las peticiones simultaneas de N usuarios sin que ninguno
 * llegue a ver un dato de mas de un ciclo de retraso.
 *
 * Lo que esta caché compra y lo que NO (design.md §5.ter, decision humana de la 4.ª vuelta):
 * acota la FRECUENCIA del recorrido secuencial del camino de recoleccion —que se quedo sin
 * indice a sabiendas—, **no su coste**. Cada escaneo cuesta exactamente lo mismo que costaria
 * sin cache y crece con el historial. La señal para reabrir la decision es que el tablero se
 * vuelva lento: la respuesta ya esta escrita y medida en §5.ter.
 *
 * Peor caso que ve el usuario: ~45 s (15 de cache + 30 de refresco). Por eso `generadoAt`
 * viaja DENTRO del valor cacheado y la pantalla anuncia la antiguedad real (R34).
 */
export const TABLERO_DIA_CACHE_TTL_SEGUNDOS = 15;
