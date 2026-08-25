// Feature 266 (T2.3, design §4.3) — contrato del repositorio de la BITACORA de habilitaciones por
// API key (`orden_habilitacion_api`). SOLO queries Prisma: sin logica de negocio, sin permisos y
// sin proyeccion. La unica puerta —la orden tiene que ser del owner de la key— vive en
// `ApiHabilitacionService` (la tabla lleva RLS habilitada SIN policies, R29).

/**
 * Los datos de UNA habilitacion aceptada, comun a las DOS ramas (R23). Todos vienen ya resueltos
 * por el service; el repo no sabe quien es el actor ni de que rama viene la fila.
 */
export interface RegistrarHabilitacionApiInput {
  ordenId: string;
  /** R3: SIEMPRE `actor.usuarioId`, el usuario dedicado de la key. Nunca un id del cuerpo. */
  actorUsuarioId: string;
  /** R7: ya recortada y validada en el borde (no vacia, <= 200 caracteres). */
  nota: string;
  /** `true` = rama A (la orden volvio a `en_reparto`), `false` = rama B (solo log). */
  cambioDeEstado: boolean;
  /** SNAPSHOT del `order_status.value` en el que la orden quedo, no una referencia viva. */
  estadoResultante: string;
}

/**
 * **APPEND-ONLY POR CONTRATO (R24).** La interfaz declara UN solo metodo y no expone —ni debe
 * ganar— ningun `actualizar`, `editar`, `borrar` ni `marcarBorrada`: una segunda habilitacion de
 * la misma orden con otra nota es un HECHO NUEVO, no una correccion del anterior. La tabla
 * tampoco tiene `updated_at` ni `deleted_at` que permitirian escribirlos.
 */
export interface IOrdenHabilitacionApiRepository {
  /** Inserta UNA fila de bitacora. Sin leer ni tocar ninguna fila previa. */
  registrar(input: RegistrarHabilitacionApiInput): Promise<void>;
}
