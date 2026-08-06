"use server";

import { z } from "zod";
import {
  actualizarPlantillaSchema,
  cambiarEstadoPlantillaSchema,
  crearPlantillaSchema,
  listarPlantillasCompletoSchema,
  listarPlantillasSchema,
  previewPlantillaSchema,
  type ActionError,
  type ActualizarPlantillaResult,
  type CambiarEstadoPlantillaResult,
  type CrearPlantillaResult,
  type EliminarPlantillaResult,
  type ListarPlantillasCompletoResult,
  type ListarPlantillasResult,
  type ObtenerPlantillaResult,
  type PreviewPlantillaResult,
} from "@/lib/types/plantilla-mensaje";
import type {
  Actor,
  IPlantillaMensajeService,
} from "@/lib/interfaces/services/IPlantillaMensajeService";
import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import { WhatsappTemplatePort } from "@/lib/services/whatsapp/WhatsappTemplatePort";
import { PlantillaWhatsappPropagator } from "@/lib/services/whatsapp/plantilla-whatsapp-sync";
import { crearEncolarWhatsappTemplateSync } from "@/lib/services/jobs/whatsapp-template-sync-encolado";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import type { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  ValidationError,
  MSG,
  type AppErrorShape,
} from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";

const idSchema = z.string().min(1);

// Adapta el AppErrorShape del manejador global al ActionError propio. Los conflictos de
// unicidad los devuelve el service como resultado de dominio (`conflict` con `campo`); un
// `conflict` en el borde (thrown) no deberia ocurrir aqui. Patron `toUsuarioActionError`.
function toPlantillaActionError(shape: AppErrorShape): ActionError {
  const err = toActionError(shape);
  if (err.status === "conflict") {
    throw new Error(`unexpected conflict status in plantillas action: ${shape.code}`);
  }
  return err;
}

function buildPlantillaService(): IPlantillaMensajeService {
  const prisma = getPrismaClient();
  const repo = new PlantillaMensajeRepository(prisma);
  return new PlantillaMensajeService(repo, buildWhatsappPropagator(prisma, repo));
}

/**
 * Propagador local -> Meta. Si WhatsApp NO esta configurado todavia (faltan envs), degrada a
 * `undefined`: el CRUD local sigue funcionando y simplemente no propaga a Meta hasta que se
 * llenen las credenciales. Asi el modulo es usable sin la integracion activa.
 */
function buildWhatsappPropagator(
  prisma: PrismaClient,
  repo: PlantillaMensajeRepository,
): PlantillaWhatsappPropagator | undefined {
  let config;
  try {
    config = loadWhatsappConfig();
  } catch {
    return undefined; // WhatsApp no configurado -> sin propagacion
  }
  const port = new WhatsappTemplatePort(new WhatsappPlantillasClient({ config }), config);
  const encolar = crearEncolarWhatsappTemplateSync(new JobRepository(prisma));
  return new PlantillaWhatsappPropagator(port, repo, encolar);
}

export interface PlantillaActionDeps {
  plantillaService?: IPlantillaMensajeService;
  getActor?: () => Promise<Actor | null>;
}

/** R4/R5/R8: crear plantilla (nace `pending`). */
export async function crearPlantilla(
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<CrearPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4: antes de tocar el service
    const data = crearPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R9/R11)
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.crear(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R6/R7: listar plantillas paginadas. */
export async function listarPlantillas(
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ListarPlantillasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const data = listarPlantillasSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/**
 * Feature 170 (T B.2, design §4) — dataset COMPLETO del listado de plantillas, sin
 * paginacion, para la descarga. Calcado de `listarPlantillas`: mismo borde, mismo actor,
 * mismo schema (menos `page`/`pageSize`) y el MISMO servicio. Ninguna rama devuelve filas
 * junto a un error (R16/R17/R18).
 */
export async function listarPlantillasCompleto(
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ListarPlantillasCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = listarPlantillasCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.listarCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/**
 * R4/R5: obtener plantilla por id.
 *
 * @sin-superficie lectura de detalle para una pantalla de detalle que nunca se construyo: `configuracion/plantillas/page.tsx` usa `listarPlantillas` y `EditarPlantillaForm` recibe la plantilla por props y solo llama a `actualizarPlantilla`. `git log -S` no devuelve ningun commit en `app/` ni `components/`, asi que jamas tuvo consumidor. Deuda inocua (lectura, no capacidad perdida).
 */
export async function obtenerPlantilla(
  id: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ObtenerPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.obtener(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R20/R22: actualizar nombre y/o cuerpo. */
export async function actualizarPlantilla(
  id: unknown,
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<ActualizarPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = actualizarPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R22)
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.actualizar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R24/R25: DESACTIVAR (unica transicion del front). */
export async function cambiarEstadoPlantilla(
  id: unknown,
  input: unknown,
  deps: PlantillaActionDeps = {},
): Promise<CambiarEstadoPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const data = cambiarEstadoPlantillaSchema.parse(input); // ZodError -> VALIDATION_ERROR (R25)
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.cambiarEstado(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R27: eliminar (soft delete). */
export async function eliminarPlantilla(
  id: unknown,
  deps: PlantillaActionDeps = {},
): Promise<EliminarPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
    }
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.eliminar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}

/** R4/R5/R18: vista previa del cuerpo con los ejemplos del catalogo. */
export async function previewPlantilla(
  cuerpo: unknown,
  deps: PlantillaActionDeps = {},
): Promise<PreviewPlantillaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R4
    const parsed = previewPlantillaSchema.safeParse(cuerpo);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { cuerpo: ["cuerpo invalido"] } });
    }
    const service = deps.plantillaService ?? buildPlantillaService();
    return service.preview(parsed.data, actor);
  });
  return isAppErrorShape(r) ? toPlantillaActionError(r) : r;
}
