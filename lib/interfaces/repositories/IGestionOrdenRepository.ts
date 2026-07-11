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
   */
  crearGestionYTransicionar(input: {
    ordenId: string;
    mensajeroId: string;
    gestion: GestionOrdenData;
    nuevoEstatusId: string;
  }): Promise<string>;
}
