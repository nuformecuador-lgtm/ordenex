import type { OrdenDTO, SortField, SortDir } from "@/lib/types/orden";

// Datos listos para persistir una orden. `estatusId` y `tiendaId` ya resueltos
// por el servicio (default de estatus, alcance de tienda). `numGuia` lo asigna
// la secuencia de la DB, nunca se envia (R8).
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
  peso: number;
  notas?: string | null;
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
  peso?: number;
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
  items: OrdenDTO[];
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
  existsGeo(input: {
    zonaId: string;
    provinciaId: string;
    cantonId: string;
    distritoId?: string | null;
  }): Promise<GeoExistence>;
}
