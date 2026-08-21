// Feature 41 — contrato del servicio del corte diario (R6-R11). Logica de negocio pura
// (sin HTTP ni Prisma directo): el route handler `/api/cron/corte-diario` la invoca. Por
// cada mensajero que "debia cerrar y no solicito" (R7) crea un cierre `vencido` con
// destino a su bodega responsable (R1) y snapshot money-safe (R8), idempotente (R9).

// Resumen de una corrida del corte (sin PII, R24): se devuelve al cron para observabilidad.
export interface CorteDiarioResult {
  // Mensajeros evaluados (con actividad del dia sin cerrar y sin `solicitado`, R7/R10).
  mensajerosEvaluados: number;
  // Cierres `vencido` efectivamente creados (R6).
  vencidosCreados: number;
  // Mensajeros omitidos por no tener zona asignada (P2): no se puede derivar la bodega.
  mensajerosSinZona: number;
}

export interface ICorteDiarioService {
  /**
   * R6-R11: ejecuta el corte diario. Idempotente (R9): una vez vinculadas las gestiones
   * al `vencido` (`cierre_id` deja de ser NULL) una segunda corrida no las ve pendientes.
   * Omite al mensajero sin zona (P2). No conoce HTTP.
   *
   * FEATURE 246 (T2.1): `now` es el RELOJ INYECTABLE de la corrida. De el sale —una sola vez— el
   * dia que la corrida CIERRA, que es lo que decide que ordenes estan reservadas para un dia que
   * aun no ha llegado y por tanto no se barren (R11). Con default para que el route handler del
   * cron siga llamando sin argumentos; los tests lo pasan siempre, porque esta ficha se prueba
   * moviendo el reloj y no esperando a medianoche.
   */
  ejecutarCorte(now?: Date): Promise<CorteDiarioResult>;
}
