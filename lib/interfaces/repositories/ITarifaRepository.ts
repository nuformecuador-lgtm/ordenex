import type { EstadoTarifa } from "@prisma/client";
import type { TarifaDTO } from "@/lib/types/tarifa";

// Datos listos para persistir una tarifa (numbers; el repo convierte a
// Prisma.Decimal). Las 8 columnas numericas son obligatorias (R5).
// `status` no viaja aqui: nace `activo` por default de DB.
export interface CreateTarifaData {
  /** Tienda a la que se acota la tarifa; `null`/ausente = no acotada. */
  tiendaId?: string | null;
  valorFlete: number;
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  fulfillment: number;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
  /** Cobro pactado aparte; opcional. `null`/ausente = sin tarifa especial. */
  tarifaEspecial?: number | null;
  /** Zona a la que se acota la tarifa; `null`/ausente = no acotada. */
  zonaId?: string | null;
  /** Marca la tarifa por defecto de la tienda; ausente = false. */
  isDefault?: boolean;
}

// Campos actualizables a nivel de datos; todos opcionales (R20/R22).
export interface UpdateTarifaData {
  tiendaId?: string | null; // reasignar el duenno; `null` desacota la tarifa de toda tienda
  status?: EstadoTarifa; // activo | inactivo
  valorFlete?: number;
  valorFleteDevuelto?: number;
  valorFleteGam?: number;
  valorFleteDevueltoGam?: number;
  fulfillment?: number;
  comisionCod?: number;
  ivaFlete?: number;
  ivaComisionCod?: number;
  tarifaEspecial?: number | null; // `null` limpia la tarifa especial pactada
  zonaId?: string | null; // `null` desacota la tarifa (vuelve a aplicar a toda la tienda)
  isDefault?: boolean;
}

export interface ListTarifasParams {
  skip: number;
  take: number;
}

export interface ListTarifasResult {
  items: TarifaDTO[];
  total: number;
}

// Resultado del borrado fisico: `referenced` = la tarifa esta congelada en algun
// cierre (`cierre_detail.tarifa_id`, FK RESTRICT) y no se puede borrar.
export type DeleteTarifaResult = "ok" | "not_found" | "referenced";

export interface ITarifaRepository {
  create(data: CreateTarifaData): Promise<TarifaDTO>;
  /** null si no existe. */
  findById(id: string): Promise<TarifaDTO | null>;
  /** orderBy created_at desc, skip/take (R18). */
  list(params: ListTarifasParams): Promise<ListTarifasResult>;
  /** Aplica cambios solo si la tarifa existe; null si no (R21). */
  update(id: string, data: UpdateTarifaData): Promise<TarifaDTO | null>;
  /**
   * Borrado FISICO. Esta tabla NO borra en logico: no hay `deleted_at` que fijar
   * (ver la migracion tarifa_zona_is_default). `referenced` = algun `cierre_detail`
   * liquido contra esta tarifa y la FK es RESTRICT, asi que la fila no se puede
   * sacar; patron `IZonaRepository.hardDelete`.
   */
  hardDelete(id: string): Promise<DeleteTarifaResult>;
  /** true si `tiendaId` es un usuario existente con un rol tarifable (`ROLES_TARIFABLES`). */
  esTiendaAsignable(tiendaId: string): Promise<boolean>;
  /** true si `zonaId` corresponde a una zona existente. */
  existeZona(zonaId: string): Promise<boolean>;
  /**
   * Pasa a `inactivo` todas las tarifas de la tienda dada. Se usa
   * cuando el usuario deja de tener un rol tarifable. Devuelve cuantas se actualizaron.
   */
  inactivarPorTienda(tiendaId: string): Promise<number>;
}
