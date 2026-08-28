// Feature 46 (R7/R12/R13/R14/R17) — contrato del servicio de la liberacion programada.
// Logica de negocio pura (sin HTTP ni Prisma directo): el route handler
// `/api/cron/liberar-reprogramadas` la invoca con "hoy" en zona CR ya calculado.

// Resumen de una corrida (sin PII, R7/R19): se devuelve al cron para observabilidad.
export interface LiberacionResult {
  // Ordenes candidatas evaluadas (reprogramadas con fecha <= hoy CR, R10).
  evaluadas: number;
  // Ordenes efectivamente liberadas a su bodega responsable (R12/R13).
  liberadas: number;
  // Ordenes omitidas: fallo por orden (R14) o guarda de estado ya no vigente (R17).
  omitidas: number;
  /**
   * FEATURE 276 (T6.2, R12/R13) — candidatas que NO se liberan porque su gestion `reprogramada`
   * vigente TODAVIA PUEDE SUBIR EL CONTADOR: nace de una visita real y su cierre no esta aprobado.
   *
   * Es un CONTADOR AGREGADO y sin PII (R38), y no es decorativo: es lo unico que hace OBSERVABLE
   * la poblacion congelada del «Riesgo declarado» de requirements — ordenes que se quedan quietas
   * en `reprogramada` esperando a que alguien apruebe un cierre. La vigilancia continua sobre esa
   * poblacion sigue siendo ficha aparte (M3 del §7bis de la 215); esto es el minimo para poder
   * verla crecer.
   *
   * Opcional (`?`) por el patron aditivo del repo: no rompe los dobles ni los fixtures que
   * construyen un `LiberacionResult` sin el. El servicio SIEMPRE lo emite, el `0` incluido.
   */
  esperandoCierre?: number;
}

export interface ILiberacionReprogramadaService {
  /**
   * R12-R14/R17: libera las ordenes reprogramadas cuya fecha ya llego (`hoyCR`),
   * derivando la bodega responsable por zona (central -> `en_bodega_central`, satelite ->
   * `en_bodega_satelite`), limpiando el mensajero y marcando `liberada_reprogramada_at`.
   * Resiliente por orden (un fallo no aborta la corrida). Idempotente (una re-corrida no
   * re-libera: la orden ya salio de `reprogramada`). No conoce HTTP; la fecha se inyecta.
   */
  ejecutarLiberacion(hoyCR: Date): Promise<LiberacionResult>;
  /**
   * FICHA 315 — LA MISMA LIBERACION, DISPARADA POR EL EVENTO EN VEZ DE POR EL RELOJ.
   *
   * ⚠️ POR QUE HAY DOS DISPARADORES Y NO ES DUPLICACION. La 276 congela una orden reprogramada
   * mientras su gestion todavia pueda sumar un intento, y solo la suelta cuando el cierre de esa
   * gestion queda `aprobado` (`puedeLiberarse`). Eso dejo DOS condiciones distintas para salir de
   * `reprogramada`, y cada una tiene su propio instante:
   *
   *   - **el CALENDARIO** — «esta orden se reprogramo para el 31/08». No hay evento que avisar:
   *     nadie hace nada el 31/08, simplemente llega. Lo cubre `ejecutarLiberacion` a las 00:00 CR.
   *   - **la APROBACION del cierre** — un acto humano con hora exacta. Lo cubre este metodo, en el
   *     acto. Medido en produccion el 2026-08-28: la corrida de las 14:10 UTC dejo 5 ordenes
   *     congeladas por cierre sin aprobar, el humano aprobo a las 14:48 y NADIE volvio a mirarlas;
   *     siguieron invisibles para la reasignacion hasta que se encolo una corrida a mano a las
   *     15:20 — con la corrida automatica siguiente a 9 horas de distancia.
   *
   * Ninguno de los dos sobra: el reloj no puede adelantar la aprobacion y la aprobacion no puede
   * adelantar el calendario. Y el reloj es ademas LA RED de este camino: si esta liberacion falla
   * —o si el proceso se cae entre el commit de la aprobacion y esta llamada—, la corrida de
   * medianoche recoge lo que quedo. Por eso este camino puede fallar sin revertir nada.
   *
   * Acotado a las ordenes de ESE cierre cuya fecha YA vencio (ver
   * `findOrdenesLiberablesDeCierre`); las de fecha futura NO se tocan.
   */
  liberarPorCierreAprobado(cierreId: string, hoyCR: Date): Promise<LiberacionResult>;
}
