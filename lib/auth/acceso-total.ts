import { RolValue } from "@prisma/client";

/** Roles con acceso total de gestión: ven y manipulan todos los módulos del maestro
 *  (Órdenes, Cierres, Ranking, Wallet). maestro y admin son equivalentes aquí. */
export const ROLES_ACCESO_TOTAL: readonly RolValue[] = [RolValue.maestro, RolValue.admin];

export function esAccesoTotal(rol: RolValue): boolean {
  return ROLES_ACCESO_TOTAL.includes(rol);
}

/**
 * FICHA 333 (D1, design §3, R24/R27) — LA PRIMERA EXCEPCIÓN DELIBERADA A LA PARIDAD DE ARRIBA.
 *
 * `maestro` y `admin` son equivalentes en todo lo demás desde la ficha 94, y esta ficha **no
 * cambia ni un call-site** de `esAccesoTotal` (R28). Lo que introduce es un segundo predicado,
 * más estrecho, para UNA capacidad concreta: **decidir un cobro de gasto fijo** —aprobarlo o
 * rechazarlo—, que mueve dinero de la caja central.
 *
 * El `admin` **VE** la cola de pendientes (R25, con `esAccesoTotal`) y **NO** la decide (R24).
 *
 * POR QUÉ VIVE AQUÍ, en el mismo archivo que la regla que excepciona: para que quien lea la
 * paridad se encuentre la excepción en la misma pantalla. Un `actor.rol !== "maestro"` suelto
 * dentro del servicio —el patrón de `EliminarOrdenService`— no dejaría ese rastro y no sería
 * greppable como capacidad.
 *
 * POR QUÉ NOMBRA LA CAPACIDAD Y NO EL ROL: si mañana el humano quiere que el `admin` también
 * apruebe, se añade un valor a la lista y el diff dice exactamente qué se decidió.
 *
 * Lo vigila `tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts`: el camino de decisión
 * NO puede autorizar con `esAccesoTotal`, y este predicado NO puede aparecer en ningún otro
 * servicio.
 */
export const ROLES_DECIDEN_COBRO_GASTO_FIJO: readonly RolValue[] = [RolValue.maestro];

export function puedeDecidirCobroGastoFijo(rol: RolValue): boolean {
  return ROLES_DECIDEN_COBRO_GASTO_FIJO.includes(rol);
}
