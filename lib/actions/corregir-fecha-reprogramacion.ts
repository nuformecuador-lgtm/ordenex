"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { CorreccionFechaReprogramacionRepository } from "@/lib/repositories/CorreccionFechaReprogramacionRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CorreccionFechaReprogramacionService } from "@/lib/services/CorreccionFechaReprogramacionService";
// FICHA 371: el timbre de la liberacion tras corregir. `buildLiberarReprogramadasService` es el
// MISMO ensamblaje que usan el cron de las 00:00 CR y la aprobacion de un cierre (315): tres
// cableados distintos del mismo servicio serian tres comportamientos que pueden divergir.
import { liberarTrasCorregirFechaCon } from "@/lib/services/liberacion-tras-corregir-fecha";
import { buildLiberarReprogramadasService } from "@/lib/services/jobs/liberar-reprogramadas-handler";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { fechaCorreccionSchema, motivoSchema } from "@/lib/types/gestion-orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CorregirFechaReprogramacionServiceResult,
  ICorreccionFechaReprogramacionService,
} from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// FICHA 371 — Server Action que CORRIGE la fecha de una reprogramacion ya registrada. Mutacion
// interna del mismo proyecto => Server Action, nunca ruta API (`docs/architecture.md`). Molde
// literal de `lib/actions/corregir-dia-reparto.ts` (262): `withErrorHandler` +
// `resolveActorFromSession` + zod en el borde + fabrica del service. NINGUNA regla de negocio aqui:
// esta capa es el borde y el reviewer lo rechaza si deja de serlo.

/**
 * EL BORDE.
 *
 * ⚠️ `fecha` USA `fechaCorreccionSchema` Y NO `fechaFuturaSchema`, Y ESA ES LA DIFERENCIA QUE HACE
 * UTIL LA FICHA. El registro original de una reprogramacion exige `>= mañana`; la CORRECCION admite
 * HOY. El caso REAL que origina la ficha —corregir del 4 al 3 estando a dia 3— habria fallado en
 * este mismo borde con la regla del registro. El porque completo esta escrito junto a
 * `esFechaCorreccionValida` en `lib/types/gestion-orden.ts`, al lado de la regla de la que diverge.
 *
 * ⚠️ `motivo` REUSA `motivoSchema`, el MISMO que valida el motivo al reprogramar. Decision del
 * humano (2026-09-03): «el motivo si tiene que ir, basicamente es la misma gestion que
 * reprogramar». Por eso NO se copia el `min(10).max(300)` de la 262: aquella tiene su propia regla y
 * aqui el criterio es «igual que reprogramar». `trim()` corre dentro del schema, asi que «   »
 * queda en «» y falla; el valor que llega al service ya viene RECORTADO.
 *
 * `.strict()`: una clave desconocida es `validation_error`, no un descarte mudo (leccion de la 352).
 */
const corregirFechaReprogramacionSchema = z
  .object({
    ordenId: z.string().uuid(),
    fecha: fechaCorreccionSchema,
    motivo: motivoSchema,
  })
  .strict();

/** Estados del BORDE (los de dominio los devuelve el service). */
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type CorregirFechaReprogramacionActionResult =
  | CorregirFechaReprogramacionServiceResult
  | BorderError;

export interface CorregirFechaReprogramacionDeps {
  service?: ICorreccionFechaReprogramacionService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * COMPOSITION ROOT. El liberador REAL se inyecta AQUI y solo aqui: el default del service es el
 * no-op, asi que una suite que lo construya sin inyectar no mueve ni una orden.
 *
 * ⚠️ SIN LA TERCERA LINEA, corregir a HOY dejaria la orden esperando al cron de medianoche —en
 * produccion, con toda la suite en verde—: es el fallo mudo que la 271 y la 315 ya documentaron en
 * este mismo punto. Lo vigila `tests/unit/guards/correccion-fecha-reprogramacion.guardia.test.ts`,
 * que exige que este archivo PASE el liberador real, no solo que lo importe.
 */
function buildService(): ICorreccionFechaReprogramacionService {
  const prisma = getPrismaClient();
  return new CorreccionFechaReprogramacionService(
    new CorreccionFechaReprogramacionRepository(prisma),
    new OrdenRepository(prisma),
    liberarTrasCorregirFechaCon(buildLiberarReprogramadasService()),
  );
}

/** Traduce el `AppErrorShape` que puede producir este borde: ZodError o falta de sesion. */
function toCorregirFechaActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`corregir-fecha-reprogramacion: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Corrige la fecha de la reprogramacion VIGENTE de una orden que sigue esperando, deja el rastro
 * —tabla propia con el motivo + fila del historial de acciones— y, si la fecha corregida ya vencio,
 * dispara la MISMA liberacion que el cron para que la orden vuelva a bodega en el acto.
 *
 * EL RESULTADO DICE QUE PASO CON LA ORDEN (`liberacion`): `liberada`, `espera_cierre` —la puerta de
 * la 276 la retuvo— o `espera_fecha`. Sin ese dato, corregir a hoy y ver la orden quieta seria
 * cambiar una confusion por otra.
 *
 * `unauthenticated` (sin sesion) y `validation_error` (uuid invalido, fecha anterior a hoy o
 * inexistente, motivo vacio) se resuelven en el BORDE, sin construir el service ni tocar dato
 * alguno; `forbidden` (rol que no es maestro/admin) y `conflict` los devuelve el service.
 *
 * LA ANOTACION `@sin-superficie` DE ESTE EXPORT SE RETIRO al montar la pantalla (ficha 371, tanda
 * de UI): la dispara `CorregirFechaReprogramacionModal`, que monta `/ordenes` desde el estado
 * `reprogramada`. La guardia de superficie exige exactamente eso —la excepcion caduca en cuanto
 * lo anotado vuelve a ser alcanzable— y se pone roja si alguien la reescribe.
 */
export async function corregirFechaReprogramacion(
  input: unknown,
  deps: CorregirFechaReprogramacionDeps = {},
): Promise<CorregirFechaReprogramacionActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de leer o escribir nada
    const data = corregirFechaReprogramacionSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.corregir(
      { ordenId: data.ordenId, fecha: data.fecha, motivo: data.motivo },
      actor,
    );
  });
  return isAppErrorShape(r) ? toCorregirFechaActionError(r) : r;
}
