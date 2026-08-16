// Feature 229 (design §1/§2.2) — contrato de LECTURA del rastreo publico.
//
// Repositorio PROPIO y no un metodo mas en `IOrdenHistorialRepository`: aquel resuelve
// `actorNombre` y `motivo` (`IOrdenHistorialRepository.ts:89`), y R25 exige poder afirmar
// que el `select` de ESTE modulo no nombra ningun campo prohibido. Precedente exacto:
// `ConteosPublicosRepository` (feature 198).
//
// Las dos filas de abajo son la lista blanca de lo que sale de la base: nada de
// `direccion`, `montoCobrar`, `producto`, `notas`, `destinatario`, `mensajeroAsignadoId`,
// `actorUsuarioId`, `origenTipo`, `motivo` ni `gestionOrdenId`.

/** Lo minimo para identificar la orden y comparar el segundo factor (design §1). */
export interface OrdenRastreoFila {
  /**
   * SOLO sirve de clave para la segunda lectura. NO sale hacia el DTO publico (R23): un
   * identificador interno en una respuesta anonima es una fuga.
   */
  readonly id: string;
  readonly numGuia: number | null;
  readonly telefonoDest: string;
  readonly deletedAt: Date | null;
}

/** Una transicion del historial, reducida a lo que el publico puede ver. */
export interface TransicionRastreoFila {
  readonly createdAt: Date;
  /** `order_status.value` CRUDO: puede estar fuera del catalogo vigente (R17). */
  readonly estatusValue: string;
}

export interface IRastreoPublicoRepository {
  /** La orden de esa guia, o `null`. Sin filtrar por `deletedAt`: decidir es del service. */
  buscarPorGuia(numGuia: number): Promise<OrdenRastreoFila | null>;

  /**
   * R21 — la linea de tiempo completa de UNA orden en UNA sola consulta, ascendente,
   * apoyada en el indice existente `@@index([ordenId, createdAt])`. Nunca una consulta por
   * transicion.
   */
  listarTransiciones(ordenId: string): Promise<readonly TransicionRastreoFila[]>;
}
