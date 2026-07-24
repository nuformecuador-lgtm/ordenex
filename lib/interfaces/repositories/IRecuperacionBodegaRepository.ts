// Feature 100 (design §3.1) — contrato del repositorio de RECUPERACION a bodega. SOLO queries
// Prisma (sin logica de negocio: el ruteo por zona y la autz los decide `RecuperacionBodegaService`).
// Molde de `DevolucionSlaRepository.liberarDevueltaSla` (99): UPDATE guardado por
// `estatus_id = devuelta` + no borrada, limpia el mensajero, y appendea al historial via el choke
// point en la MISMA tx. La UNICA diferencia con el metodo del cron es el actor (el admin que
// ejecuta, NO NULL) y el `origen_tipo` (`recuperacion_manual`, NO `liberacion_devuelta_sla`), gate
// F1.4-Q2. Reutiliza `orden` + `orden_historial_estado`; no introduce tablas ni RLS nueva.

// Entrada del reintento manual (R13): destino de bodega ya resuelto por el service, el estatus de
// ORIGEN esperado (`devuelta`) como guarda de idempotencia/concurrencia (R16/R21) y el actor.
export interface RecuperarABodegaInput {
  ordenId: string;
  destinoEstatusId: string; // en_bodega_central | en_bodega_satelite (resuelto por el service)
  estatusDevueltaId: string; // guarda: solo actua si la orden sigue en `devuelta`
  actorUsuarioId: string; // R17: el admin que ejecuta la recuperacion (para auditoria)
}

export interface IRecuperacionBodegaRepository {
  /**
   * R13/R14/R16/R17/R20/R21: transiciona UNA orden de `devuelta` al destino de bodega y limpia el
   * mensajero (`mensajero_asignado_id`/`asignado_at`), con escritura GUARDADA por
   * `estatus_id = devuelta` + no borrada. El append al historial
   * (`origen_tipo = recuperacion_manual`, actor = el admin) va DENTRO del `if (count > 0)` de la
   * MISMA tx. Devuelve `true` si afecto una fila; `false` si la orden ya salio de `devuelta`
   * (2.ª corrida / carrera con el cron SLA de la 99 -> no-op, sin efectos). Feature 101/R3: la
   * recuperacion MANUAL NO enciende `orden.prioridad` (la columna ya existe, pero el `data` no la
   * toca); solo la liberacion por SLA (99) la enciende.
   */
  recuperarABodega(input: RecuperarABodegaInput): Promise<boolean>;
}
