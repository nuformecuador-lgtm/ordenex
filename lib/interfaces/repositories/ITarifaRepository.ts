import type { TarifaDTO } from "@/lib/types/tarifa";

// Datos listos para persistir una tarifa (numbers; el repo convierte a
// Prisma.Decimal). Las 8 columnas numericas + nombre son obligatorias (R5).
export interface CreateTarifaData {
  nombre: string;
  zonaId: string; // feature 24: FK obligatoria a zona
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
export interface UpdateTarifaData {
  nombre?: string;
  zonaId?: string; // feature 24: reasignar la tarifa a otra zona
  valorFlete?: number;
  valorFleteDevuelto?: number;
  valorFleteGam?: number;
  valorFleteDevueltoGam?: number;
  fulfillment?: number;
  comisionCod?: number;
  ivaFlete?: number;
  ivaComisionCod?: number;
}

export interface ListTarifasParams {
  skip: number;
  take: number;
}

export interface ListTarifasResult {
  items: TarifaDTO[];
  total: number;
}

export interface ITarifaRepository {
  create(data: CreateTarifaData): Promise<TarifaDTO>;
  /** Excluye borrados (deleted_at IS NOT NULL); null si no existe o esta borrado (R19). */
  findById(id: string): Promise<TarifaDTO | null>;
  /** Excluye borrados, orderBy created_at desc, skip/take (R18/R19). */
  list(params: ListTarifasParams): Promise<ListTarifasResult>;
  /** Aplica cambios solo si la tarifa existe y no esta borrado; null si no (R21). */
  update(id: string, data: UpdateTarifaData): Promise<TarifaDTO | null>;
  /** Fija deleted_at; false si no existe o ya estaba borrado (R24/R25). */
  softDelete(id: string): Promise<boolean>;
}
