"use server";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  recortarPorAmbito,
  type IReprogramadasRetenidasService,
  type ResumenRetenidas,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { buildReprogramadasRetenidasService } from "@/lib/services/reprogramadas-retenidas-composicion";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError, ForbiddenError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

// FICHA 462 (T2.10, design §6.1) — LA LECTURA DE LA FRANJA DE `/ordenes` (S4). Server Action de
// SOLO LECTURA del propio proyecto, nunca ruta API (`docs/architecture.md`). Sin zod: no hay
// entrada. Patron `lib/actions/notificaciones.ts`: actor por sesion, `withErrorHandler`,
// `toActionError`, y `deps` inyectables para test sin DB ni cookies.

export type ResumenRetenidasResult =
  /** YA recortado al ambito CENTRAL: ni un cierre ni un grupo de otra bodega (R6/R44). */
  | { status: "ok"; resumen: ResumenRetenidas }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

export interface ReprogramadasRetenidasDeps {
  service?: Pick<IReprogramadasRetenidasService, "resumen">;
  getActor?: () => Promise<Actor | null>;
  /** Reloj inyectable (tests). El dia CR sale de el, EN EL SERVIDOR (R38). */
  now?: () => Date;
}

/**
 * El conjunto de reprogramadas de hoy retenidas por un cierre sin aprobar, ACOTADO al ambito
 * central: lo que `maestro` y `admin` pueden aprobar en `/cierres-admin`.
 *
 * AUTORIZACION: solo acceso total (`esAccesoTotal`: maestro y admin). El `adminTienda` recibe
 * `forbidden` (R36) SIN que se ejecute una sola consulta; `mensajero` y `adminSatelite` tampoco
 * llegan (la pagina ya les hace `notFound()`), y aqui reciben `forbidden` igual: esta ficha no les
 * abre nada. MUTACION OBLIGATORIA (design §8.2-13): quitar `esAccesoTotal` => R36 ROJO.
 *
 * EL RECORTE ES DEL SERVIDOR: `recortarPorAmbito(resumen, { tipo: "central" })`. Lo que viaja al
 * componente ya no trae los cierres con destino satelite ni las «sin cierre» de una zona satelite
 * (R44): el navegador no filtra ni calcula fechas ni conteos (R38).
 *
 * SOLO LECTURA (R8): `resumen` es una lectura y su guardia lo vigila; esta accion no escribe nada.
 *
 * SUPERFICIE: la monta `app/(app)/ordenes/page.tsx` (Fase 3, T3.5) y la pinta el bloque
 * independiente `FranjaReprogramadasRetenidas` (R39). La anotacion `@sin-superficie` de la Fase 2
 * caduco en ese commit y se retiro.
 */
export async function resumenReprogramadasRetenidasCentral(
  deps: ReprogramadasRetenidasDeps = {},
): Promise<ResumenRetenidasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (!esAccesoTotal(actor.rol)) throw new ForbiddenError();
    const service = deps.service ?? buildReprogramadasRetenidasService(getPrismaClient());
    const hoyCR = startOfDayCR((deps.now ?? (() => new Date()))());
    const resumen = await service.resumen(hoyCR);
    return { status: "ok" as const, resumen: recortarPorAmbito(resumen, { tipo: "central" }) };
  });
  if (isAppErrorShape(r)) {
    const e = toActionError(r);
    if (e.status === "unauthenticated" || e.status === "forbidden") return e;
    // Esta accion no valida entrada ni busca por id: cualquier otro codigo es un error interno
    // real, y se propaga como tal (el handler global ya lo registro).
    throw new Error(`reprogramadas-retenidas: resultado inesperado ${e.status}`);
  }
  return r;
}
