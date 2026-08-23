"use server";

import {
  listarOrdenesSchema,
  listarOrdenesCompletoSchema,
  type ListarOrdenesCompletoResult,
  type ListarOrdenesResult,
} from "@/lib/types/orden";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import { OrdenService } from "@/lib/services/OrdenService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

function buildOrdenService(): IOrdenService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new OrdenService(
    ordenRepo,
    // Feature 160 (R11): derivador de intentos EN LOTE del listado. Mismo servicio (y por tanto
    // mismo criterio) que consumen el cron SLA y el drawer de historial: un solo numero.
    new OrdenHistorialService(
      ordenRepo,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
  );
}

export interface OrdenActionDeps {
  ordenService?: IOrdenService;
  getActor?: () => Promise<Actor | null>;
}

// BORRADO 2026-08-07 (chore de deuda de superficie, decision humana): aqui vivian `crearOrden`,
// `obtenerOrden`, `actualizarOrden` y `borrarOrden` — el andamiaje CRUD del arranque
// (`07c63d8b`, 2026-07-09). `git log -S` sobre `app/` y `components/` devolvia VACIO para las
// cuatro: NACIERON MUERTAS, nunca tuvieron pantalla. La creacion real entra por la carga masiva
// (`app/api/ordenes/api-key/**` instancia `BulkOrdenService`/`ApiOrdenLecturaService` directo),
// el detalle se sirve por props desde la pagina y las ediciones pasan por las acciones de
// dominio (guia, asignacion, incidencias). Lo que queda vivo en este archivo son las DOS
// lecturas del listado, y esas si tienen consumidor: `ordenes/_components/OrdenesModule.tsx`.
// OJO: `tests/integration/db/_semilla-rollup.ts` exporta un helper de siembra TAMBIEN llamado
// `crearOrden`. Es un homonimo sin relacion con esto; no lo confundas en un `grep`.

/** R30/R31/R32/R33/R34: listar ordenes paginadas. */
export async function listarOrdenes(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ListarOrdenesResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R18
    const data = listarOrdenesSchema.parse(input ?? {}); // R32: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}

/**
 * Feature 151 (R11/R13/R14/R15/R20): dataset COMPLETO del listado, sin paginacion, para
 * la descarga. Calcado de `listarOrdenes` a proposito: mismo borde, mismo actor, mismo
 * schema (menos `page`/`pageSize`) y el MISMO servicio, que es quien autoriza, acota por
 * rol y aplica el tope. Ninguna fila viaja junto a un error.
 */
export async function listarOrdenesCompleto(
  input: unknown,
  deps: OrdenActionDeps = {},
): Promise<ListarOrdenesCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R13
    const data = listarOrdenesCompletoSchema.parse(input ?? {}); // R15: ZodError -> VALIDATION_ERROR
    const service = deps.ordenService ?? buildOrdenService();
    return service.listarCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
