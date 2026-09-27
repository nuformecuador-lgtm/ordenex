import type {
  OrdenEventoTipo as PrismaOrdenEventoTipo,
  OrdenHistorialOrigenTipo,
} from "@prisma/client";

// FICHA 454 (design §1.2, T1.1) — fuente UNICA de verdad de los tipos de HECHO sobre una orden que
// NO son transiciones de estado, respaldada por el enum Postgres nativo `orden_evento_tipo`
// (patron ORDEN_HISTORIAL_ORIGEN_TIPO_SEED):
//   - `satisfies readonly PrismaOrdenEventoTipo[]` rompe el build si el SEED lista un valor que el
//     enum NO tiene;
//   - `_EnsureExhaustive` rompe el build si el enum gana un valor que el SEED NO lista.
//
// Por que existen (design §0, DB/DE): con la 454 la gestion de calle deja de mover la orden —la
// orden se queda `en_reparto` y el estado real se aplica al APROBAR el cierre— y la ayuda a la
// tienda deja de ser el estado `ayuda_tienda`. Los dos son hechos SIN transicion, y por eso no son
// filas de `orden_historial_estado` (el choke point no admite `en_reparto -> en_reparto`).
export const ORDEN_EVENTO_TIPO_SEED = [
  // El mensajero (o la tienda desde una ayuda abierta, 237) registro una gestion de CALLE. Es el
  // evento que hace «pendiente de confirmar» a la gestion mientras su cierre no se apruebe, y el que
  // la 6.ª condicion de intentos acepta como segunda via (design §10). SOLO lo escriben las dos vias
  // de calle: una gestion sintetica (escalado, tope, reprogramacion/rechazo de escritorio) NUNCA.
  "gestion_registrada",
  // El mensajero deshizo una gestion pendiente que aun no pertenecia a ningun cierre (R15).
  "gestion_anulada",
  // Un maestro/admin corrigio `entregada -> rechazada` una gestion pendiente dentro de un cierre
  // abierto (R18). `resultado` = el nuevo, `resultado_anterior` = el de antes.
  "gestion_corregida",
  // LA IDA de la ayuda: el mensajero asignado la pidio sobre una orden gestionable (R21).
  "ayuda_solicitada",
  // LA VUELTA por la app: «Recuperar» del mensajero o «Habilitar» de la tienda. Comparten tipo
  // porque el hecho es uno; quien lo hizo lo dice `actor_rol` (mismo argumento que 235/R8).
  "ayuda_rescatada",
  // LA VUELTA por API key (266). Tipo propio: el usuario de la key ES la tienda y `actor_rol` no
  // distinguiria las vias (mismo argumento que 266/A3).
  "ayuda_habilitada_api",
] as const satisfies readonly PrismaOrdenEventoTipo[];

export type OrdenEventoTipo = (typeof ORDEN_EVENTO_TIPO_SEED)[number];

type _EnsureExhaustive = Exclude<PrismaOrdenEventoTipo, OrdenEventoTipo> extends never ? true : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;

/**
 * Los tres tipos que hablan de UNA gestion (`gestion_orden_id` NOT NULL, CHECK de la migracion).
 */
export const TIPOS_EVENTO_DE_GESTION = [
  "gestion_registrada",
  "gestion_anulada",
  "gestion_corregida",
] as const satisfies readonly OrdenEventoTipo[];

/**
 * Los tres tipos de la AYUDA. El ULTIMO de ellos (por `created_at desc, id desc`) decide si la
 * ayuda esta abierta (design §4.1): abierta solo si es `ayuda_solicitada` y nada la cerro despues.
 */
export const TIPOS_EVENTO_DE_AYUDA = [
  "ayuda_solicitada",
  "ayuda_rescatada",
  "ayuda_habilitada_api",
] as const satisfies readonly OrdenEventoTipo[];

/**
 * Las TRES familias con las que la aprobacion puede aplicar una gestion de calle (design §1.1, R8).
 * Es la lista del CHECK `orden_evento_familia_aplicacion_check`: no se amplia sin migracion.
 *   - `gestion`              — gestion del mensajero (salvo `incidente` y `devuelta`, ver R8).
 *   - `incidente`            — gestion `incidente` del mensajero.
 *   - `gestion_tienda_ayuda` — la tienda dueña registro reprogramar/rechazar desde una ayuda (237).
 * La `devuelta` se registra con familia `gestion` y se APLICA con `anclaje_devolucion` (R8, D8): la
 * familia de aplicacion de la devolucion no se guarda, se decide al aprobar.
 */
export const FAMILIAS_APLICACION = [
  "gestion",
  "incidente",
  "gestion_tienda_ayuda",
] as const satisfies readonly OrdenHistorialOrigenTipo[];

export type FamiliaAplicacion = (typeof FAMILIAS_APLICACION)[number];

/**
 * Nombre PUBLICO del evento por tipo de hecho (design §12.1, DC; R33). Los dos tipos de vuelta de
 * la ayuda publican el MISMO evento (`orden.ayuda_resuelta`) y se distinguen por `data.via`.
 * `Record` exhaustivo: un tipo nuevo en el SEED no compila sin decidir su nombre publico.
 *
 * Vive aqui (y no en `WebhookEventoOrdenService`) porque lo leen DOS capas: el servicio que entrega
 * el webhook y el contrato OpenAPI (`lib/api/openapi-spec.ts`), que DERIVA de aqui su `enum` de
 * eventos en vez de copiarlo.
 */
export const EVENTO_PUBLICO_POR_TIPO: Record<OrdenEventoTipo, string> = {
  gestion_registrada: "orden.gestion_registrada",
  gestion_anulada: "orden.gestion_anulada",
  gestion_corregida: "orden.gestion_corregida",
  ayuda_solicitada: "orden.ayuda_solicitada",
  ayuda_rescatada: "orden.ayuda_resuelta",
  ayuda_habilitada_api: "orden.ayuda_resuelta",
};
