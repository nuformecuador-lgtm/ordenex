"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { RankingRepository } from "@/lib/repositories/RankingRepository";
import { PremioRankingRepository } from "@/lib/repositories/PremioRankingRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { RankingService } from "@/lib/services/RankingService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRankingService } from "@/lib/interfaces/services/IRankingService";
import type { RankingData } from "@/lib/types/ranking";

// Feature 76 (design §6) — Server Actions del ranking DIARIO (controller interno; NO route
// handler porque es mutacion del mismo proyecto sin CORS/API publica). Resuelve el actor por
// sesion, valida en el borde con zod (R11) y delega en el servicio. Money-safe: el service ya
// serializa montos/pct a STRING (R12). `revalidatePath("/ranking")` refresca tras editar (R10).

// Cambio de alcance (2026-07-16): el premio lleva monto + descripcion (rotulo libre opcional,
// INDEPENDIENTE del monto). Max de descripcion para no dejarla ilimitada.
const DESCRIPCION_MAX = 200;

// R11: posicion 1|2|3; monto STRING no negativo con <=2 decimales, string vacio -> null
// ("sin premio", R9). Rechaza negativo, >2 decimales y no-numerico -> validation error.
// descripcion: texto libre opcional, string vacio -> null, con trim y max DESCRIPCION_MAX.
const editarPremioSchema = z.object({
  posicion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  monto: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null ? null : v.trim()))
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d+(\.\d{1,2})?$/.test(v), {
      message: "Monto invalido: numero no negativo con hasta 2 decimales.",
    }),
  descripcion: z
    .union([z.string(), z.null()])
    .transform((v) => (v === null ? null : v.trim()))
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || v.length <= DESCRIPCION_MAX, {
      message: `Descripcion invalida: maximo ${DESCRIPCION_MAX} caracteres.`,
    }),
});

export type ObtenerRankingActionResult =
  | { status: "ok"; data: RankingData }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

export type EditarPremioActionResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "invalid"; message?: string };

function buildService(): IRankingService {
  const prisma = getPrismaClient();
  return new RankingService(
    new RankingRepository(prisma),
    new UserRepository(prisma),
    new PremioRankingRepository(prisma),
  );
}

export interface RankingActionDeps {
  service?: IRankingService;
  getActor?: () => Promise<Actor | null>;
  now?: Date;
}

/** R12/R16/R17/R18: lee el ranking del dia ya serializado (montos y pct STRING). */
export async function obtenerRankingAction(
  deps: RankingActionDeps = {},
): Promise<ObtenerRankingActionResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18: sin sesion, sin datos
  const service = deps.service ?? buildService();
  return service.obtenerRanking(actor, deps.now);
}

/** R10/R11/R19: edita el monto de una posicion del podio (solo maestro). */
export async function editarPremioAction(
  input: unknown,
  deps: RankingActionDeps = {},
): Promise<EditarPremioActionResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R18

  const parsed = editarPremioSchema.safeParse(input);
  if (!parsed.success) {
    // R11: monto/posicion invalidos -> rechazo sin persistir.
    return { status: "invalid", message: parsed.error.issues[0]?.message };
  }

  const service = deps.service ?? buildService();
  const result = await service.editarPremio(actor, parsed.data);
  if (result.status === "ok") revalidatePath("/ranking"); // R10: refresca la siguiente lectura
  return result;
}
