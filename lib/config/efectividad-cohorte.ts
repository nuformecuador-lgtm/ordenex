// FICHA 441 — EL UMBRAL DE BASE CHICA, CON SU MEDICION AL LADO.
//
// Mismo patron que `lib/config/avisos-diarios.ts`: el numero vive aqui, con el porque; la regla
// que lo aplica (`lib/analytics/madurez-cohorte.ts`) lo recibe importado y no lo escribe.
//
// ─── QUE PROBLEMA RESUELVE ──────────────────────────────────────────────────────────────
//
// Un porcentaje sobre una base chica no mide la operacion: mide el ruido. Con 3 ordenes cerradas,
// cada una vale 33 puntos y la cifra salta 0 → 33 → 67 → 100 sin que nada real haya cambiado.
// Escribir el denominador al lado —lo que hizo la ficha 360— no basta aqui: el 360 pedia que se
// pudiera distinguir un 29,5 % de 877 de un 29,5 % de 17; esto es un paso mas alla, porque con la
// base por debajo del umbral el porcentaje NO SE ESCRIBE.
//
// ─── DE DONDE SALE EL NUMERO: NO SE ELIGE, SE DERIVA ────────────────────────────────────
//
// Lo que se elige es una TOLERANCIA con significado —cuanto puede mover el numero UNA sola
// orden— y el tamano minimo de base sale de ella: `ceil(1 / tolerancia)`. Con 5 puntos por orden
// el suelo es 20. El numero que se discute es «5 puntos», que se puede defender o rebatir; «20»
// solo seria una constante magica.
//
// POR QUE 5 PUNTOS Y NO 10: a 10 puntos por orden, una cohorte de 10 ordenes pintaria 40 % o 50 %
// segun una sola entrega, y ese es el tamano de varias zonas reales (ver la tabla). A 5, hace
// falta que se muevan dos ordenes para que la cifra cambie de decena.
//
// ⚠ NO ES UN CRITERIO ESTADISTICO, y conviene decirlo para que nadie lo defienda como tal: el
// intervalo de confianza del 95 % de una proporcion cerca del 50 % tiene un semiancho de ~0,98/√N
// —±22 puntos con N=20, ±18 con N=30—, asi que por esa via habria que esconder casi todo lo que
// esta pantalla ensena. Este umbral no promete significancia: promete que la cifra no baile sola.
//
// ─── CONTRASTADO CONTRA POBLACIONES REALES (medidas el 2026-09-17 en produccion) ────────
//
//   | poblacion              | cargadas | cerradas | que hace el umbral                      |
//   | ---------------------- | -------- | -------- | --------------------------------------- |
//   | zona GAM               |    637   |   389    | las dos cifras se pintan                |
//   | zona El Coco           |     64   |     3    | tapa el % sobre cerradas (3 ordenes)    |
//   | zona Puntarenas        |     27   |     0    | ya lo tapa la regla de cero cerradas    |
//   | cohorte de hace 1 dia  |     75   |    17    | pinta 14,7 %; tapa el 64,7 % sobre 17   |
//   | cohorte de hace 3 dias |    171   |    88    | las dos cifras se pintan                |
//   | periodo del diseno     |    790   |   525    | las dos cifras se pintan                |
//
// El caso que el humano nombro —«con 3 ordenes cada una vale 33 puntos»— es El Coco, y queda
// tapado. El unico caso discutible es la cohorte de un dia: su 64,7 % sobre 17 cerradas
// desaparece. Se acepta a proposito, porque es exactamente la cifra que la ficha describe como
// «lee mal por joven, no por mala»; el KPI principal (14,7 % sobre 75 cargadas) sigue en
// pantalla, y la barra de madurez —11 entregadas, 6 con otro desenlace, 58 vivas— sigue diciendo
// por que.
//
// QUE HAY QUE HACER SI SE CAMBIA: mover `MAXIMO_SALTO_POR_ORDEN` aqui, y nada mas. El suelo se
// recalcula solo y `tests/unit/analytics/madurez-cohorte.test.ts` comprueba la DERIVACION (que
// con la base en el suelo una orden mueve exactamente la tolerancia, y con una menos la supera),
// no el valor 20 — asi que ajustar la tolerancia no obliga a reescribir ningun caso.

export interface EfectividadCohorteConfig {
  /**
   * Cuanto puede mover el porcentaje UNA sola orden, como FRACCION (0,05 = 5 puntos), para que
   * la cifra se considere legible. De aqui sale la base minima: `ceil(1 / este numero)`.
   *
   * Estrictamente entre 0 y 1. Ver la medicion de arriba.
   */
  readonly MAXIMO_SALTO_POR_ORDEN: number;
}

export const efectividadCohorteConfig: EfectividadCohorteConfig = {
  MAXIMO_SALTO_POR_ORDEN: 0.05,
};
