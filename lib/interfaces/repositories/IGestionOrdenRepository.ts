import type { GestionCausaDevolucion, GestionResultado, MetodoPagoValue } from "@prisma/client";

// Feature 36 — contrato del repositorio del flujo del mensajero. Persistencia de
// gestion_orden, lectura de "mis asignaciones", transicion "Recoger" en lote y
// puntero de bloqueo 1-a-1. Solo queries Prisma; sin logica de negocio (esa vive
// en MisAsignacionesService). Los `estatusId` destino/origen los resuelve el
// service via IOrdenRepository.findEstatusIdByValue.

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
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  mensajeroAsignadoId: string | null;
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

export interface IGestionOrdenRepository {
  /**
   * R9/R13: ordenes del mensajero (`mensajero_asignado_id = mensajeroId`), no
   * borradas (`deleted_at IS NULL`), cuyo estado esta en `estados`. El filtro por
   * mensajero va en el WHERE (nunca en el cliente). Vacio si `estados` esta vacio.
   */
  findMisAsignaciones(mensajeroId: string, estados: string[]): Promise<MiAsignacionRow[]>;

  /**
   * Feature 61: # de ordenes ENTREGADAS del mensajero (`mensajero_asignado_id =
   * mensajeroId`, estado `entregada`, no borradas). Conteo puro para el KPI del
   * portal; no trae filas.
   */
  contarEntregadas(mensajeroId: string): Promise<number>;

  /**
   * Suma de `montoCobrar` (COD) de las ordenes ENTREGADAS del mensajero (mismas
   * condiciones que `contarEntregadas`: propias, `entregada`, no borradas). Alimenta el
   * KPI "Total a cobrar" (acumulado): junto al COD de `en_ruta` mantiene el total
   * estable al entregar (la orden sale de reparto pero sigue sumando aqui) y lo descuenta
   * cuando se gestiona como reprogramada/devuelta/rechazada (no entra en ningun set).
   * `null` (sin entregadas o montos nulos) cuenta 0.
   */
  sumMontoCobrarEntregadas(mensajeroId: string): Promise<number>;

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
   * la 99 / doble submit -> no-op, sin efectos, R7). NO cuenta como intento (destino
   * `reprogramada`, no `devuelta`, R8) ni genera movimiento de dinero (R10).
   */
  reprogramarDesdeDevuelta(input: ReprogramarDesdeDevueltaInput): Promise<boolean>;
}
