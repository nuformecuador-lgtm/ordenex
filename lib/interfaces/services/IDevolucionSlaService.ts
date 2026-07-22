// Feature 99 (design §3.3, R6/R13/R14-R19/R26/R27/R28) — contrato del servicio del cron SLA de
// devoluciones diferidas. Logica de negocio pura (sin HTTP ni Prisma directo): el route handler
// `/api/cron/procesar-devueltas-sla` lo invoca con el reloj (`now`) inyectado.

// Resumen de una corrida (sin PII, R11/R12): se devuelve al cron para observabilidad. Los cuatro
// conteos son DISJUNTOS por orden candidata:
//   - evaluadas: ventana AUN viva -> la orden reposa en `devuelta`, el cron NO actua (R14).
//   - liberadas: `not_found` vencida + intentos < umbral -> reintento a bodega (R15).
//   - escaladas: `not_found` >= umbral (R16) o `wrong_*` vencida (R17) -> `rechazada`.
//   - omitidas: causa null (R28), fallo por orden (R26) o guarda de estado ya no vigente
//     (R24/R25: la orden salio de `devuelta` entre la lectura y la escritura).
export interface DevolucionSlaResult {
  evaluadas: number;
  liberadas: number;
  escaladas: number;
  omitidas: number;
}

export interface IDevolucionSlaService {
  /**
   * R6/R13/R14-R19/R26/R27/R28: evalua las ordenes en `devuelta`, computa la ventana ROLLING
   * desde el anclaje (24h `not_found`; 5 dias `wrong_*`) con el reloj `now` inyectado, y libera
   * (reintento a bodega) o escala (`rechazada`) al vencer. Resiliente por orden (un fallo no
   * aborta la corrida) e idempotente (la guarda por estado evita el doble efecto). No conoce
   * HTTP; el reloj se inyecta para pruebas deterministas.
   */
  ejecutar(now: Date): Promise<DevolucionSlaResult>;
}
