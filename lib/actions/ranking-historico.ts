"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esFechaCalendarioValida } from "@/lib/utils/fecha-cr";
import { PremioRankingRepository } from "@/lib/repositories/PremioRankingRepository";
import { RankingRepository } from "@/lib/repositories/RankingRepository";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { RankingSnapshotService } from "@/lib/services/RankingSnapshotService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IRankingSnapshotService,
  ObtenerSnapshotResult,
} from "@/lib/interfaces/services/IRankingSnapshotService";

// Feature 196 (design §6, T4.1) — Server Action de LECTURA del ranking historico congelado.
// Es Server Action y no route handler por coherencia con `lib/actions/ranking.ts`: consumo
// interno del propio proyecto, sin CORS ni API publica.
//
// Tres cosas y ninguna mas: resolver el actor por sesion, validar la fecha en el borde con
// zod (R30) y delegar en el servicio. NO hay `revalidatePath`: esto no muta nada, y revalidar
// una ruta desde una lectura es invalidar cache ajena por error. Tampoco hay formateo: el
// servicio ya devuelve `pct` y `premioMonto` como STRING (R31); reformatear aqui seria
// duplicar el redondeo del ranking en vivo en un segundo sitio que puede divergir.

// R30 — la fecha debe ser una fecha calendario que EXISTA. `esFechaCalendarioValida` hace el
// round-trip que caza `"2026-02-31"` (que un regex de forma aceptaria y que `new Date` rueda
// en silencio al 3 de marzo). `z.string()` cubre por si solo el no-string y el ausente.
const historicoSchema = z.object({
  fecha: z
    .string()
    .refine(esFechaCalendarioValida, { message: "Fecha invalida: se espera YYYY-MM-DD." }),
});

/** Entrada de la accion. `fecha` viaja como `unknown` hasta pasar por zod. */
export interface ObtenerRankingHistoricoInput {
  fecha: string;
}

export type ObtenerRankingHistoricoActionResult =
  | ObtenerSnapshotResult
  | { status: "unauthenticated" }
  | { status: "invalid"; message?: string };

function buildService(): IRankingSnapshotService {
  const prisma = getPrismaClient();
  return new RankingSnapshotService(
    new RankingSnapshotRepository(prisma),
    new RankingRepository(prisma),
    new UserRepository(prisma),
    new PremioRankingRepository(prisma),
  );
}

/** Deps inyectables para testear sin sesion, sin DB y sin entorno (patron `RankingActionDeps`). */
export interface RankingHistoricoActionDeps {
  service?: IRankingSnapshotService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R27/R30/R31 — histórico congelado de una fecha, ya serializado (montos y pct STRING).
 *
 * Orden de las comprobaciones, que importa: sin sesion se sale ANTES de mirar la entrada
 * (no se filtra por el mensaje de error si una fecha existe o no), y la fecha invalida se
 * rechaza ANTES de construir el service, de modo que una peticion malformada no llega a
 * tocar el almacenamiento (R30). El `forbidden` por rol lo decide el service, que es donde
 * vive la regla de autorizacion del histórico (R27/R28).
 */
export async function obtenerRankingHistoricoAction(
  input: unknown,
  deps: RankingHistoricoActionDeps = {},
): Promise<ObtenerRankingHistoricoActionResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsed = historicoSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues[0]?.message };
  }

  const service = deps.service ?? buildService();
  // R31: se devuelve TAL CUAL. El service ya serializo; aqui no se toca ni un decimal.
  return service.obtenerPorFecha(actor, parsed.data.fecha);
}
