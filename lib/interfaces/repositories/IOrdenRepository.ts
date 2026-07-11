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

// Feature 15 — filas de catalogo geografico usadas para resolver por nombre
// (R19/R21), jerarquicas: canton dentro de provincia, distrito dentro de canton.
export interface ProvinciaRow {
  id: string;
  nombre: string;
  zonaId: string;
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
}
