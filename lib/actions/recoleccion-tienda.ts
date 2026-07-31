"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecoleccionTiendaService } from "@/lib/services/RecoleccionTiendaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRecoleccionTiendaService } from "@/lib/interfaces/services/IRecoleccionTiendaService";
import {
  recolectarEnTiendaSchema,
  type ListarRecoleccionResult,
  type RecolectarEnTiendaResult,
} from "@/lib/types/recoleccion-tienda";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 157 — Server Action de la RECOLECCION EN TIENDA (mutacion interna: Server Action, no
// Route API). Resuelve el actor por sesion, valida en el borde con zod y delega en el servicio,
// TODO bajo `withErrorHandler`. Espejo de `lib/actions/recepcion-bodega-central.ts`.

/**
 * Traduce el AppErrorShape que puede producir este borde: solo ZodError (VALIDATION_ERROR,
 * R20) o falta de sesion (UNAUTHORIZED, R29). El resto de estados los devuelve el service como
 * resultado de dominio. Falla fuerte ante un code inesperado (no lo enmascara como un
 * resultado de dominio).
 */
function toRecoleccionTiendaActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors:
          (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`recoleccion-tienda: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Feature 167 — traductor del borde de la LECTURA. Este borde NO tiene zod (no recibe entrada
 * externa), asi que el UNICO AppErrorShape esperable es la falta de sesion. Cualquier otro code
 * —un INTERNAL por una caida de la base, por ejemplo— se propaga como fallo real en vez de
 * disfrazarse de "no autenticado": decirle al mensajero que su sesion expiro cuando lo que se
 * cayo fue Postgres es exactamente el tipo de mensaje impreciso que el humano ya rechazo
 * (commit `8428498a`, "cada rechazo dice su causa real y que hacer").
 */
function toListarRecoleccionActionError(shape: AppErrorShape): { status: "unauthenticated" } {
  if (shape.code === "UNAUTHORIZED") return { status: "unauthenticated" };
  throw new Error(`recoleccion-tienda (listar): AppErrorCode inesperado ${shape.code}`);
}

function buildService(): IRecoleccionTiendaService {
  const prisma = getPrismaClient();
  return new RecoleccionTiendaService(
    new OrdenRepository(prisma),
    // Feature 167 (design §10, A5): se REUSA `findMisAsignaciones` en vez de duplicar en otro
    // repo el "ordenes de este mensajero en estos estados" con su propio WHERE de propiedad y
    // de `deleted_at`. Coste conocido y aceptado: `GestionOrdenRepository` se construye con su
    // cableado por defecto de encolado de rutas, INERTE en una lectura (solo se dispara en las
    // escrituras, que este service no invoca).
    new GestionOrdenRepository(prisma),
    // Feature 167 (R25): «Recolectadas hoy» sale del historial de la transicion.
    new OrdenHistorialRepository(prisma),
  );
}

export interface RecoleccionTiendaDeps {
  service?: IRecoleccionTiendaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Confirma la recoleccion en la tienda de la orden del `num_guia` escaneado (el QR codifica
 * `/paquete/<numGuia>`): `por_recolectar_en_tienda -> en_ruta_bodega_central`. El rol
 * (`mensajero`), la propiedad de la orden y la guardia de estado los impone el service,
 * server-side.
 */
export async function recolectarEnTiendaPorQr(
  input: unknown,
  deps: RecoleccionTiendaDeps = {},
): Promise<RecolectarEnTiendaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recolectarEnTiendaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recolectarEnTienda(data.numGuia, actor);
  });
  return isAppErrorShape(r) ? toRecoleccionTiendaActionError(r) : r;
}

/**
 * Feature 167 (R6) — LECTURA del apartado propio de recoleccion, para que la pagina
 * (`/recoleccion`, Server Component) le pase los datos al modulo de cliente POR PROPS. El
 * componente de cliente NO fetchea: son datos de una superficie autenticada.
 *
 * Va en el MISMO archivo de acciones que la confirmacion porque es el mismo dominio y el mismo
 * service; un `lib/actions/recoleccion.ts` aparte solo repartiria el dominio en dos ficheros.
 *
 * SIN zod: no recibe entrada externa. El unico dato que gobierna la lectura es el actor de
 * sesion, y ese no viaja como parametro — se resuelve aqui, server-side. El rol (`mensajero`) lo
 * impone el service.
 */
export async function listarRecoleccion(
  deps: RecoleccionTiendaDeps = {},
): Promise<ListarRecoleccionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.listarRecoleccion(actor);
  });
  return isAppErrorShape(r) ? toListarRecoleccionActionError(r) : r;
}
