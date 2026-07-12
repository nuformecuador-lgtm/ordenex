import type { EstadoTarifa } from "@prisma/client";
import type { TarifaDTO } from "@/lib/types/tarifa";

// Datos listos para persistir una tarifa (numbers; el repo convierte a
// Prisma.Decimal). Las 8 columnas numericas + tiendaId son obligatorias (R5).
// `status` no viaja aqui: nace `activo` por default de DB.
export interface CreateTarifaData {
  tiendaId: string; // FK obligatoria a usuario (adminTienda)
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
  tiendaId?: string; // reasignar la tarifa a otra tienda (adminTienda)
  status?: EstadoTarifa; // activo | inactivo
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
  /** true si `tiendaId` es un usuario existente con rol `adminTienda`. */
  esTiendaAdminTienda(tiendaId: string): Promise<boolean>;
  /**
   * Pasa a `inactivo` todas las tarifas (no borradas) de la tienda dada. Se usa
   * cuando el usuario deja de ser adminTienda. Devuelve cuantas se actualizaron.
   */
  inactivarPorTienda(tiendaId: string): Promise<number>;
}
