import type { ZonaDTO, ZonaLightDTO } from "@/lib/types/zona";

// Feature 24. Datos listos para persistir una zona (numbers; el repo convierte a
// Prisma.Decimal). `nombre` llega ya en forma canonica desde el service (R2/R21).
// `distritoIds` = conjunto de distritos que componen la zona.
export interface CreateZonaData {
  nombre: string;
  pagoEntrega: number;
  pagoRechazo: number;
  esGam: boolean;
  distritoIds: string[];
}

// Campos actualizables a nivel de datos; todos opcionales (R22). `distritoIds`, si
// se provee, es el conjunto COMPLETO deseado (asignar nuevos y liberar removidos).
export interface UpdateZonaData {
  nombre?: string;
  pagoEntrega?: number;
  pagoRechazo?: number;
  esGam?: boolean;
  distritoIds?: string[];
}

export interface ListZonasParams {
  skip: number;
  take: number;
}

export interface ListZonasResult {
  items: ZonaDTO[];
  total: number;
}

/** R19: alguno de los distritos del conjunto no existe en el catalogo global. */
export class DistritosInexistentesError extends Error {
  constructor(public readonly distritoIds: string[]) {
    super(`Distritos inexistentes: ${distritoIds.join(", ")}`);
    this.name = "DistritosInexistentesError";
  }
}

/** R20: alguno de los distritos ya pertenece a OTRA zona (un distrito, una zona). */
export class DistritosYaAsignadosError extends Error {
  constructor(public readonly distritoIds: string[]) {
    super(`Distritos ya asignados a otra zona: ${distritoIds.join(", ")}`);
    this.name = "DistritosYaAsignadosError";
  }
}

export interface IZonaRepository {
  /**
   * R17/R18: crea la fila zona y asigna atomicamente `distrito.zona_id` a cada
   * distrito. Lanza `DistritosInexistentesError`/`DistritosYaAsignadosError` sin
   * persistir (transaccion todo-o-nada). Si `esGam`, desmarca la GAM previa (R23).
   */
  create(data: CreateZonaData): Promise<ZonaDTO>;
  /** null si la zona no existe. Incluye `distritosCount` (R24). */
  findById(id: string): Promise<ZonaDTO | null>;
  /**
   * R2/R21: busca una zona cuyo `nombre` normalizado (clave de dedup) coincida con
   * `key`, excluyendo opcionalmente `excludeId` (edicion). null si no hay match.
   */
  findByNombreKey(key: string, excludeId?: string): Promise<{ id: string } | null>;
  /** R24: listado paginado (skip/take) + total; cada item con `distritosCount`. */
  list(params: ListZonasParams): Promise<ListZonasResult>;
  /**
   * R22: aplica solo los campos provistos y, si viene `distritoIds`, reasigna el
   * conjunto (libera los removidos con NULL). null si la zona no existe. Atomico.
   */
  update(id: string, data: UpdateZonaData): Promise<ZonaDTO | null>;
  /**
   * R23: marca `es_gam = true` en la zona dada y desmarca cualquier otra en la
   * misma transaccion. false si la zona no existe.
   */
  setGam(id: string): Promise<boolean>;
  /** R15: proyeccion ligera `{ id, nombre, esGam }` ordenada por nombre. */
  listLight(): Promise<ZonaLightDTO[]>;
  /**
   * Feature 30/R3: resuelve el `id` de la zona GAM (bodega central), identificada
   * por el flag `esGam = true` (unica fuente de verdad; el indice unico parcial
   * `zona_es_gam_unico` garantiza a lo sumo una). `null` si aun no hay ninguna
   * zona marcada como GAM (dispara el guardia R4 en el service).
   */
  findGamZonaId(): Promise<string | null>;
}
