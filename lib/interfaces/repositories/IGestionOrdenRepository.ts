import type {
  GestionCausaDevolucion,
  GestionCausaIncidente,
  GestionResultado,
  GestionUbicacionAusencia,
  MetodoPagoValue,
} from "@prisma/client";

// Feature 36 — contrato del repositorio del flujo del mensajero. Persistencia de
// gestion_orden, lectura de "mis asignaciones", transicion "Recoger" en lote y
// puntero de bloqueo 1-a-1. Solo queries Prisma; sin logica de negocio (esa vive
// en MisAsignacionesService). Los `estatusId` destino/origen los resuelve el
// service via IOrdenRepository.findEstatusIdByValue.

/**
 * Ventana HALF-OPEN `[desde, hasta)` de un dia de Costa Rica, en instantes UTC. Half-open
 * y no `<= hasta` a proposito: es la unica forma de cubrir el dia COMPLETO sin arrastrar el
 * primer instante del siguiente. Misma convencion que `RankingRepository` y que
 * `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (`lib/utils/fecha-cr.ts`).
 */
export interface VentanaDia {
  desde: Date;
  hasta: Date;
}

// Fila de "mis asignaciones" con los nombres legibles ya resueltos (R11): el
// mensajero ve el detalle completo sin exponer IDs de catalogo. Decimales
// (montoCobrar) serializados a number|null. NUNCA expone deletedAt.
export interface MiAsignacionRow {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  peso: number | null;
  montoCobrar: number | null;
  /**
   * Feature 97: coordenadas geocodificadas de la parada (feature 91: `orden.latitud`/
   * `orden.longitud`, `Decimal(10,7)`). Serializadas a number|null con el MISMO patron que
   * `montoCobrar` (`.toNumber()` con guarda de null). `null` = orden aun sin geocodificar.
   */
  latitud: number | null;
  longitud: number | null;
  notas: string | null;
  tiendaNombre: string;
  /**
   * Feature 157 (R15): telefono de la tienda dueña, para que el mensajero pueda contactarla
   * antes de ir a recolectar. `null` si no lo tiene registrado. No confundir con
   * `telefonoDest`, que es el del destinatario final.
   *
   * Opcional (`?`) por el mismo patron aditivo que el DTO: no rompe los fixtures que
   * construyen `MiAsignacionRow` sin el; el repo SIEMPRE lo emite.
   */
  tiendaTelefono?: string | null;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  mensajeroAsignadoId: string | null;
  /**
   * Feature 246 (T3.7, R35) — dia de reparto CRUDO de la orden (`@db.Date`: medianoche UTC de la
   * fecha calendario CR). `null` = orden anterior a la feature, o sin reserva.
   *
   * Viaja crudo a proposito: quien decide si es «para mañana» es el SERVICIO, que tiene reloj
   * (R26). Un repositorio que devolviera ya el booleano tendria que leer la hora, y entonces dos
   * filas del mismo listado podrian caer a distinto lado de la medianoche.
   *
   * Opcional (`?`) por el patron aditivo del repo (igual que `tiendaTelefono?`): no rompe los
   * fixtures que construyen `MiAsignacionRow` sin el; el repo SIEMPRE lo emite.
   */
  fechaReparto?: Date | null;
  // Feature 235 (T6.1, R40): aqui vivia `ayuda?: boolean`. Se retira con la columna; `estatusValue`
  // es la unica fuente de verdad sobre si hay una solicitud de ayuda viva.
}

// Fila proyectada por id para validar recoger/gestionar (R17/R18/R31). INCLUYE
// borradas (deletedAt !== null) para que el service distinga "no existe"/"borrada"
// y reporte el motivo exacto. Trae `mensajeroAsignadoId` (guardia de propiedad) y
// `montoCobrar` (validacion (h) monto == montoCobrar en ENTREGADA).
export interface OrdenGestionRow {
  id: string;
  estatusValue: string;
  deletedAt: Date | null;
  mensajeroAsignadoId: string | null;
  montoCobrar: number | null;
  /**
   * Feature 47/R5 (insumo): zona de la orden para derivar la bodega responsable de un
   * reintento (`en_bodega_central`/`en_bodega_satelite` via `resolverDestinoCierre`). `null` =
   * orden sin zona -> el service cae al fallback central (`en_bodega_central`).
   */
  zonaId: string | null;
}

// Datos de la gestion a insertar (R23/R26/R28/R30). Campos nullable segun el
// `resultado`; el service arma este objeto tras validar cada rama.
export interface GestionOrdenData {
  resultado: GestionResultado;
  montoRecibido?: number | null;
  metodoPago?: MetodoPagoValue | null;
  /**
   * Feature 119 (R12): columnas singulares CONSERVADAS como PORTADA (indice 0). Las escrituras
   * nuevas ya NO las fijan aqui: el repo las DERIVA de `evidencias` (indice 0) en el mismo
   * INSERT. Se mantienen en el tipo por retro-compat (un caller que aun pase la portada suelta
   * sigue funcionando: el repo cae a estos campos si `evidencias` viene vacio).
   */
  evidenciaStoragePath?: string | null;
  evidenciaContentType?: string | null;
  /**
   * Feature 119 (R1/R2): evidencias 1..N de la gestion, cada una con su `indice` 0-based
   * (0 = portada). El repo inserta N filas hijas en `gestion_orden_evidencia` dentro de la
   * MISMA transaccion (R9) y DERIVA de la de indice 0 las columnas singulares (dual-write, R12).
   */
  evidencias?: { storagePath: string; contentType: string; indice: number }[];
  /**
   * Feature 212 (R17/R20): DESGLOSE del recaudo, 0..N lineas `(metodo, monto)`. El repo las
   * inserta en `gestion_orden_pago` dentro de la MISMA transaccion que la gestion y la
   * transicion (patron de las evidencias de la 119): viaja DENTRO de `GestionOrdenData`, asi
   * que `crearGestionYTransicionar` NO cambia de firma y la atomicidad ya provista se conserva.
   *
   * `monto` entra como `number` y se persiste como `Decimal(12,2)` —la misma escala que
   * `monto_recibido`— sin pasar por aritmetica de coma flotante (R20/R30). Lista vacia o
   * ausente = ninguna linea (entrega SIN cobro, R14; o cualquier resultado que no sea entrega).
   */
  pagos?: { metodo: MetodoPagoValue; monto: number }[];
  motivo?: string | null;
  /** Fecha (YYYY-MM-DD) de reprogramacion; se persiste como columna DATE. */
  fechaReprogramacion?: string | null;
  /**
   * Feature 73/R11: causa tipificada de la DEVOLUCION. Nullable por rama como los demas:
   * el service solo la arma en `resultado = devuelta` (la obligatoriedad ya la exigio el
   * borde, R6). Viaja DENTRO de `GestionOrdenData` -> `crearGestionYTransicionar` NO
   * cambia su firma y la atomicidad de R13 se conserva tal cual.
   */
  causaDevolucion?: GestionCausaDevolucion | null;
  /**
   * Feature 158/R9: causa tipificada del INCIDENTE. Nullable por rama como las demas: el
   * service solo la arma en `resultado = incidente` (la obligatoriedad ya la exigio el borde,
   * R9). Viaja DENTRO de `GestionOrdenData` -> `crearGestionYTransicionar` NO cambia su firma
   * y la atomicidad de R6 se conserva tal cual.
   *
   * OJO: `indemnizacion` NO viaja aqui. El monto NO existe al crear la gestion — lo captura el
   * admin al APROBAR el cierre (R19/R22), en otra transaccion y por otro camino.
   */
  causaIncidente?: GestionCausaIncidente | null;
  /**
   * Feature 193 (R1/R6): DONDE estaba el mensajero al registrar la gestion, o —si la captura
   * fallo por una causa TECNICA— por que no se pudo saber (R18). Viajan DENTRO de
   * `GestionOrdenData` como el resto, asi que `crearGestionYTransicionar` NO cambia su firma
   * y la atomicidad se conserva tal cual.
   *
   * Las tres admiten solo DOS combinaciones validas: `(lat, lng, null)` o `(null, null,
   * motivo)`. La regla la impuso el borde (`gestionarSchema`, R8-R12); aqui no se revalida
   * porque el repo no es el sitio donde vive una regla de negocio, y duplicarla crearia dos
   * verdades sobre lo mismo.
   *
   * La DENEGACION del permiso no llega nunca hasta aqui: no existe como valor del enum, asi
   * que el borde la rechaza antes (R12/R19).
   */
  ubicacionLat?: number | null;
  ubicacionLng?: number | null;
  ubicacionAusencia?: GestionUbicacionAusencia | null;
}

// Feature 100 (design §2.1) — entrada de la REPROGRAMACION por la tienda. Los estatus ya vienen
// resueltos por el service (`findEstatusIdByValue`): `estatusDevueltaId` como guarda de
// idempotencia/concurrencia (R7/R21) y `estatusReprogramadaId` como destino (R2). `motivo` es
// OPCIONAL (gate F1.4-Q1: la fecha es el dato critico). `actorUsuarioId` = el adminTienda (R11).
export interface ReprogramarDesdeDevueltaInput {
  ordenId: string;
  estatusDevueltaId: string; // guarda: solo actua si la orden sigue en `devuelta`
  estatusReprogramadaId: string; // destino de la transicion
  fechaReprogramacion: string; // YYYY-MM-DD; se persiste como columna DATE en la gestion
  motivo: string | null; // OPCIONAL (Q1)
  actorUsuarioId: string; // R11: el adminTienda que reprograma
}

/**
 * Feature 240 (design §4.2, D1/D5, R3/R4/R8/R9/R11/R12) — entrada del RECHAZO MANUAL de la tienda
 * sobre una devolucion anclada. Hermana exacta de `ReprogramarDesdeDevueltaInput`: mismo estado de
 * ORIGEN, misma derivacion del mensajero, misma forma de escritura. Cambian tres cosas —el destino,
 * el `resultado` de la gestion y la familia del historial— y una cuarta que si es una decision:
 *
 * ⚠️ `motivo` es OBLIGATORIO aqui (`string`, no `string | null`), al reves que en la reprogramacion
 * (D5, firmada). No es simetria: es la UNICA linea que explica por que se decidio un rechazo que se
 * cobra, y el dato que alguien pedira el dia de la primera disputa. La reprogramacion puede
 * permitirselo opcional porque su dato critico es la fecha y no mueve dinero; esta si.
 *
 * NO lleva evidencia en imagen, y tambien es una decision (D5/R13): el paquete YA volvio a la
 * bodega y YA se escaneo al aprobar el cierre (238), asi que pedirle a la tienda una foto seria
 * pedirle la foto de algo que no tiene delante.
 */
/**
 * Feature 240 (T10, R10) — LA ORDEN ESTA EN LA DEVOLUCION ANCLADA PERO NO TIENE NINGUNA GESTION
 * `devuelta` VIGENTE de la que derivar el mensajero.
 *
 * Es un estado que NO DEBERIA EXISTIR: a `devuelta` solo se llega aprobando el cierre que contiene
 * la gestion `devuelta` (feature 239), asi que la gestion siempre esta. Medido en produccion el
 * 2026-08-20: **11 ordenes han pasado por `devuelta` y las 11 tienen su gestion** — cero sin ella,
 * ni siquiera anulada. Se llega aqui solo si alguien mueve el `estatus_id` a mano.
 *
 * POR QUE ES UN `throw` Y NO UN VALOR DE RETORNO, que es la pregunta obvia: este metodo ya escribio
 * el `updateMany` cuando lo descubre. Un `return` dejaria la orden en `rechazada` SIN gestion y SIN
 * historial — peor que el estado del que venimos. Lanzar **aborta la transaccion** y lo revierte
 * todo. Es fallo CERRADO y se queda asi.
 *
 * ⚠️ POR QUE TIENE CLASE PROPIA Y NO ES UN `Error` PELADO, que es lo que era hasta el 2026-08-20:
 * un `Error` generico sube hasta `withErrorHandler`, sale como `INTERNAL`, y
 * `toResolverNovedadActionError` **lanza** al no reconocer ese codigo. Resultado medido en el
 * recorrido: la tienda pulsa «Rechazar» con su motivo escrito y **no pasa absolutamente nada** —ni
 * la orden cambia, ni sale un aviso—. Un boton mudo, que es EL DEFECTO QUE ESTA FICHA VINO A
 * CERRAR, una capa mas abajo. Con la clase, el service lo distingue de una caida de base y lo
 * convierte en un desenlace que la pantalla sabe pintar.
 *
 * El mensaje es para el REGISTRO, no para nadie: sin datos personales, sin el motivo escrito por la
 * tienda y sin el id de la orden (R46). Lo que ve la persona lo decide la pantalla.
 */
export class SinGestionDevueltaError extends Error {
  constructor(llamador: string) {
    super(`${llamador}: sin gestion \`devuelta\` vigente para derivar el mensajero`);
    this.name = "SinGestionDevueltaError";
  }
}

export interface RechazarDesdeDevueltaInput {
  ordenId: string;
  /** GUARDA del `updateMany` (R3/R4): la orden tiene que seguir en la devolucion anclada. */
  estatusDevueltaId: string;
  /** Destino, resuelto por el service desde el catalogo (`findEstatusIdByValue`), no por nombre. */
  estatusRechazadaId: string;
  /** R12/D5: OBLIGATORIO. Se conserva en la gestion Y en la fila de historial. */
  motivo: string;
  /** R11: la persona de la TIENDA que decidio. Solo va al historial, nunca a la gestion. */
  actorUsuarioId: string;
}

/**
 * Feature 237 (design §4.4, R2/R3/R4/R5/R9/R24) — entrada de LA GESTION QUE REGISTRA LA TIENDA
 * desde la pestaña de ayuda. Los dos estatus vienen ya resueltos por el service
 * (`findEstatusIdByValue` + `ESTATUS_POR_RESULTADO`), como en `ReprogramarDesdeDevueltaInput`.
 *
 * ⚠️ LOS DOS IDS DE USUARIO SON PERSONAS DISTINTAS, y ese es el corazon de la ficha:
 *   - `mensajeroId` = el mensajero ASIGNADO a la orden. Es a quien se ATRIBUYE la gestion
 *     (`gestion_orden.mensajero_id`) y, por tanto, EN QUE CIERRE CAE: `crearCierre` vincula por
 *     `{ mensajeroId, cierreId: null, anuladaAt: null }` y `findGestionesPendientes` filtra igual.
 *     💰 Si aqui entrara el id de la tienda, la fila NO se vincularia a ningun cierre NUNCA:
 *     quedaria fuera de los cinco feeds de dinero, fuera del snapshot, fuera del escaneo de la
 *     confirmacion fisica (238) y fuera del conteo de intentos. La ficha dejaria de cumplirse sin
 *     que nada fallara. Es la mutacion T8.1 y por eso R3 es un requisito de DINERO.
 *   - `actorUsuarioId` = el adminTienda que lo REGISTRO. Va al historial
 *     (`orden_historial_estado.actor_usuario_id`, R4) y es la unica evidencia de quien decidio el
 *     rechazo que se le cobra a la tienda. No se persiste en ninguna columna nueva: ya esta ahi.
 */
export interface CrearGestionDesdeAyudaInput {
  ordenId: string;
  /** GUARDA del `updateMany` (R23/R24): la orden tiene que seguir en el estatus de ayuda. */
  estatusAyudaId: string;
  /** Destino, del mapa unico `ESTATUS_POR_RESULTADO` (239). NO de la identidad de nombre (R26). */
  estatusDestinoId: string;
  /** R3: a QUIEN se atribuye la gestion -> en que cierre cae. El MENSAJERO, no la tienda. */
  mensajeroId: string;
  /** R4: QUIEN la registro. La TIENDA. Solo va al historial. */
  actorUsuarioId: string;
  /** `resultado` + `motivo` + `evidencias` (+ `fechaReprogramacion`), ya validados en el borde. */
  gestion: GestionOrdenData;
}

export interface IGestionOrdenRepository {
  /**
   * R9/R13: ordenes del mensajero (`mensajero_asignado_id = mensajeroId`), no
   * borradas (`deleted_at IS NULL`), cuyo estado esta en `estados`. El filtro por
   * mensajero va en el WHERE (nunca en el cliente). Vacio si `estados` esta vacio.
   */
  findMisAsignaciones(mensajeroId: string, estados: string[]): Promise<MiAsignacionRow[]>;

  /**
   * 2026-08-11: las MISMAS filas, resueltas por ID en vez de por estado, con las MISMAS dos
   * guardias en el WHERE (propiedad + no borradas). La consume «Recolectadas hoy», que sale del
   * historial —solo tiene ids— y desde que pinta la card compartida necesita el resto de los
   * datos de la orden. Vacio si `ids` esta vacio.
   */
  findMisAsignacionesByIds(mensajeroId: string, ids: string[]): Promise<MiAsignacionRow[]>;

  /**
   * Feature 61: # de ordenes ENTREGADAS del mensajero (`mensajero_asignado_id =
   * mensajeroId`, estado `entregada`, no borradas). Conteo puro para el KPI del
   * portal; no trae filas.
   *
   * ACOTADO AL DIA por `dia`: la misma formula de siempre mas la condicion de que la
   * orden tenga una gestion VIGENTE (`anuladaAt IS NULL`) con resultado `entregada`
   * registrada dentro de la ventana. La ventana es la del DIA de Costa Rica —half-open
   * `[desde, hasta)`, misma convencion que `RankingRepository`— y la calcula el service,
   * no el repo: asi el conteo es determinista y testeable sin congelar el reloj aqui.
   * Se ancla en la GESTION y no en la orden porque la orden no tiene `entregada_at`:
   * `updatedAt` la mueve cualquier edicion posterior y mentiria sobre el dia.
   */
  contarEntregadas(mensajeroId: string, dia: VentanaDia): Promise<number>;

  /**
   * Suma de `montoCobrar` (COD) de las ordenes del mensajero YA GESTIONADAS dentro de
   * `dia`, con CUALQUIER resultado (entregada, reprogramada, devuelta, rechazada,
   * incidente) y ya fuera de `en_reparto`. Es la mitad "cerrada" del KPI "Total a
   * cobrar"; la otra mitad —las que siguen en reparto— la calcula el service sumando la
   * lista que ya tiene en memoria, sin volver a la base.
   *
   * Las dos mitades son DISJUNTAS por construccion (esta excluye `en_reparto`), asi que
   * sumarlas no puede contar dos veces una orden gestionada y devuelta a reparto el mismo
   * dia. `null` (sin gestionadas o montos nulos) cuenta 0.
   */
  sumMontoCobrarGestionadas(mensajeroId: string, dia: VentanaDia): Promise<number>;

  /**
   * R27/R31: filas por id para validar transiciones. INCLUYE borradas; el service
   * decide propiedad/origen. Vacio si `ids` esta vacio.
   */
  findByIdsParaGestion(ids: string[]): Promise<OrdenGestionRow[]>;

  /** R20: la orden activa en gestion del mensajero (`orden_en_gestion_id`) o null. */
  getOrdenEnGestion(mensajeroId: string): Promise<string | null>;

  /**
   * R19-R21: fija `usuario.orden_en_gestion_id = ordenId` de forma condicional e
   * idempotente: solo si el puntero estaba NULL o ya apuntaba a esa orden.
   * Devuelve `true` si tras la operacion el puntero apunta a `ordenId`; `false` si
   * el mensajero ya tenia OTRA orden activa (conflicto, sin efectos).
   */
  setOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean>;

  /**
   * R35: libera `usuario.orden_en_gestion_id` del PROPIO mensajero SOLO si apunta
   * a `ordenId` (WHERE con `id = mensajeroId` y `orden_en_gestion_id = ordenId`).
   * Concurrencia-seguro: nunca toca el puntero de otro actor ni limpia si apunta a
   * otra orden. Devuelve `true` si limpio una fila (`count > 0`); `false` si no
   * habia nada que limpiar (idempotente).
   */
  liberarOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean>;

  /**
   * R15/R16: transiciona en lote de `origenEstatusId` a `destinoEstatusId` SOLO
   * las ordenes de `ordenIds` que pertenecen al mensajero y estan en el origen
   * (guardia de propiedad + origen en el WHERE). Devuelve el numero de filas
   * afectadas. El llamador DEBE haber validado el lote (R17) antes de invocar.
   */
  recogerLote(
    ordenIds: string[],
    mensajeroId: string,
    origenEstatusId: string,
    destinoEstatusId: string,
  ): Promise<number>;

  /**
   * R23/R26/R28/R30: bajo prisma.$transaction (todo-o-nada): (a) INSERT en
   * gestion_orden con los campos de `gestion`, (b) UPDATE orden.estatus_id =
   * `nuevoEstatusId`, (c) UPDATE usuario.orden_en_gestion_id = NULL (libera el
   * bloqueo 1-a-1, R19). Sin logica de negocio: el service valida propiedad/origen
   * y sube la evidencia ANTES de invocar. Devuelve el id de la gestion creada.
   *
   * Feature 99 (R1/R29): la rama `devuelta` transiciona la orden a `devuelta` y la DEJA ahi
   * (SIN transicion de seguimiento inmediata). El reintento a bodega / escalado a `rechazada`
   * que la feature 47 aplicaba aqui se RELOCALIZO al cron SLA (`DevolucionSlaService`); por
   * eso este metodo ya no acepta el parametro `seguimiento`. La devolucion se contabiliza como
   * intento por el append a `devuelta` del choke point (R2).
   */
  crearGestionYTransicionar(input: {
    ordenId: string;
    mensajeroId: string;
    gestion: GestionOrdenData;
    nuevoEstatusId: string;
  }): Promise<string>;

  /**
   * Feature 100 (design §2.1, R2/R3/R5/R11/R20/R21): reprograma UNA orden en `devuelta` a
   * `reprogramada`. Bajo `prisma.$transaction` (todo-o-nada): (a) UPDATE guardado por
   * `estatus_id = devuelta` + no borrada -> `reprogramada` (R21); (b) SOLO si afecto una fila,
   * crea la gestion sintetica `resultado = reprogramada` con `fecha_reprogramacion` y `motivo`
   * (opcional), atribuida al `mensajero_id` de la ULTIMA gestion `devuelta` VIGENTE de la orden
   * leida DENTRO de la tx (R5); (c) appendea la transicion via el choke point de la 49
   * (`actor = adminTienda`, `origen_tipo = reprogramacion_tienda`, enlazando la gestion, R11).
   * Sin logica de negocio (el service valida rol/tienda/estado y resuelve los estatus). Devuelve
   * `true` si transiciono; `false` si la orden ya salio de `devuelta` (carrera con el cron SLA de
   * la 99 / doble submit -> no-op, sin efectos, R7). No genera movimiento de dinero (R10).
   *
   * NO CUENTA COMO INTENTO por su ORIGEN, NO por su destino (feature 215/R12/R28/R34). Aqui se
   * leia «destino `reprogramada`, no `devuelta`»: eso es FALSO desde la 215 —`reprogramada` SI
   * esta en `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`—. Lo que la excluye es que su fila de historial
   * nace con `origen_tipo = reprogramacion_tienda`, fuera de `ORIGEN_TIPOS_VISITA_REAL` (la sexta
   * condicion de `whereIntentosVigentes`). Meter esa familia en la lista de origenes creyendo que
   * el destino protege hace que la orden sume de mas, escale antes de tiempo y cobre un
   * `cobroRechazado` (56, dinero real) antes de lo debido; el porque completo esta en el docstring
   * de `GestionOrdenRepository.reprogramarDesdeDevuelta`.
   */
  reprogramarDesdeDevuelta(input: ReprogramarDesdeDevueltaInput): Promise<boolean>;

  /**
   * 💰 Feature 240 (design §4.2, D1/D8, R3/R4/R5/R8/R9/R10/R11/R12/R14/R15/R16/R18/R21) — RECHAZA
   * a mano UNA orden en la devolucion anclada. La MISMA transaccion, con los mismos cuatro pasos,
   * que `reprogramarDesdeDevuelta` (comparten el helper privado `transicionarDesdeDevuelta`):
   *   (a) UPDATE guardado por `{ id, estatus_id = devuelta, deleted_at IS NULL }` -> `rechazada`.
   *       La comprobacion del estado de origen va EN LA MISMA SENTENCIA que lo muta (R4), asi que
   *       no queda ventana entre comprobar y escribir. `count === 0` ⇒ `false` SIN NINGUN EFECTO
   *       (R3), y con eso la idempotencia sale gratis (R5): el segundo envio encuentra la orden ya
   *       fuera de `devuelta`. No hay codigo de idempotencia porque un segundo mecanismo puede
   *       divergir del primero.
   *   (b) gestion sintetica `resultado = rechazada` con `cierre_id NULL` (R8/R18) y `motivo`
   *       (R12), atribuida al `mensajero_id` de la ULTIMA gestion `devuelta` VIGENTE (R9). Sin esa
   *       gestion ⇒ ABORTA la transaccion (R10): no se inventa un actor.
   *   (c) append por el choke point de la 49: actor = LA TIENDA, `origen_tipo = rechazo_tienda`,
   *       enlazando la gestion (R11/R15).
   *
   * 💰 POR QUE CREA GESTION Y NO SOLO CAMBIA EL ESTADO (D1, firmada): el paquete no se entrega y
   * vuelve por el flujo de devolucion exactamente igual que si el plazo lo hubiera escalado dos
   * horas despues, asi que la bodega gana el mismo `cobroRechazado` (56). Sin la gestion, rechazar
   * a mano saldria GRATIS y esperar al plazo costaria —sobre el mismo paquete—, y ademas la fila no
   * entraria en ningun cierre: nadie podria auditar quien decidio el retorno.
   *
   * ⚠️ EL `mensajero_id` ES EL DEL MENSAJERO, NUNCA EL DE LA TIENDA (R9), y no es cosmetico: es lo
   * que mete la fila en un cierre (`crearCierre` vincula por `{ mensajeroId, cierreId: null }`).
   * Con el id de la tienda ahi, la gestion NO se vincularia a ningun cierre nunca y el rechazo
   * seria invisible y gratis. Quien decidio va al historial, en `actor_usuario_id`.
   *
   * NO CUENTA COMO INTENTO por su ORIGEN (R19): `rechazo_tienda` esta FUERA de
   * `ORIGEN_TIPOS_VISITA_REAL`, igual que `reprogramacion_tienda` y por la misma razon — la orden
   * YA TIENE contada su gestion `devuelta` real, y sumarla da el doble conteo de 160/R2.
   *
   * NO emite ningun movimiento de dinero en este instante (R18): el `cierre_id NULL` es lo que
   * deja que los cinco feeds la cobren cuando se apruebe el cierre que la recoja, por el mismo
   * mecanismo que cualquier gestion del mensajero.
   *
   * Devuelve `true` si transiciono; `false` si la orden ya salio de `devuelta` (carrera con el cron
   * de la 99, o segundo envio). En esa rama el cron tampoco cobra dos veces: si gana la tienda,
   * `escalarDevueltaSla` encuentra `count = 0` y no crea su gestion sintetica (R21).
   */
  rechazarDesdeDevuelta(input: RechazarDesdeDevueltaInput): Promise<boolean>;

  /**
   * Feature 237 (design §4.4, T5.1) — registra en UNA transaccion la gestion que LA TIENDA
   * resuelve desde la pestaña de ayuda, atribuida al MENSAJERO de la orden.
   *
   * En este orden, y el orden importa:
   *   1. `updateMany` GUARDADO por `{ id, estatusId: estatusAyudaId, deletedAt: null }` ->
   *      `estatusDestinoId`. La comprobacion del estado de origen va EN LA MISMA SENTENCIA que lo
   *      muta (R24), asi que no hay ventana entre comprobar y escribir: sobre esta fila hay DOS
   *      actores (el mensajero puede recuperarla, el corte de la noche puede llevarsela) y la
   *      guarda en el service seria una lectura optimista, no una barrera.
   *      `count === 0` ⇒ devuelve `null` SIN EFECTOS: ni gestion, ni evidencias, ni historial
   *      (R25). Y con eso la IDEMPOTENCIA sale gratis (R28): el segundo envio encuentra la orden
   *      ya fuera de ayuda. No hay codigo de idempotencia porque un segundo mecanismo puede
   *      divergir del primero.
   *   2. `gestion_orden` con `mensajeroId` = el mensajero y `cierreId: null` (R3/R9). El `NULL` es
   *      lo que deja que la vincule EL MISMO mecanismo que vincula las del mensajero, sin camino
   *      propio.
   *   3. las N filas de `gestion_orden_evidencia`, en la MISMA tx (R2/R15).
   *   4. `appendCambioEstado` por el choke point (R4/R5): actor = LA TIENDA,
   *      `origen_tipo = gestion_tienda_ayuda`, enlazando la gestion.
   *
   * LO QUE **NO** HACE, y cada ausencia es una decision (design §4.2):
   *   - NO toca `usuario.orden_en_gestion_id` (R10). `crearGestionYTransicionar` si lo limpia,
   *     pero copiar ese bloque aqui le ARRANCARIA AL MENSAJERO OTRA ORDEN que estuviera
   *     gestionando: una orden en ayuda no puede ser su orden en gestion —`escogerParaGestion`
   *     exige `en_reparto` y la solicitud de ayuda ya libero el puntero (235/R7)— asi que el
   *     puntero apunta a otra cosa. Es un fallo, no una diferencia de estilo.
   *   - NO toca `mensajero_asignado_id` ni `prioridad` (R10), NO escribe ningun importe (R11), NO
   *     escribe ubicacion (R18: la tienda gestiona desde un escritorio) y NO encola
   *     reoptimizacion de ruta (la orden salio de la ruta al entrar en ayuda; `transicionarAyuda`
   *     tampoco encola: paridad deliberada).
   *
   * Devuelve el id de la gestion creada, o `null` si la orden ya no estaba en ayuda.
   */
  crearGestionDesdeAyuda(input: CrearGestionDesdeAyudaInput): Promise<string | null>;
}
