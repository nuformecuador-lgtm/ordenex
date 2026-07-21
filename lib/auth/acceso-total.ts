import { RolValue } from "@prisma/client";

/** Roles con acceso total de gestión: ven y manipulan todos los módulos del maestro
 *  (Órdenes, Cierres, Ranking, Wallet). maestro y admin son equivalentes aquí. */
export const ROLES_ACCESO_TOTAL: readonly RolValue[] = [RolValue.maestro, RolValue.admin];

export function esAccesoTotal(rol: RolValue): boolean {
  return ROLES_ACCESO_TOTAL.includes(rol);
}
