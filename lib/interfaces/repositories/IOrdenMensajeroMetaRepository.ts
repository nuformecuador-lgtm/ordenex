// Feature 115 — contrato del repositorio de la meta PRIVADA por (mensajero, orden). Solo
// queries Prisma sobre `orden_mensajero_meta`; sin logica de negocio ni permisos (esos viven
// en OrdenMensajeroMetaService).
//
// Feature 227 (R20/R23): los metodos `nota` que la 116 habia añadido a este contrato
// (`upsertNota`/`limpiarNota`/`findNotasByMensajero`) se RETIRARON con la columna
// `orden_mensajero_meta.nota`. La conversacion entre tienda y mensajero vive en `orden_nota`.
// Aqui solo queda `marcar_luego` (115), intacto (R24).
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
