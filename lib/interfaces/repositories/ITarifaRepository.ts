import type { TarifaDTO } from "@/lib/types/tarifa";

// Datos listos para persistir una tarifa (numbers; el repo convierte a
// Prisma.Decimal). Las 8 columnas numericas son obligatorias (R5).
// 274/R9: `status` no viaja aqui porque la columna ya no existe.
export interface CreateTarifaData {
  /** Tienda a la que se acota la tarifa; `null`/ausente = no acotada. */
  tiendaId?: string | null;
  valorFlete: number;
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  /** Monto de bodega; opcional. `null`/ausente = sin fulfillment, lo mismo que 0. */
  fulfillment?: number | null;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
  /** Cobro pactado aparte; opcional. `null`/ausente = sin tarifa especial. */
  tarifaEspecial?: number | null;
  /** El mismo pacto, para la DEVOLUCION. Independiente del anterior. */
  tarifaEspecialDevuelta?: number | null;
  /** Zona a la que se acota la tarifa; `null`/ausente = no acotada. */
  zonaId?: string | null;
  /** Marca la tarifa por defecto de la tienda; ausente = false. */
  isDefault?: boolean;
}

// Campos actualizables a nivel de datos; todos opcionales (R20/R22).
export interface UpdateTarifaData {
  tiendaId?: string | null; // reasignar el duenno; `null` desacota la tarifa de toda tienda
  valorFlete?: number;
  valorFleteDevuelto?: number;
  valorFleteGam?: number;
  valorFleteDevueltoGam?: number;
  fulfillment?: number | null; // `null` deja la tarifa sin fulfillment (equivalente a 0)
  comisionCod?: number;
  ivaFlete?: number;
  ivaComisionCod?: number;
  tarifaEspecial?: number | null; // `null` limpia la tarifa especial pactada
  tarifaEspecialDevuelta?: number | null; // `null` limpia el pacto de la devolucion
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
  /**
   * FICHA 362 (R9) — `actorUsuarioId` es OBLIGATORIO en los tres escritores de esta tabla: la
   * mutacion y su fila de registro viajan en la MISMA transaccion, y sin actor la fila no se
   * puede congelar. `null` = el sistema (hoy ningun camino lo produce aqui, pero el tipo lo
   * admite por simetria con el resto del registro).
   */
  create(data: CreateTarifaData, actorUsuarioId: string | null): Promise<TarifaDTO>;
  /** null si no existe. */
  findById(id: string): Promise<TarifaDTO | null>;
  /** orderBy created_at desc, skip/take (R18). */
  list(params: ListTarifasParams): Promise<ListTarifasResult>;
  /** Aplica cambios solo si la tarifa existe; null si no (R21). */
  update(
    id: string,
    data: UpdateTarifaData,
    actorUsuarioId: string | null,
  ): Promise<TarifaDTO | null>;
  /**
   * Borrado FISICO. Esta tabla NO borra en logico: no hay `deleted_at` que fijar
   * (ver la migracion tarifa_zona_is_default). `referenced` = algun `cierre_detail`
   * liquido contra esta tarifa y la FK es RESTRICT, asi que la fila no se puede
   * sacar; patron `IZonaRepository.hardDelete`.
   */
  hardDelete(id: string, actorUsuarioId: string | null): Promise<DeleteTarifaResult>;
  /** true si `tiendaId` es un usuario existente con un rol tarifable (`ROLES_TARIFABLES`). */
  esTiendaAsignable(tiendaId: string): Promise<boolean>;
  /** true si `zonaId` corresponde a una zona existente. */
  existeZona(zonaId: string): Promise<boolean>;
  // 274/R13: aqui vivia `inactivarPorTienda(tiendaId)`, que pasaba a `inactivo`
  // todas las tarifas de una tienda cuando el usuario dejaba de tener un rol
  // tarifable. Se fue con la columna `tarifas.status`.
  // HUECO ACEPTADO Y DECLARADO (design 274 §2.2, decision del humano 2026-08-24):
  // el caso «la tienda deja de ser adminTienda» queda SIN cobertura —como ya
  // estaba de hecho, porque ningun llamador invocaba este metodo— y NO se abre
  // ficha. Si lo echas de menos, lee esto antes de reintroducirlo: el sustituto
  // no es un `status`, es borrar la tarifa o dejarla sin resolver por la cascada.
}
