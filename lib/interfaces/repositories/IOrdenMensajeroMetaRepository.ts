// Feature 115 — contrato del repositorio de la meta PRIVADA por (mensajero, orden). Solo
// queries Prisma sobre `orden_mensajero_meta`; sin logica de negocio ni permisos (esos viven
// en OrdenMensajeroMetaService). La feature 116 EXTENDERA esta interfaz con metodos `nota`
// (`upsertNota`/`findNotasByMensajero`) sobre la MISMA tabla; 115 no los crea.
export interface IOrdenMensajeroMetaRepository {
  /**
   * R5/R6/R7/R8: fija `marcar_luego` para la pareja `(usuarioId, ordenId)` de forma
   * idempotente (upsert por el `UNIQUE(usuario_id, orden_id)`): crea la fila si no existia,
   * o solo actualiza `marcar_luego` si ya existia. El `usuarioId` lo fija SIEMPRE el service
   * con el actor (nunca el input); el repo solo persiste lo que recibe.
   */
  upsertMarcarLuego(usuarioId: string, ordenId: string, marcarLuego: boolean): Promise<void>;

  /**
   * R17/R20: conjunto de `orden_id` con `marcar_luego = true` del PROPIO mensajero
   * (`usuario_id = usuarioId` en el WHERE). Alimenta el reflejo de la marca en el listado de
   * asignaciones; solo lee las filas del actor (nunca de otro mensajero).
   */
  findMarcarLuegoByMensajero(usuarioId: string): Promise<Set<string>>;
}
