// FICHA 409 (T1.3, design §4.1, R53) — EL UMBRAL DE REPRESAMIENTO, CON SU MEDICION AL LADO.
//
// R53 pide que el umbral se resuelva POR CONFIGURACION y no quede escrito dentro de la logica que
// lo aplica: `AvisosDiariosService` lo recibe por constructor, y este archivo es su unico origen en
// produccion. Una guardia del propio test del servicio comprueba que el numero no aparece como
// literal alli.
//
// ⚠️ POR QUE 3 DIAS Y NO 7, Y POR QUE EL ESTADO VIGILADO ES `por_devolver`. MEDIDO EN PRODUCCION
// EL 2026-09-10, no estimado:
//
//   | estado                  | ordenes | media  | maximo | por encima de 3 d |
//   | ----------------------- | ------- | ------ | ------ | ----------------- |
//   | `devolviendo_a_tienda`  |   247   |  1,0 d |  1,3 d |        0          |
//   | `por_devolver`          |    27   |  2,4 d |  8,2 d |        7          |
//
// `devolviendo_a_tienda` FLUYE: 247 ordenes y ninguna pasa de dia y medio. Avisar sobre ese estado
// seria RUIDO PURO SOBRE EL CUBO MAS GRANDE —exactamente lo que esta ficha existe para no volver a
// hacer, porque 26 de 39 personas ya no abren la campana—. Por eso R46 PROHIBE vigilarlo y tiene
// su propio test de no-inclusion contra Postgres real.
//
// El represamiento real esta en `por_devolver`. Con el umbral en 3 dias el aviso de hoy hablaria
// de SIETE ordenes: un numero que alguien puede atender. Con 7 dias serian DOS, y llegaria tarde.
//
// `por_devolver_a_tienda` NO se vigila: no esta medido. Si resultara represado, entra como un
// ambito mas del mismo emisor y se registra como ficha aparte — no se cuela aqui.

export interface AvisosDiariosConfig {
  /**
   * Dias que una orden lleva en `por_devolver` a partir de los cuales se considera REPRESADA y
   * entra en el aviso `devoluciones_represadas`. Ver la medicion de arriba.
   */
  readonly DIAS_REPRESAMIENTO: number;
}

export const avisosDiariosConfig: AvisosDiariosConfig = {
  DIAS_REPRESAMIENTO: 3,
};
