import type { PlantillaEstado } from "@prisma/client";

// Feature 107 — contrato del repositorio de plantillas de mensaje. Solo Prisma; sin
// logica de negocio ni permisos. TODAS las lecturas filtran `deletedAt IS NULL` (R28).

/** Forma publica de una plantilla vigente. `variables` es el array persistido (R15). */
export interface PlantillaPublica {
  id: string;
  nombre: string;
  cuerpo: string;
  variables: string[];
  estado: PlantillaEstado;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** R6: fila del listado (nombre, estado y cuerpo). */
export interface PlantillaListItem {
  id: string;
  nombre: string;
  cuerpo: string;
  estado: PlantillaEstado;
  variables: string[];
  createdAt: Date;
}

/** R10: violacion de unicidad del nombre. Patron `UsuarioDuplicadoError`. */
export class PlantillaDuplicadaError extends Error {
  constructor(public readonly campo: "nombre" = "nombre") {
    super(`El nombre de la plantilla ya esta en uso`);
    this.name = "PlantillaDuplicadaError";
  }
}

export interface CreatePlantillaData {
  nombre: string;
  cuerpo: string;
  variables: string[]; // R15: derivadas por el service
  createdBy: string | null;
}

/** R20/R22: solo nombre y/o cuerpo; `variables` recalculadas por el service si cambia el cuerpo. */
export interface UpdatePlantillaData {
  nombre?: string;
  cuerpo?: string;
  variables?: string[];
}

export interface ListPlantillasParams {
  skip: number;
  take: number;
}

export interface ListPlantillasResult {
  items: PlantillaListItem[];
  total: number;
}

export interface IPlantillaMensajeRepository {
  /** R8/R12/R15: persiste nombre, cuerpo, variables; nace `pending`. */
  create(data: CreatePlantillaData): Promise<PlantillaPublica>;
  /** R6/R7/R28: listado paginado de vigentes (deletedAt IS NULL), orden createdAt desc. */
  list(params: ListPlantillasParams): Promise<ListPlantillasResult>;
  /** R7/R28: total de vigentes. */
  count(): Promise<number>;
  /** R28: plantilla vigente por id; `null` si no existe o esta soft-deleted. */
  findById(id: string): Promise<PlantillaPublica | null>;
  /** R10/R28: plantilla vigente por nombre (para unicidad); `null` si no existe. */
  findByNombre(nombre: string): Promise<PlantillaPublica | null>;
  /** R20/R22: aplica nombre/cuerpo/variables; `null` si no existe o esta soft-deleted. */
  update(id: string, data: UpdatePlantillaData): Promise<PlantillaPublica | null>;
  /** R24: fija el estado; `null` si no existe o esta soft-deleted. */
  updateEstado(id: string, estado: PlantillaEstado): Promise<PlantillaPublica | null>;
  /** R27: soft delete (fija deletedAt); `false` si no existe o ya estaba borrada. */
  softDelete(id: string): Promise<boolean>;
}
