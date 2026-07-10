import type { CobroDTO } from "@/lib/types/cobro";

// Datos listos para persistir un cobro (numbers; el repo convierte a
// Prisma.Decimal). Las 8 columnas numericas + nombre son obligatorias (R5).
export interface CreateCobroData {
  nombre: string;
  valorFlete: number;
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  fulfillment: number;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
}

// Campos actualizables a nivel de datos; todos opcionales (R20/R22).
export interface UpdateCobroData {
  nombre?: string;
  valorFlete?: number;
  valorFleteDevuelto?: number;
  valorFleteGam?: number;
  valorFleteDevueltoGam?: number;
  fulfillment?: number;
  comisionCod?: number;
  ivaFlete?: number;
  ivaComisionCod?: number;
}

export interface ListCobrosParams {
  skip: number;
  take: number;
}

export interface ListCobrosResult {
  items: CobroDTO[];
  total: number;
}

export interface ICobroRepository {
  create(data: CreateCobroData): Promise<CobroDTO>;
  /** Excluye borrados (deleted_at IS NOT NULL); null si no existe o esta borrado (R19). */
  findById(id: string): Promise<CobroDTO | null>;
  /** Excluye borrados, orderBy created_at desc, skip/take (R18/R19). */
  list(params: ListCobrosParams): Promise<ListCobrosResult>;
  /** Aplica cambios solo si el cobro existe y no esta borrado; null si no (R21). */
  update(id: string, data: UpdateCobroData): Promise<CobroDTO | null>;
  /** Fija deleted_at; false si no existe o ya estaba borrado (R24/R25). */
  softDelete(id: string): Promise<boolean>;
}
