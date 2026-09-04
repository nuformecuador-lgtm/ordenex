// FICHA 371 — CONTRATO de la capa de datos de «corregir la fecha de una reprogramacion».
//
// Dos metodos y ni uno mas: LEER los hechos con los que el servicio decide, y ESCRIBIR la
// correccion entera (fecha + rastro detallado + fila del historial) en una sola transaccion.
//
// NO declara `update` ni `delete` sobre el rastro: las dos tablas que esta escritura toca
// (`gestion_fecha_reprogramacion_cambio` y `historial_accion`) son append-only, y esa ausencia es
// esa regla expresada en el tipo.

/**
 * Los hechos con los que el servicio decide si la correccion procede, y con los que NOMBRA el
 * rechazo cuando no. Son HECHOS, no decisiones (`docs/architecture.md`): el repositorio los trae y
 * el servicio los interpreta.
 *
 * `null` como resultado de la lectura significa «la orden no existe»; una orden BORRADA si vuelve,
 * con `deletedAt` poblado, para poder distinguir los dos motivos.
 */
export interface OrdenParaCorreccionRow {
  ordenId: string;
  /** `value` del catalogo (`order_status`), para que el rechazo pueda NOMBRAR el estado. */
  estatusValue: string;
  deletedAt: Date | null;
  /** Id de la gestion `reprogramada` VIGENTE, o `null` si la orden no tiene ninguna. */
  gestionVigenteId: string | null;
  /** Fecha de esa gestion. `null` = la gestion no fijo fecha (no se corrige: se rechaza). */
  fechaReprogramacion: Date | null;
}

/** Lo que la escritura necesita saber. Todo YA resuelto por el servicio: aqui no se decide nada. */
export interface CorregirFechaReprogramacionRepoInput {
  ordenId: string;
  /** Fecha CALENDARIO `YYYY-MM-DD`, validada en el borde. Viaja como TEXTO hasta el `::date`. */
  fecha: string;
  /** Guarda de estado: el `estatus_id` de `reprogramada`, resuelto por el servicio. */
  estatusReprogramadaId: string;
  actorUsuarioId: string;
  /** Obligatorio y ya recortado por `motivoSchema` (el mismo de reprogramar). */
  motivo: string;
}

/** El desenlace de una correccion efectiva. */
export interface CorreccionFechaAplicada {
  /** La gestion sobre la que se escribio: la `reprogramada` vigente en el instante de la tx. */
  gestionId: string;
  /** Id de la fila de `gestion_fecha_reprogramacion_cambio`. */
  cambioId: string;
  /** La fecha que la fila TENIA, fotografiada bajo `FOR UPDATE` ANTES de pisarla. */
  fechaAnterior: Date;
  fechaNueva: Date;
}

export interface ICorreccionFechaReprogramacionRepository {
  /**
   * Los hechos de la orden y de su gestion `reprogramada` vigente. `null` = la orden no existe.
   *
   * Es una lectura de PRE-CHEQUEO: sirve para rechazar con un motivo que el operador entienda. La
   * eleccion que MANDA la vuelve a hacer `corregirFecha` DENTRO de su transaccion, porque entre
   * esta lectura y la escritura puede pasar cualquier cosa.
   */
  findOrdenParaCorreccion(ordenId: string): Promise<OrdenParaCorreccionRow | null>;

  /**
   * LA ESCRITURA, todo-o-nada. En UNA transaccion:
   *   1. elige la gestion `reprogramada` vigente con la correlacion COMPARTIDA con el cron;
   *   2. la BLOQUEA y fotografia su fecha (`SELECT … FOR UPDATE`) ANTES de pisarla;
   *   3. escribe la fecha nueva con el `UPDATE` GUARDADO por estado (orden en `reprogramada`, no
   *      borrada, gestion vigente, fecha distinta);
   *   4. registra la fila del rastro detallado (con su motivo) por el choke point;
   *   5. registra la fila de `historial_accion` con las DOS fechas.
   *
   * `null` = no se escribio NADA: la orden salio de `reprogramada`, la gestion vigente cambio, no
   * habia fecha previa o ya era esa misma fecha. Una carrera perdida no deja rastro huerfano.
   */
  corregirFecha(
    input: CorregirFechaReprogramacionRepoInput,
  ): Promise<CorreccionFechaAplicada | null>;
}
