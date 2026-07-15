import type { GestionResultado, MetodoPagoValue } from "@prisma/client";

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
   * reintento (`en_bodega`/`en_bodega_satelite` via `resolverDestinoCierre`). `null` =
   * orden sin zona -> el service cae al fallback central (`en_bodega`).
   */
  zonaId: string | null;
}

// Datos de la gestion a insertar (R23/R26/R28/R30). Campos nullable segun el
// `resultado`; el service arma este objeto tras validar cada rama.
export interface GestionOrdenData {
  resultado: GestionResultado;
  montoRecibido?: number | null;
  metodoPago?: MetodoPagoValue | null;
  evidenciaStoragePath?: string | null;
  evidenciaContentType?: string | null;
  motivo?: string | null;
  /** Fecha (YYYY-MM-DD) de reprogramacion; se persiste como columna DATE. */
  fechaReprogramacion?: string | null;
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
   * Feature 47/R6/R7/R10/R11: `seguimiento` opcional. Cuando el resultado es `devuelta`,
   * el service resuelve la transicion de SEGUIMIENTO (destino `en_bodega`/
   * `en_bodega_satelite` para reintentar, o `rechazada` para escalar) y este metodo la
   * aplica en la MISMA transaccion, tras registrar la transicion a `devuelta`: un segundo
   * `orden.update` (limpiando `mensajeroAsignadoId` si `limpiaMensajero`) + un segundo
   * append por el choke point (actor = null/sistema, `origen_tipo = gestion`). Sin
   * `seguimiento` (las otras 3 ramas), el metodo se comporta EXACTAMENTE como sin este
   * parametro (R19). Atomico: si el append de seguimiento falla, revierte todo (R10).
   */
  crearGestionYTransicionar(input: {
    ordenId: string;
    mensajeroId: string;
    gestion: GestionOrdenData;
    nuevoEstatusId: string;
    seguimiento?: { destinoEstatusId: string; limpiaMensajero: boolean };
  }): Promise<string>;
}
