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
//
// ⏳ 2026-09-10 (feature 415) — LA PALABRA «zona» DE LA LINEA DE ARRIBA NO SE RETIRA, SE ACOTA.
// En este sistema «zona» nombra DOS cosas distintas y la frase anterior solo habla de la primera:
//   - la zona DEL MENSAJERO (`usuario.zona_id`): en que zona trabaja esa persona. Es un dato
//     PERSONAL suyo y sigue SIN publicarse, igual que su telefono, su email, su cedula, su foto y
//     su vehiculo. La exclusion de arriba sigue siendo verdad palabra por palabra.
//   - la zona DE LA ORDEN (`orden.zona_id`): a donde va el paquete. Es un dato OPERATIVO del
//     envio, no de una persona, y ESTA feature SI la publica —`{id, nombre}` y nada mas— al DUENO
//     de la orden, porque el integrador necesita medir su operacion por zona.
// Lo mismo con el dinero: esta feature publica `costoEstimado` y `costoReal` de la orden, que son
// lo que a ESA tienda se le cobra por ESE paquete. No abre ninguna via a una orden ajena: el
// `ownerId` forzado de 106/R4 no se toca.

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

/**
 * ⏳ 2026-09-10 (feature 415, R1/R3/R4/R6) — la ZONA DE LA ORDEN en el canal publico.
 *
 * QUE ES. El DESTINO del paquete (`orden.zona_id` -> `zona`), **no** la zona en la que trabaja el
 * mensajero (`usuario.zona_id`), que es un dato personal suyo y sigue excluida (R6). Las dos se
 * llaman «zona» en este sistema y confundirlas es el error facil: ver la cabecera del archivo.
 *
 * `id` es `zona.id` (`String @id @default(uuid())`, `db/schema.prisma`): ESTABLE en el tiempo, no
 * se regenera y NUNCA se reasigna a otra zona (R3). Es la clave por la que se agrupa.
 *
 * `nombre` es `zona.nombre` del catalogo TAL CUAL: no se deriva, no se traduce, no se recorta y no
 * se normaliza (R4). Es texto **para MOSTRAR** y **puede cambiar** —un renombrado de «FGAM El
 * Coco» a «FGAM Coco» parte en dos la serie de quien agrupe por el—, asi que **no se agrupa por
 * `nombre`**. Es la MISMA regla que ya rige para `ApiMensajeroDTO.nombre`.
 *
 * DOS CLAVES Y NINGUNA MAS (R5): ni `esCentral` / marca de GAM, ni subzona, ni marca de zona
 * especial del distrito, ni cobro por vehiculo, ni la geografia (provincia, canton, distrito).
 *
 * POR QUE NO SE REUTILIZA `ApiMensajeroDTO` aunque la forma coincida (design §13): son DOS
 * conceptos distintos que hoy coinciden en estructura. Fusionarlos haria que un cambio en uno
 * arrastrara al otro en silencio —y el del mensajero es PII, con su propia decision firmada—. Lo
 * que SI se comparte es la REGLA publicada («agrupa por `id`»), y eso vive en el contrato, no en
 * el tipo.
 */
export interface ApiZonaDTO {
  id: string; // zona.id (UUID). Estable; nunca se reasigna.
  nombre: string; // zona.nombre del catalogo, tal cual. Texto para MOSTRAR; puede cambiar.
}

/**
 * ⏳ 2026-09-10 (feature 415, R10/R11/R12/R13/R15) — lo que UNA orden le cuesta a su tienda,
 * desglosado en los CINCO conceptos que factura Ordenex.
 *
 * ESCENARIO **ENTREGADA** (R15), y hay que leerlo asi: los cinco importes responden «¿cuanto
 * cuesta este paquete SI SE ENTREGA?». NO son «la linea que entro en tu wallet»: una orden
 * RECHAZADA factura el flete de DEVOLUCION y su IVA, que son conceptos distintos y que el canal
 * publica en el escenario `devuelto` de la cotizacion.
 *
 * CINCO CLAVES EXACTAS Y NINGUNA MAS (R10). En particular **NO hay ningun campo que sume los
 * cinco, ni con el nombre `total` ni con otro** (R11 / design §D4): el unico `total` que este canal
 * publica hoy es el de `CotizacionEscenarioEntregado`, y significa lo CONTRARIO —«lo que RECIBE la
 * tienda» = monto a cobrar menos los cinco conceptos—. Dos `total` de signo opuesto en el mismo
 * canal es exactamente la ambiguedad que esta prohibicion existe para evitar; con otro nombre
 * seria la misma ambiguedad con disfraz. El integrador suma los cinco: son suyos y sabe que suma.
 *
 * CADENAS money-safe de escala 2 (R12): `"2500.00"`, punto decimal, sin simbolo de moneda y sin
 * separador de miles. El MISMO dialecto que los importes de la cotizacion y el `costoEnvio` de la
 * carga, para que el integrador no tenga que aprender dos.
 *
 * NINGUN concepto es `null` (R13): uno que no aplica a esa orden —una orden con
 * `cobra_comision = false` no paga comision— sale como `"0.00"` explicito, que es un cero
 * AFIRMADO. La ausencia se declara en el campo que CONTIENE este objeto, no dentro de el.
 */
export interface ApiOrdenCostoDTO {
  flete: string; // MONTO escala 2
  iva: string; // MONTO escala 2 (IVA del flete)
  comision: string; // MONTO escala 2 (comision COD)
  ivaComision: string; // MONTO escala 2 (IVA de la comision COD)
  fulfillment: string; // MONTO escala 2 (monto fijo por orden cuando el paquete sale de bodega)
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
  /**
   * ⏳ 2026-09-10 (feature 415, R1/R2) — la zona DE LA ORDEN (el destino del paquete).
   *
   * ⚠️ LA UNICA DIFERENCIA CON `mensajero`, y se declara porque es la unica: **`zona` NUNCA es
   * `null`**. `orden.zona_id` es NOT NULL en el esquema, asi que toda orden tiene zona; el
   * mensajero ASIGNADO si puede faltar. Las dos entidades con nombre de este payload viajan con
   * la MISMA forma `{id, nombre}` y se agrupan por la MISMA regla: por `id`, nunca por `nombre`.
   * `ApiOrdenDetalleDTO` lo hereda.
   */
  zona: ApiZonaDTO;
  /**
   * ⏳ 2026-09-10 (feature 415, R9/R19/R22/R23) — lo que costaria ESTA orden con la tarifa
   * VIGENTE de hoy para el par (tu tienda, la zona de la orden), en el escenario ENTREGADA.
   *
   * **PUEDE CAMBIAR ENTRE DOS LECTURAS** mientras `costoReal` sea `null`: se calcula con la
   * tarifa de HOY y `tarifas` no tiene historico (se edita en sitio). Es el motivo de que existan
   * dos campos y no uno.
   *
   * `null` significa «no hay ninguna tarifa configurada para tu tienda en esa zona», y **NO**
   * significa envio gratis. Nunca sale como cinco `"0.00"` (R22 / design §D7): en un borde que
   * sirve precios, un `0.00` no es un dato faltante, es una MENTIRA sobre dinero servida como
   * precio (decision del humano del 2026-08-24, `tests/integration/asimetria-sin-tarifa.test.ts`).
   * La clave viaja SIEMPRE: `null` explicito, nunca omitida (R9).
   */
  costoEstimado: ApiOrdenCostoDTO | null;
  /**
   * ⏳ 2026-09-10 (feature 415, R9/R25/R26/R28) — lo que se CONGELO al cerrar: la tarifa y las
   * entradas que quedaron guardadas cuando la orden entro en un cierre APROBADO. Ya no se mueve
   * (salvo que la orden entre en un SEGUNDO cierre aprobado, design §D6).
   *
   * ⚠️ Es el escenario de **ENTREGA**, NO «la linea que entro en tu wallet» (R15): un rechazo
   * factura el flete de devolucion y su IVA, que no son estos importes.
   *
   * `null` significa «esta orden todavia no ha entrado en ningun cierre aprobado». La clave viaja
   * SIEMPRE (R9).
   *
   * ⚠️ ASIMETRIA DELIBERADA CON `costoEstimado`, y no es una inconsistencia (design §D7/§D8): si
   * la fila congelada no tiene tarifa, esto sale con los cinco conceptos en `"0.00"` y **no**
   * `null`. Ahi el cero es VERDAD —ese cierre liquido cero por esos conceptos—, mientras que un
   * cero en el estimado prometeria un envio gratis que si se cobrara en cuanto haya tarifa. Mismo
   * hueco de datos, dos significados, dos respuestas; la regla que las une es decir la verdad
   * sobre dinero.
   */
  costoReal: ApiOrdenCostoDTO | null;
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
