"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { CierreDelDiaRepository } from "@/lib/repositories/CierreDelDiaRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaPremioRankingFeedService } from "@/lib/services/CajaPremioRankingFeedService";
import { PremioRankingDevengoService } from "@/lib/services/PremioRankingDevengoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularPremioResult,
  IPremioRankingDevengoService,
  ListarPremiosDelDiaResult,
  PremioTx,
  RegistrarPremioResult,
} from "@/lib/interfaces/services/IPremioRankingDevengoService";
import {
  anularPremioSchema,
  listarPremiosDelDiaSchema,
  registrarPremioSchema,
} from "@/lib/types/premio-ranking-devengo";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 293 (T4.3, design §7.3) — Server Actions del PREMIO DEL RANKING.
//
// Server Action y no route handler, por el mismo criterio que `lib/actions/wallet-mensajero.ts`:
// es una mutacion INTERNA del propio proyecto, sin CORS y sin API publica. Y ademas es lo que
// sostiene R1 — «unicamente desde `Wallet > Mensajeros`»: no existe ninguna URL que un webhook o
// una tarea programada puedan llamar.
//
// Cada action hace tres cosas y ninguna mas: resolver el actor por sesion, validar la entrada con
// zod EN EL BORDE y delegar en el servicio. `unauthenticated` (sin sesion) y `validation_error`
// (ZodError) se resuelven aqui; `forbidden` y el resto de estados los devuelve el servicio como
// resultado de DOMINIO.
//
// Sin `revalidatePath`: la pantalla refresca sus propias claves SWR tras escribir (design §9), que
// es un refresco DIRIGIDO. Invalidar una ruta entera desde aqui tiraria cache ajena.

export type ListarPremiosDelDiaActionResult =
  | ListarPremiosDelDiaResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type RegistrarPremioActionResult =
  | RegistrarPremioResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type AnularPremioActionResult =
  | AnularPremioResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** Traduce el `AppErrorShape` del borde: ZodError o falta de sesion. Espejo del de wallet. */
function toPremioActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`premio-ranking: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * COMPOSITION ROOT. Las cinco piezas se cablean aqui y solo aqui:
 *
 *  - el repositorio del SNAPSHOT (lectura del podio congelado);
 *  - el de la resolucion dia -> cierre (lectura, design §4);
 *  - el del LIBRO del mensajero, que es su UNICO escritor (censo de `caja-173-alcance`);
 *  - el PUERTO ESTRECHO de la caja, que encapsula su repositorio;
 *  - el runner de transaccion, que es lo unico que sabe de Prisma.
 *
 * El servicio NO recibe `IWalletMovimientoRepository` ni `IPremioRankingRepository`: no puede
 * escribir otra cosa en la caja (R20) ni leer el premio VIGENTE (R15) porque no tiene por donde.
 */
function buildService(): IPremioRankingDevengoService {
  const prisma = getPrismaClient();
  return new PremioRankingDevengoService(
    new RankingSnapshotRepository(prisma),
    new CierreDelDiaRepository(prisma),
    new PagoMensajeroMovimientoRepository(prisma),
    new CajaPremioRankingFeedService(new WalletMovimientoRepository(prisma)),
    // R20: UNA transaccion para las dos escrituras. Si cualquiera falla, no queda ninguna.
    (fn) => prisma.$transaction((tx) => fn(tx as unknown as PremioTx)),
  );
}

/** Deps inyectables para testear sin sesion y sin DB (patron `WalletMensajeroDeps`). */
export interface PremioRankingDeps {
  service?: IPremioRankingDevengoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * R2/R4/R6/R8/R9 — el podio congelado de una fecha con el estado de cada premio.
 *
 * Orden de las comprobaciones, que importa: sin sesion se sale ANTES de mirar la entrada, y la
 * fecha invalida o futura muere en zod ANTES de construir el servicio, de modo que una peticion
 * malformada no llega a tocar la base (R8).
 */
export async function listarPremiosDelDiaAction(
  input: unknown,
  deps: PremioRankingDeps = {},
): Promise<ListarPremiosDelDiaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2: antes de tocar el service
    const data = listarPremiosDelDiaSchema.parse(input); // R8: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPremiosDelDia(data, actor);
  });
  return isAppErrorShape(r) ? toPremioActionError(r) : r;
}

/**
 * R10-R23 — registra el premio de UNA fila del podio.
 *
 * **La entrada del cliente es `filaId` y NADA MAS** (R16), y el schema es `.strict()`: un
 * `monto`, un `mensajeroId` o un `cierreId` colados en el payload no se ignoran — hacen que la
 * peticion muera aqui con `validation_error`, que es mas ruidoso y mas seguro que descartarlos en
 * silencio.
 */
export async function registrarPremioAction(
  input: unknown,
  deps: PremioRankingDeps = {},
): Promise<RegistrarPremioActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = registrarPremioSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.registrarPremio(data, actor);
  });
  return isAppErrorShape(r) ? toPremioActionError(r) : r;
}

/** R29-R33 — anula un premio registrado. Sin motivo, o con el motivo vacio, muere aqui (R30). */
export async function anularPremioAction(
  input: unknown,
  deps: PremioRankingDeps = {},
): Promise<AnularPremioActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = anularPremioSchema.parse(input); // R30: motivo obligatorio, ya recortado
    const service = deps.service ?? buildService();
    return service.anularPremio(data, actor);
  });
  return isAppErrorShape(r) ? toPremioActionError(r) : r;
}
