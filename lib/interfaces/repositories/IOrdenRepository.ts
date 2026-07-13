import type { OrdenDTO, OrdenListItemDTO, SortField, SortDir } from "@/lib/types/orden";
import type { ResumenCargaOrdenDTO } from "@/lib/types/asignacion-mensajero";

// Datos listos para persistir una orden. `estatusId` y `tiendaId` ya resueltos
// por el servicio (default de estatus, alcance de tienda). `numGuia` lo asigna
// la secuencia de la DB, nunca se envia (R8). `peso` nullable (feature 15/R4:
// la carga masiva no trae peso); el CRUD (feature 6) siempre envia un numero,
// pues `crearOrdenSchema` sigue exigiendo `peso > 0`. `direccion`/`montoCobrar`/
// `mensajeroSugeridoId` son columnas nuevas de feature 15, opcionales.
export interface CreateOrdenData {
  numRemision: string;
  estatusId: string;
  destinatario: string;
  telefonoDest: string;
  tiendaId: string;
  zonaId: string;
  provinciaId: string;
  cantonId: string;
  distritoId?: string | null;
  producto: string;
  peso: number | null;
  notas?: string | null;
  direccion?: string | null;
  montoCobrar?: number | null;
  mensajeroSugeridoId?: string | null;
}

// Campos actualizables a nivel de datos (ya filtrados por rol en el servicio).
export interface UpdateOrdenData {
  estatusId?: string;
  destinatario?: string;
  telefonoDest?: string;
  tiendaId?: string;
  zonaId?: string;
  provinciaId?: string;
  cantonId?: string;
  distritoId?: string | null;
  producto?: string;
  peso?: number | null;
  notas?: string | null;
}

export interface ListOrdenesParams {
  where: { tiendaId?: string; estatusId?: string };
  sortBy: SortField;
  sortDir: SortDir;
  skip: number;
  take: number;
}

export interface ListOrdenesResult {
  items: OrdenListItemDTO[];
  total: number;
}

export interface GeoExistence {
  zona: boolean;
  provincia: boolean;
  canton: boolean;
  distrito: boolean; // true si no se consulta distrito (opcional) o si existe
}

/** R28/R14: `num_remision` provisto ya existe en otra orden. */
export class NumRemisionDuplicadoError extends Error {
  constructor(public readonly numRemision: string) {
    super(`num_remision duplicado: ${numRemision}`);
    this.name = "NumRemisionDuplicadoError";
  }
}

// Feature 17 — fila de orden proyectada para validar transiciones de "Generar
// guia"/"asignar desde bodega" (R27/R29). NO filtra deleted_at en el repo: el
// service necesita distinguir "no existe" de "borrada" para reportar el motivo
// exacto en `conflict.detalle` (R29).
// Feature 30/R8/R9/R11/R12 — la fila de transicion suma la zona de la orden
// (`zonaId` NOT NULL) y el flag GAM de esa zona (`zonaEsGam`), para que el
// service clasifique cada orden GAM/no-GAM por `zonaId === gamZonaId` sin una
// consulta extra.
export interface OrdenTransicionRow {
  id: string;
  estatusValue: string;
  numGuia: number | null;
  deletedAt: Date | null;
  zonaId: string;
  esGam?: boolean;
}

// Feature 17/T15 — fila liviana de mensajero para el loader del modal (R28).
export interface MensajeroLiteRow {
  id: string;
  nombre: string;
}

// Feature 17 — fila liviana del catalogo `order_status` para que la UI resuelva
// value -> estatusId y siga filtrando `listarOrdenes` por `estatusId` (R15/R16,
// mismo patron que design.md §4). Solo lectura, sin logica de negocio.
export interface OrderStatusLiteRow {
  id: string;
  value: string;
}

// Feature 17 — decision final por orden ya resuelta por el service (estatusId y
// mensajeroAsignadoId concretos, no el `value`/`mensajeroId` crudo del input).
export interface GenerarGuiaDecisionData {
  ordenId: string;
  estatusId: string;
  mensajeroAsignadoId: string | null;
}

export interface GenerarGuiaResultRow {
  ordenId: string;
  numGuia: number;
}

// Feature 15 — filas de catalogo geografico usadas para resolver por nombre
// (R19/R21), jerarquicas: canton dentro de provincia, distrito dentro de canton.
export interface ProvinciaRow {
  id: string;
  nombre: string;
  // feature 54: la zona de la orden ya NO se deriva de la provincia (provincia.zona_id
  // fue eliminada en la migracion de zonas); se deriva del distrito. Ver BulkOrdenService.
}

export interface CantonRow {
  id: string;
  nombre: string;
  provinciaId: string;
}

export interface DistritoRow {
  id: string;
  nombre: string;
  cantonId: string;
  zonaId: string | null; // feature 24/R4: la zona de la orden se deriva del distrito (carga masiva).
}

// Feature 32 — fila proyectada para armar la etiqueta de guia (R1). Trae los
// nombres legibles de tienda/geografia (no IDs) y `montoCobrar` ya como
// number|null (Decimal->number, R5). `numGuia` puede venir null: el filtro
// `sin_guia` (R2) lo decide el service, no el repo. NUNCA incluye `deletedAt`
// (R6): el repo YA filtra `deletedAt: null` para que una orden borrada cuente
// como no encontrada (R3), no como fila con guia. `distritoNombre` es nullable
// (R4: la orden puede no tener distrito).
export interface EtiquetaRow {
  id: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
}

// Feature 33 — fila proyectada para el modulo de la bodega satelite ("Mis
// asignaciones" del adminSatelite, R6/R8/R9). Trae los nombres legibles de
// tienda/geografia (no IDs, patron EtiquetaRow) y `montoCobrar` ya como
// number|null (Decimal->number). `estatusValue` distingue "Por recibir"
// (en_ruta_bodega_satelite) de "Recibidas" (en_bodega_satelite); el service parte
// en grupos. NUNCA incluye `deletedAt`: el repo YA filtra `deletedAt: null`.
// `distritoNombre` es nullable (la orden puede no tener distrito).
export interface RecepcionSateliteRow {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string; // en_ruta_bodega_satelite | en_bodega_satelite
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
}

// Feature 41 (R17/R18) — resultado del bloqueo derivado de una bodega satelite. Regla
// ESTRICTA (F1.4-Q4): `bloqueada = porMensajeros || porCierreBodega`. `porMensajeros` =
// existe un cierre_dia de sus mensajeros (destino satelite de su zona) en
// `solicitado`/`vencido` (causa i). `porCierreBodega` = existe su propio CierreBodega
// hacia la central en `solicitado` (causa ii). Ambos flags viajan para que el borde
// (feature 34) distinga el motivo accionable de R22.
export interface BodegaBloqueoResult {
  bloqueada: boolean;
  porMensajeros: boolean;
  porCierreBodega: boolean;
}

export interface IOrdenRepository {
  create(data: CreateOrdenData): Promise<OrdenDTO>;
  /** Excluye borradas (deleted_at IS NOT NULL); null si no existe o esta borrada (R34). */
  findById(id: string): Promise<OrdenDTO | null>;
  list(params: ListOrdenesParams): Promise<ListOrdenesResult>;
  /** Aplica cambios solo si la orden existe y no esta borrada; null si no (R36). */
  update(id: string, data: UpdateOrdenData): Promise<OrdenDTO | null>;
  /** Fija deleted_at; false si no existe o ya estaba borrada (R39/R40). */
  softDelete(id: string): Promise<boolean>;
  existsEstatus(estatusId: string): Promise<boolean>;
  findEstatusIdByValue(value: string): Promise<string | null>;
  /**
   * Feature 27/R15/R16/R17: lee `usuario.fulfillment` de la tienda que realiza la
   * carga masiva (el `adminTienda` autenticado). `false` por defecto si el usuario
   * no resuelve, coherente con el default de la columna (R3).
   */
  findUsuarioFulfillment(usuarioId: string): Promise<boolean>;
  existsGeo(input: {
    zonaId: string;
    provinciaId: string;
    cantonId: string;
    distritoId?: string | null;
  }): Promise<GeoExistence>;

  // --- Feature 15: carga masiva (metodos batch, R19/R21/R22/R25/R27) ---

  /**
   * R25: remisiones ya existentes (orden no borrada) de entre las provistas.
   * Mapa num_remision -> estatus.value de la orden existente.
   */
  findExistingRemisiones(nums: string[]): Promise<Map<string, string>>;
  /** R19/R21: provincias candidatas por nombre (comparacion case-insensitive la hace el service). */
  findProvinciasByNombres(nombres: string[]): Promise<ProvinciaRow[]>;
  /** R19: cantones de las provincias resueltas. */
  findCantonesByProvinciaIds(provinciaIds: string[]): Promise<CantonRow[]>;
  /** R19: distritos de los cantones resueltos. */
  findDistritosByCantonIds(cantonIds: string[]): Promise<DistritoRow[]>;
  /** R22: subconjunto de `ids` que corresponde a un usuario con rol `mensajero`. */
  findMensajerosByIds(ids: string[]): Promise<Set<string>>;
  /** R27: inserta en lotes de `batchSize` con `skipDuplicates`; devuelve el total insertado. */
  createManyOrdenes(data: CreateOrdenData[], batchSize: number): Promise<number>;

  // --- Feature 16: carga masiva etapa 2 (resumen + asignacion de mensajero) ---

  /**
   * R6/R8/R9/R10: filas del resumen del lote (por `num_remision`), acotadas a la
   * tienda del actor y no borradas. Preserva unicidad de `num_remision`.
   */
  findResumenByNumRemisiones(nums: string[], tiendaId: string): Promise<ResumenCargaOrdenDTO[]>;
  /**
   * R15/R16: actualiza `mensajero_sugerido_id` en lote, solo ordenes no borradas
   * de `tiendaId`; devuelve el numero de filas afectadas.
   */
  asignarMensajeroSugerido(
    ordenIds: string[],
    mensajeroSugeridoId: string,
    tiendaId: string,
  ): Promise<number>;
  /** R14: cuenta cuantas de `ordenIds` pertenecen a `tiendaId` y no estan borradas. */
  countOrdenesDeTienda(ordenIds: string[], tiendaId: string): Promise<number>;

  // --- Feature 17: "Generar guia" / asignacion de mensajero (R5/R18-R29) ---

  /**
   * R27/R29: filas de orden por id, INCLUYE borradas (deletedAt !== null) para
   * que el service pueda distinguir "no existe" de "borrada" y reportar el
   * motivo exacto en `conflict.detalle`. Vacio si `ids` esta vacio.
   */
  findByIdsForTransicion(ids: string[]): Promise<OrdenTransicionRow[]>;
  /**
   * R28: subconjunto de `ids` que corresponde a un usuario con rol `mensajero`,
   * SIN filtro de zona (el filtrado por zona/GAM es la feature 30, ver design.md
   * "Limites"). Mismo criterio que `findMensajerosByIds`, nombre propio para el
   * contrato de esta feature.
   */
  findMensajeroIdsValidos(ids: string[]): Promise<Set<string>>;
  /** R28/T15: TODOS los usuarios con rol `mensajero`, SIN filtro de zona. */
  findAllMensajeros(): Promise<MensajeroLiteRow[]>;
  /**
   * Feature 30/R5 + feature 34/R5: usuarios con rol `mensajero` cuyo `zonaId`
   * sea la zona pasada, ordenados por nombre. Filtra por la `zonaId` recibida (el
   * maestro pasa la zona GAM; el adminSatelite pasa su propia zona): un mensajero
   * de otra zona o sin zona NO aparece.
   */
  findMensajerosByZona(zonaId: string): Promise<MensajeroLiteRow[]>;
  /**
   * Feature 30/R6 + feature 34/R9: subconjunto de `ids` que corresponde a un
   * usuario con rol `mensajero` cuyo `zonaId` sea la zona pasada. Defensa en
   * profundidad sobre R5 (el service revalida el mensajero recibido contra la
   * zona del actor, aunque la lista visible ya venga filtrada por zona).
   */
  findMensajeroIdsValidosByZona(ids: string[], zonaId: string): Promise<Set<string>>;
  /**
   * R15/R16: catalogo completo `order_status` (id, value) de solo lectura, para
   * que la UI resuelva `value` -> `estatusId` y siga filtrando `listarOrdenes`
   * por `estatusId` (contrato feature 6/7 intacto).
   */
  listOrderStatus(): Promise<OrderStatusLiteRow[]>;
  /**
   * R5/R19/R25: transaccional (todo-o-nada). Por cada decision, asigna
   * `num_guia = nextval('orden_num_guia_seq')` SOLO si `num_guia IS NULL`
   * (idempotente, R5) y fija `estatusId`/`mensajeroAsignadoId`; TODAS las
   * decisiones reciben `num_guia` (incluidas las que van a en_bodega, R19). El
   * llamador DEBE haber validado el lote completo antes de invocar este metodo
   * (sin validaciones de negocio aqui, solo persistencia).
   */
  generarGuiaLote(decisiones: GenerarGuiaDecisionData[]): Promise<GenerarGuiaResultRow[]>;
  /**
   * R26: fija `mensajeroAsignadoId`/`estatusId` en lote; NUNCA toca `numGuia`
   * (idempotencia R5, esas ordenes ya lo tienen). Devuelve el numero de filas
   * afectadas.
   */
  asignarBodegaLote(ordenIds: string[], mensajeroId: string, estatusId: string): Promise<number>;

  // --- Feature 30: ruteo a bodega satelite (R10/R13) ---

  /**
   * Feature 30/R10/R13: rutea un lote homogeneo de ordenes no-GAM a
   * `en_ruta_bodega_satelite`. Transaccional (todo-o-nada): por cada orden asigna
   * `num_guia = nextval('orden_num_guia_seq')` SOLO si `num_guia IS NULL`
   * (idempotente, R10), fija `estatusId` y deja `mensajeroAsignadoId = NULL`
   * (R9). El llamador DEBE haber validado el lote (existencia, origen permitido,
   * zona no-GAM) antes de invocar (sin logica de negocio aqui). Devuelve el
   * numero de ordenes ruteadas.
   */
  rutearBodegaSateliteLote(ordenIds: string[], estatusId: string): Promise<number>;

  // --- Feature 32: etiqueta de guia (READ derivado, R1/R3) ---

  /**
   * Feature 32/R1/R3: filas para la etiqueta por id, con los nombres legibles de
   * tienda/zona/provincia/canton/distrito resueltos (no IDs). Filtra
   * `deletedAt: null` para que una orden borrada NO aparezca (el service la
   * reporta como `no_encontrada`, R3). NO filtra por `num_guia`: devuelve filas
   * con `numGuia` posible null y el service decide `sin_guia` (R2). Solo query,
   * sin logica de negocio. Vacio si `ids` esta vacio.
   */
  findEtiquetasByIds(ids: string[]): Promise<EtiquetaRow[]>;

  // --- Feature 33: recepcion por QR en la bodega satelite (R4/R5/R6/R8/R11/R18) ---

  /**
   * Feature 33/R4/R5: `usuario.zonaId` del adminSatelite autenticado, resuelto
   * server-side por `usuarioId` (espejo de `findUsuarioFulfillment`). `null` si
   * el usuario no resuelve o no tiene zona asignada (R5: modulo vacio + sin_zona
   * en la recepcion). No hay logica de negocio: solo la query.
   */
  findUsuarioZonaId(usuarioId: string): Promise<string | null>;
  /**
   * Feature 39/R1/R4: `usuario.vehiculoId` del mensajero, resuelto server-side por
   * `usuarioId` (espejo de `findUsuarioZonaId`). `null` si el usuario no resuelve o no
   * tiene vehiculo asignado -> el resolver de tarifa cae a la tarifa por defecto de la
   * zona (vehiculo_id IS NULL). Solo la query, sin logica de negocio.
   */
  findUsuarioVehiculoId(usuarioId: string): Promise<string | null>;
  /**
   * Feature 33/R6/R8/R9: ordenes NO borradas (`deletedAt: null`) de `zonaId`
   * cuyo `estatus.value` esta en `estatusValues` (["en_ruta_bodega_satelite",
   * "en_bodega_satelite"]), con los nombres legibles de tienda/geografia (patron
   * `findEtiquetasByIds`). El service parte en "Por recibir"/"Recibidas" por el
   * `estatusValue`. Solo query. Vacio si `estatusValues` esta vacio.
   */
  findRecepcionSateliteByZona(
    zonaId: string,
    estatusValues: string[],
  ): Promise<RecepcionSateliteRow[]>;
  /**
   * Feature 33/R11/R18: transicion atomica y concurrencia-segura de UNA orden a
   * `en_bodega_satelite`. UPDATE guardado por estado de ORIGEN (solo si sigue en
   * `en_ruta_bodega_satelite`), zona (`zonaId`) y no borrada (`deletedAt IS
   * NULL`). Devuelve `true` si afecto 1 fila (recibida), `false` si 0 (ya no
   * estaba en el origen -> race). NO toca `mensajeroAsignadoId` ni `numGuia` (R11).
   */
  recibirEnSatelite(
    ordenId: string,
    zonaId: string,
    destinoEstatusId: string,
  ): Promise<boolean>;

  // --- Feature 34: asignacion satelite a mensajeros de la zona (R7/R14) ---

  /**
   * Feature 34/R7/R14: transiciona un lote de ordenes a `en_espera_aceptacion`
   * fijando `mensajeroAsignadoId`, con escritura GUARDADA por estado de origen +
   * zona (patron `recibirEnSatelite`): `updateMany` con
   * `WHERE id IN (ordenIds) AND estatusId = origenEstatusId AND zonaId AND
   * deletedAt IS NULL`. Concurrencia-segura: una orden que ya cambio de estado o
   * de zona entre la lectura y la escritura NO se toca. Usa `estatusId` (el id del
   * estado de origen ya resuelto por el service via `findEstatusIdByValue`), NO la
   * relacion `estatus.value`. NUNCA toca `numGuia` (R8; las ordenes ya lo tienen
   * del ruteo a satelite). Devuelve el numero de filas efectivamente
   * transicionadas (el service compara con `ordenIds.length` para detectar carrera).
   */
  asignarSateliteLote(
    ordenIds: string[],
    mensajeroId: string,
    zonaId: string,
    destinoEstatusId: string,
    origenEstatusId: string,
  ): Promise<number>;

  // --- Feature 41: bloqueo derivado en asignacion (R12/R16/R17/R23) ---

  /**
   * R12/R16: de `ids`, subconjunto de mensajeros BLOQUEADOS = tienen al menos un
   * `cierre_dia` en estado bloqueante (`solicitado` o `vencido`). `rechazado`/`aprobado`
   * NO bloquean (R16). Usa el indice (mensajero_id, estado). Vacio si `ids` esta vacio.
   */
  findMensajerosBloqueados(ids: string[]): Promise<Set<string>>;
  /**
   * R17 (regla estricta F1.4-Q4): la bodega satelite de `zonaId` esta BLOQUEADA para
   * asignar a sus mensajeros si existe CUALQUIERA de: (i) un `cierre_dia`
   * `destino_tipo='bodega_satelite'`, `destino_zona_id=zonaId`, `estado IN
   * ('solicitado','vencido')`; O (ii) un `cierre_bodega` `zona_id=zonaId`,
   * `estado='solicitado'` (su propio cierre hacia la central pendiente; mismo criterio
   * que la guardia de unicidad de la feature 40, respaldado por su indice unico parcial).
   * Devuelve los dos flags + `bloqueada = i || ii` para que el borde distinga el motivo.
   */
  existeBodegaSateliteBloqueada(zonaId: string): Promise<BodegaBloqueoResult>;
}
