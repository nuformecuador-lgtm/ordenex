"use server";

import type { ActionError } from "@/lib/types/orden";
import {
  resumenCargaSchema,
  type ResumenCargaOrdenDTO,
} from "@/lib/types/carga-masiva-resumen";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IResumenCargaMasivaService } from "@/lib/interfaces/services/IResumenCargaMasivaService";
import { ResumenCargaMasivaService } from "@/lib/services/ResumenCargaMasivaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

// Feature 16 — Server Action del resumen del lote recien cargado. Feature 159: el
// archivo se llamaba `lib/actions/mensajeros.ts` y exportaba ademas el listado de
// mensajeros y la accion de sugerir asignacion; ambas se retiraron con la
// sugerencia de mensajero (design §2.3, R19).

function buildResumenService(): IResumenCargaMasivaService {
  return new ResumenCargaMasivaService(new OrdenRepository(getPrismaClient()));
}

export interface CargaMasivaResumenActionDeps {
  resumenService?: IResumenCargaMasivaService;
  getActor?: () => Promise<Actor | null>;
}

export type ResumenCargaMasivaResult =
  | { status: "ok"; ordenes: ResumenCargaOrdenDTO[] }
  | ActionError;

/** R6/R11/R19: resumen del lote recien cargado (num_remision -> orden). */
export async function resumenCargaMasiva(
  input: unknown,
  deps: CargaMasivaResumenActionDeps = {},
): Promise<ResumenCargaMasivaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = resumenCargaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.resumenService ?? buildResumenService();
    return service.resumenCargaMasiva(data, actor);
  });
  return isAppErrorShape(r) ? toActionError(r) : r;
}
