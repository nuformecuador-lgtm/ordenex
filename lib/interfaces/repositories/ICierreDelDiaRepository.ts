// Feature 293 (T3.2, design §4) — contrato de la resolucion «dia del podio -> cierre de ese dia
// de ESE mensajero». SOLO queries Prisma; la decision de si el cierre encontrado sirve (R11/R12)
// es del servicio.
//
// Es una lectura NUEVA y no un metodo mas de `ICierresAdminRepository` porque la pregunta es otra:
// aquel resuelve «los cierres del ALCANCE de un admin»; este resuelve «que cierre agrupa el
// trabajo de este mensajero en esta fecha calendario», que no depende de ningun alcance ni de
// ningun actor.

/** El cierre elegido para un dia, con su estado. Quien decide si sirve es el servicio. */
export interface CierreDelDiaRow {
  cierreId: string;
  /** `aprobado` | `solicitado` | `rechazado` | `vencido`. El texto de R12 lo nombra. */
  estado: string;
  /** Instante de la solicitud: es el criterio de desempate de §4.4 y no cambia nunca. */
  solicitadoAt: Date;
}

export interface ICierreDelDiaRepository {
  /**
   * design §4 — el cierre de ESE mensajero que agrupa el trabajo de `ventana` (la ventana CR de
   * la fecha del podio, `[desde, hasta)`), o `null` si no hay ninguno (R11).
   *
   * **El vinculo es la GESTION, no la fecha de solicitud del cierre**, y es lo que hace la
   * resolucion semanticamente correcta: un cierre pedido a las 00:30 cubre el dia ANTERIOR. Se
   * buscan los cierres del mensajero que tienen al menos una gestion VIGENTE
   * (`anulada_at IS NULL`) con `created_at` dentro de la ventana.
   *
   * **Con VARIOS, gana el mas antiguo por `solicitado_at`, desempate por `id`** (Q5, cerrada por
   * el leader: este repo ya tuvo duplicados vivos en produccion, asi que el desempate se escribe,
   * no se supone). Las dos columnas del orden son inmutables, asi que la eleccion es estable:
   * preguntar dos veces da el mismo cierre.
   */
  resolverCierreDelDia(
    mensajeroId: string,
    ventana: { desde: Date; hasta: Date },
  ): Promise<CierreDelDiaRow | null>;
}
