// Feature 115 — contrato del repositorio de la meta PRIVADA por (mensajero, orden). Solo
// queries Prisma sobre `orden_mensajero_meta`; sin logica de negocio ni permisos (esos viven
// en OrdenMensajeroMetaService / NotaPrivadaMensajeroService). La feature 116 EXTIENDE esta
// interfaz con los metodos `nota` (`upsertNota`/`limpiarNota`/`findNotasByMensajero`) sobre la
// MISMA tabla (columna `nota text NULL` creada por la 115).
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

  /**
   * Feature 116 (R1/R2/R3/R9): crea o edita la nota privada de la pareja `(usuarioId, ordenId)`
   * mediante un UPSERT por el `UNIQUE(usuario_id, orden_id)`. En conflicto actualiza SOLO `nota`,
   * PRESERVANDO `marcar_luego` (feature 115) de esa misma fila (R3). Crea la fila si no existia
   * (`marcar_luego` toma su default `false`, R1). El `usuarioId` lo fija SIEMPRE el service con el
   * actor (nunca el input, R9). La FK `orden_id -> orden` impide filas huerfanas (R16): si la
   * orden no existe, el upsert lanza y el service lo traduce a resultado de dominio.
   */
  upsertNota(usuarioId: string, ordenId: string, nota: string): Promise<void>;

  /**
   * Feature 116 (R4/R9): limpia la nota de la pareja `(usuarioId, ordenId)` dejando `nota = NULL`
   * SIN borrar la fila (preserva `marcar_luego`, 115). `updateMany` -> no-op idempotente si no
   * existe fila (`count = 0`), en vez de lanzar como haria `update` (R4). El `usuarioId` acota la
   * operacion a la fila del actor (nunca la de otro mensajero, R9).
   */
  limpiarNota(usuarioId: string, ordenId: string): Promise<void>;

  /**
   * Feature 116 (R6/R8): mapa `orden_id -> nota` de las filas del PROPIO mensajero
   * (`usuario_id = usuarioId` en el WHERE) que TIENEN nota (`nota IS NOT NULL`). Alimenta el
   * reflejo de `notaPrivada` en el listado de asignaciones (patron de `findMarcarLuegoByMensajero`);
   * solo lee las notas del actor, NUNCA la de otro mensajero para la misma orden (R8).
   */
  findNotasByMensajero(usuarioId: string): Promise<Map<string, string>>;
}
