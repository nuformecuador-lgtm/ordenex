// ⏳ 2026-09-10 (feature 405) — los tres tipos que acotan `gestiones[]`, importados de sus fuentes
// UNICAS y no reescritos aqui: el enum de resultados es el de Prisma, y las dos causas tipificadas
// llevan su doble candado contra el enum nativo. Son `import type`: se borran en compilacion y este
// modulo sigue sin arrastrar runtime.
import type { GestionResultado } from "@prisma/client";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";

// Feature 106 — DTOs PUBLICOS del canal integrador (API por key). Son la superficie que el
// integrador ve; NUNCA incluyen internals ni PII de terceros:
//   - sin `id` UUID interno ni `tiendaId` (el owner ya es quien pregunta),
//   - sin `evidencia_storage_path` crudo ni el nombre del bucket (solo URL firmada, R16),
//   - sin datos del mensajero que gestiono la orden (R16).
// El identificador publico es `numGuia` (decision (d) del gate F1.4).
//
// ⏳ 2026-09-09 (feature 404) — AQUI DECIA «sin datos del mensajero que gestiono la orden (R16)»
// como si el canal no dijera nada de ningun mensajero, y ESO YA NO ES CIERTO SIN MATIZ. Hay que
// leerlo distinguiendo DOS mensajeros distintos, porque la frase original mezclaba los dos:
//   - el que GESTIONO la orden (`gestion_orden.mensajero_id`): sigue SIN publicarse, ni su nombre
//     ni su id ni su texto libre. Es material de la feature 405, no de esta.
//   - el ASIGNADO a la orden ahora mismo (`orden.mensajero_asignado_id`): esta feature publica su
//     `id` y su `nombre` —y NADA mas— al DUENO de la orden. Excepcion ACOTADA a 106/R16, firmada
//     por el humano el 2026-09-09 con este argumento medido: la cuenta `adminTienda` ya ve ese
//     mismo nombre completo en la columna «Mensajero» de `/ordenes` y se lo lleva en el XLSX, asi
//     que la API no le entrega ni un caracter que no tuviera ya.
// El resto de la frase sigue vigente palabra por palabra: sin `storage_path`, sin bucket, sin
// `tiendaId`, sin ids internos de orden y sin el resto de la PII del mensajero (telefono, email,
// cedula, foto, zona, vehiculo).

/**
 * ⏳ 2026-09-09 (feature 404) — el mensajero ASIGNADO de una orden, en el canal publico.
 *
 * QUE ES. `id` es el `usuario.id` (UUID en texto, `db/schema.prisma`): estable en el tiempo, no se
 * regenera y no se recicla —la FK de la orden es `onDelete: SetNull`, asi que borrar la cuenta deja
 * la orden SIN mensajero, nunca apuntando a otra persona— (R4). `nombre` es el nombre COMPLETO
 * compuesto por `nombreCompletoUsuario` (`lib/utils/nombre-usuario.ts`), la unica fuente de
 * composicion del repo (R3): no se compone a mano en ningun segundo sitio.
 *
 * QUE SIGNIFICA (R7). Es «quien LLEVA la orden AHORA», leido de `orden.mensajero_asignado_id`, y
 * NUNCA «quien la gestiono». Varios flujos limpian esa asignacion a `null` —generacion de guia,
 * quitar mensajero, devolucion a bodega, liberacion de reprogramada, recuperacion a bodega y el
 * barrido del corte diario—, de modo que una orden historica puede quedar sin mensajero aunque
 * alguien la haya llevado. La identidad de quien la gestiono vive en `gestion_orden.mensajero_id`
 * y es material de la feature 405.
 *
 * DOS CLAVES Y NINGUNA MAS (R1/R6): ni telefono, ni email, ni cedula, ni foto, ni zona, ni
 * vehiculo, ni ningun campo de estado interno.
 *
 * LA 405 REUTILIZA ESTE TIPO (design §11): su mensajero es OTRO dato con la MISMA forma (el de
 * cada gestion). No debe declarar un segundo tipo de mensajero ni «mejorar» este con campos
 * nuevos; cambiarlo seria un cambio del contrato publico con su propia entrada de CHANGELOG.
 */
export interface ApiMensajeroDTO {
  id: string; // usuario.id (UUID). Estable; nunca se reasigna.
  nombre: string; // nombreCompletoUsuario(): nombre + apellidos, sin dobles espacios.
}

/** Un item del LISTADO paginado (GET coleccion). Campos publicos de la orden (R6). */
export interface ApiOrdenListItemDTO {
  numGuia: number | null;
  numRemision: string;
  estado: string; // orden.estatus.value
  destinatario: string;
  telefonoDest: string;
  producto: string;
  direccion: string | null;
  montoCobrar: number | null; // Decimal -> number
  createdAt: Date;
  /**
   * ⏳ 2026-09-09 (feature 404, R14/R18) — el mensajero ASIGNADO, o `null` si nadie lleva la orden.
   * La clave viaja SIEMPRE (R2): `null` es un hecho del negocio que el integrador cuenta en su
   * denominador, no un «no aplica» que se pueda omitir. `ApiOrdenDetalleDTO` lo hereda.
   */
  mensajero: ApiMensajeroDTO | null;
}

/** Info de paginacion offset/limit del listado (R10), con `total` para recorrer paginas. */
export interface ApiOrdenPagination {
  limit: number;
  offset: number;
  total: number;
}

/** Respuesta del listado: items + paginacion (R10). */
export interface ApiOrdenListadoDTO {
  items: ApiOrdenListItemDTO[];
  pagination: ApiOrdenPagination;
}

/**
 * UNA evidencia de entrega/rechazo/incidente, ya resuelta a URL firmada de corta duracion
 * (R15/R17). FEATURE 268/R27 (2026-08-22): `incidente` entra en el union para que el DTO publico
 * pueda llevar las fotos del incidente por sus dos procedencias (gestion del mensajero y
 * `orden_incidente` del admin). Espejo EXACTO de `ApiOrdenEvidenciaRow`: si uno crece y el otro
 * no, `ApiOrdenLecturaService.toDetalleDTO` deja de compilar, que es la idea.
 */
export interface ApiOrdenEvidenciaDTO {
  resultado: "entregada" | "rechazada" | "incidente";
  contentType: string | null;
  url: string; // URL firmada (5 min); NUNCA el storage_path crudo ni el bucket (R16)
  expiraEnSegundos: number;
}

/**
 * ⏳ 2026-09-10 (feature 405) — UNA gestion de la orden en el DETALLE publico del canal.
 *
 * QUE ES. La lista cruda de los desenlaces que se registraron sobre la orden, para que el
 * integrador pueda medir reintentos y tiempos por mensajero en vez de ver solo el resultado
 * final. Es de SOLO LECTURA y ADITIVA: no cambia ni una clave de lo que ya se publicaba.
 *
 * LAS CINCO CLAVES ESTAN SIEMPRE PRESENTES (R3), con `null` donde no aplica. Es la convencion que
 * el canal ya firmo para `data.motivo` del webhook (256): el consumidor no ramifica por «la clave
 * existe». Ni una clave mas: el conjunto EXACTO lo vigila
 * `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts`.
 *
 * ⚠️ `motivo` ES LA CAUSA TIPIFICADA — `gestion_orden.causa_devolucion` (73) o
 * `gestion_orden.causa_incidente` (158), los mismos values que ya viajan en el webhook— y NO es
 * `gestion_orden.motivo` (`db/schema.prisma:1045`), el texto libre que el mensajero teclea sobre
 * un cliente. Ese texto NO sale del sistema por decision expresa (**256/R22**) y esta feature ni
 * siquiera lo proyecta en el `select` de Prisma: la forma mas barata de no filtrar un dato es no
 * leerlo.
 *
 * ⚠️ `mensajero` ES EL ATRIBUIDO A LA GESTION, no siempre quien la registro: las gestiones
 * sinteticas que crea el sistema o la tienda (reprogramacion de escritorio, escalado por plazo,
 * rechazo manual, desenlace de la ayuda, tope de reintento) quedan atribuidas al mensajero de la
 * ultima devolucion vigente. Se emiten igual, y el CHANGELOG del canal lo avisa (R22-b).
 */
export interface ApiOrdenGestionDTO {
  createdAt: Date; // R4: instante del registro, misma serializacion que el `createdAt` de la orden
  resultado: GestionResultado; // R5: value CRUDO de `gestion_resultado`, sin traducir
  estadoResultante: string | null; // R6/R7: destino de la PRIMERA transicion; `null` si no hubo
  motivo: CausaDevolucion | CausaIncidente | null; // R8: causa TIPIFICADA; NUNCA el texto libre
  /**
   * R9 — el MISMO tipo que declara la feature 404 para el mensajero asignado, importado y no
   * redeclarado. La restriccion es que aqui NO es `| null`: `gestion_orden.mensajero_id` es NOT
   * NULL en el esquema, asi que una gestion siempre tiene mensajero. Si la 404 cambiara la forma,
   * esto la sigue sin edicion o deja de compilar.
   */
  mensajero: ApiMensajeroDTO;
}

/** Detalle de UNA orden propia con sus evidencias firmadas (R12/R15/R18). */
export interface ApiOrdenDetalleDTO extends ApiOrdenListItemDTO {
  evidencias: ApiOrdenEvidenciaDTO[]; // [] cuando no hay (R18)
  /**
   * ⏳ 2026-09-10 (feature 405, R1/R2/R11) — las gestiones VIGENTES de la orden, de la mas
   * antigua a la mas reciente (R10). `[]` cuando no hay ninguna: nunca `null` y nunca la clave
   * omitida. Las ANULADAS no entran (R11): incluirlas inflaria justo la metrica de reintento que
   * el integrador pidio medir.
   */
  gestiones: ApiOrdenGestionDTO[];
}

/** Resultado de la CANCELACION (PUT), con el estado anterior y el destino (R19). */
export interface ApiOrdenCancelacionDTO {
  numGuia: number;
  estadoAnterior: string;
  estado: string; // "devolviendo_a_tienda"
}

/**
 * FICHA 320 — Resultado del BORRADO (DELETE) de una orden propia por el canal integrador.
 *
 * Devuelve la IDENTIDAD de lo que se retiro y el estado que tenia al retirarlo. `numGuia` es
 * `null` a proposito y no por descuido: la orden que mas necesita este endpoint es justo la que
 * todavia no tiene guia (nace en `en_preparacion` con fulfillment), y por eso `numRemision` —que
 * es NOT NULL y lo provee el propio integrador— viaja siempre y es el eco fiable de que se borro
 * lo que se pidio borrar.
 *
 * `estado` es el estado que la orden TENIA (borrar no transiciona: el estado no cambia y no se
 * escribe historial). No lleva ningun `eliminada: true`: un campo constante no habilita ninguna
 * decision del cliente —el 200 ya lo dice— y el canal ya retiro uno asi el 2026-08-25 (`generado`).
 */
export interface ApiOrdenEliminacionDTO {
  numGuia: number | null;
  numRemision: string;
  estado: string; // el estatus.value que tenia al borrarse; siempre uno de ESTADOS_ELIMINABLES
}
