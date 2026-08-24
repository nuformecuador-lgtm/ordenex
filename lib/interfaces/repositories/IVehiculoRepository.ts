import type { VehiculoDTO } from "@/lib/types/vehiculos";

// Contrato de acceso a datos del catalogo vehiculos. Desde que la columna `name`
// es TEXT (`20260824160000_vehiculo_name_texto`) el catalogo es ADMINISTRABLE y no
// solo-lectura: el contrato gana create/update/delete. Solo queries Prisma, sin
// logica de negocio (esa vive en VehiculoService).
export interface IVehiculoRepository {
  /** Todas las filas del catalogo, ordenadas por name. */
  findMany(): Promise<VehiculoDTO[]>;
  /** La fila por id; `null` si no existe. */
  findById(id: string): Promise<VehiculoDTO | null>;
  /**
   * La fila cuyo `name` coincide EXACTAMENTE; `null` si no hay. Sirve para dar el
   * `conflict` como resultado de dominio en vez de dejar escapar la violacion del
   * UNIQUE como error crudo de Postgres.
   */
  findByName(name: string): Promise<VehiculoDTO | null>;
  create(name: string): Promise<VehiculoDTO>;
  /** Renombra; `null` si la fila no existe. */
  update(id: string, name: string): Promise<VehiculoDTO | null>;
  /** Borra; `false` si no existia. Lanza si alguna FK lo referencia (RESTRICT). */
  delete(id: string): Promise<boolean>;
  /**
   * Cuantas entidades referencian este tipo (mensajeros + tarifas de zona). Se
   * consulta ANTES de borrar para poder responder `in_use` con sentido, en vez de
   * traducir a ciegas cualquier fallo del delete.
   */
  contarUsos(id: string): Promise<number>;
}
