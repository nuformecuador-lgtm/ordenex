import { VehiculoValue } from "@prisma/client";

// Fuente unica de verdad de los tipos de vehiculo (patron ROLES_SEED). El seed
// idempotente (seedVehiculos) itera esta lista con upsert por `name`. Sin lista
// literal duplicada: anadir/quitar un miembro del enum se propaga solo (R6).
export const VEHICULOS_SEED: VehiculoValue[] = Object.values(VehiculoValue);

// DTO expuesto por la capa de lectura: id (uuid PK estable) + name (valor del
// enum). No expone campos internos (R11).
export interface VehiculoDTO {
  id: string;
  name: VehiculoValue;
}
