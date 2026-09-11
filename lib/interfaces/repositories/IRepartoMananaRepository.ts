// FICHA 413 (T3.1, design §11) — contrato del repositorio del aviso «tu reparto de mañana». SOLO
// queries Prisma: la agrupacion, el cero, el bloqueo y el best-effort viven en
// `RepartoMananaAvisoService`.
//
// ⚠️ ESTAS DOS CONSULTAS SON LO QUE UN DOBLE DE TEST NO PUEDE VER. El `WHERE`, el tipo `DATE` de
// `orden.fecha_reparto` y el `GROUP BY` son SQL; un doble solo demuestra que el doble hace lo que
// el doble hace. Por eso su evidencia vive en
// `tests/integration/db/reparto-manana-repository.test.ts`, contra Postgres real. Es la leccion
// «probar el WHERE donde vive», medida cuatro veces seguidas en este repo.
//
// ⚠️ Y LA TRAMPA HORARIA VA AL REVES DE LO QUE SUELE AVISARSE EN ESTE REPO. `orden.fecha_reparto`
// es **`@db.Date`**, no `timestamp`: la cota correcta es `startOfDayCR`, y `inicioDelDiaCREnUtc`
// —que es la buena contra columnas `timestamp`— aqui desplazaria el dia SEIS HORAS. Lo dicen las
// dos direcciones del propio arbol (`lib/analytics/ranges.ts` bloque (c), `lib/utils/
// dia-reparto.ts`, y `lib/utils/fecha-cr.ts`, que lista a `orden.fecha_reparto` entre los
// consumidores declarados de `startOfDayCR`). R3 lo pone rojo con un reloj fijo a las 23:50 CR.

export interface RepartoMananaDeMensajero {
  /** `orden.mensajero_asignado_id`. Nunca nulo: el `GROUP BY` excluye las no asignadas. */
  mensajeroId: string;
  /** Cuantas ordenes suyas estan reservadas para un dia CR POSTERIOR al dia en curso. */
  total: number;
}

export interface IRepartoMananaRepository {
  /**
   * R1/R4 — una fila por MENSAJERO que tenga al menos una orden en su reparto de mañana. Los
   * mensajeros sin reparto NO vienen (R18 sale gratis: el servicio no los ve).
   *
   * @param diaEnCurso el dia CR en curso en la convencion `@db.Date` (`startOfDayCR(now)`). Entra
   *   por parametro y NO se calcula aqui: el reloj es del servicio, no del repositorio.
   */
  resumenPorMensajero(diaEnCurso: Date): Promise<RepartoMananaDeMensajero[]>;

  /**
   * R13/R41 — la CIFRA VIVA de UN mensajero, en el instante de la consulta. La usa el resolutor de
   * vigencia cuando el mensajero abre la campana; NO la usa el cron.
   *
   * EL MISMO predicado que `resumenPorMensajero`, acotado a un mensajero: comparten un unico
   * `where` privado, asi que el numero del aviso y el de la corrida NO PUEDEN describir
   * poblaciones distintas.
   */
  contarReservadasParaOtroDia(mensajeroId: string, diaEnCurso: Date): Promise<number>;
}
