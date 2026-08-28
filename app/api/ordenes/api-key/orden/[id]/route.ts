// Feature 177 (T13, design §5.1/§5.4) — CONSULTA del detalle de UNA orden propia por un
// identificador libre `{id}`, resuelto contra `num_guia` Y `num_remision` con la precedencia
// fija decidida en la puerta F1.4 (`num_guia` gana, R14/R15; NUNCA 409).
// `GET /api/ordenes/api-key/orden/{id}`. Autenticacion por API key (feature 88): el owner es
// SIEMPRE `actor.usuarioId` (R4), jamas un parametro de la peticion. Una orden inexistente,
// borrada o de otro owner devuelve EXACTAMENTE el mismo 404 (R11/R12): no se filtra la
// existencia de recursos ajenos. La key NUNCA se loguea ni se serializa (R5).
//
// Controller puro: HTTP + zod + llamada al service. Ni Prisma ni logica de negocio aqui.
//
// ─── FICHA 320 (2026-08-28) — `DELETE /api/ordenes/api-key/orden/{id}` ───────────────────────
//
// EL PRIMER `DELETE` DE TODA LA API PUBLICA, y va aqui —mismo modulo, misma ruta, otro verbo— en
// vez de en un sub-recurso `/eliminar`. Las razones, en orden:
//   1. Es literalmente retirar EL RECURSO que esta ruta identifica: tras el borrado, un `GET` a
//      la MISMA URL devuelve 404. Eso es lo que significa `DELETE`, y ningun nombre de accion en
//      el path lo dice mejor.
//   2. `cancelar` (feature 106) es un `PUT` a `/{numGuia}/cancelar` y hace bien en serlo: NO
//      retira nada, transiciona la orden a `devolviendo_a_tienda` y la orden sigue existiendo.
//      Una accion que deja el recurso vivo es un sub-recurso; una que lo retira es `DELETE`.
//   3. El integrador no aprende ninguna URL nueva: es la que ya usa para consultar la orden.
//   4. El motivo que llevo a la 177 a elegir `POST` y no `GET` para `/generate` —un `GET` es
//      pre-fetcheable por navegadores, crawlers y proxies— no aplica: `DELETE` no se pre-fetchea
//      ni se cachea nunca. Y este canal es servidor-a-servidor con `Authorization: Bearer`.
// `middleware.ts` NO se toca: `SELF_AUTH_ROUTES` cubre el prefijo `/api/ordenes/api-key` para
// cualquier verbo, y la guardia 229 compara sus listas contra una firmada.
//
// POR QUE SE IDENTIFICA POR `{id}` (guia O remision) Y NO POR `num_guia`, que es EL punto de la
// ficha: la orden que mas necesita este endpoint es la que todavia NO tiene guia. Con fulfillment
// nace en `en_preparacion` y el paso siguiente es justamente generar la guia; identificarla por
// `num_guia` la dejaria inalcanzable durante toda la ventana en la que se la quiere retirar. Ese
// es el defecto que ya tiene `cancelar`, y no se repite. `num_remision` es NOT NULL, lo provee el
// propio integrador al cargarla y es UNICA POR TIENDA entre las ordenes VIVAS (indice parcial
// `orden_tienda_id_num_remision_key`), asi que siempre hay un identificador que el integrador
// conoce. Se reusa `idOrdenApiSchema` + `ApiOrdenResolucionService` (la precedencia `num_guia` >
// `num_remision` de la 177), sin escribir una segunda forma de resolver una orden.
import { NextResponse } from "next/server";
import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  MSG,
} from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenResolucionService } from "@/lib/interfaces/services/IApiOrdenResolucionService";
import type { IApiOrdenEliminacionService } from "@/lib/interfaces/services/IApiOrdenEliminacionService";
import type { ApiOrdenDetalleDTO } from "@/lib/types/api-orden";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { ApiOrdenEliminacionService } from "@/lib/services/ApiOrdenEliminacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { gestionConfig } from "@/lib/config/gestion";
import { extraerBearer, buildAutenticar } from "@/lib/api/api-key-request";
import { idOrdenApiSchema } from "@/lib/api/api-orden-identificador";

/** Lee el detalle publico (DTO de la feature 106) de una orden YA resuelta a `orden.id`. */
export type DetallePorOrdenId = (
  actor: Actor,
  ordenId: string,
) => Promise<ApiOrdenDetalleDTO | null>;

export interface ConsultaOrdenApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  resolucionService?: IApiOrdenResolucionService;
  detallePorOrdenId?: DetallePorOrdenId;
}

function buildResolucionService(): IApiOrdenResolucionService {
  return new ApiOrdenResolucionService(new OrdenRepository(getPrismaClient()));
}

/**
 * R16/R17 — el DTO de detalle lo produce el `ApiOrdenLecturaService` YA EXISTENTE de la 106:
 * mismo mapeo, mismas evidencias firmadas a 5 min, mismo `[]` cuando no hay. Como su
 * `detalle(actor, numGuia)` opera por `num_guia` (que puede ser NULL) y aqui la resolucion
 * entrega un `orden.id`, se usa su metodo hermano `detallePorOrdenId(actor, ordenId)`, que
 * comparte el mapeo/firmado y lee por `findDetalleByOrdenIdForOwner` (MISMA proyeccion,
 * `IOrdenRepository:617-622`). `detalle` de la 106 no se toca (R17).
 */
function buildDetallePorOrdenId(): DetallePorOrdenId {
  const prisma = getPrismaClient();
  const signedUrls = new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET);
  const lectura = new ApiOrdenLecturaService(new OrdenRepository(prisma), signedUrls);
  return (actor, ordenId) => lectura.detallePorOrdenId(actor, ordenId);
}

/** Logica del endpoint, con `{id}` crudo y `deps` inyectables para tests (sin DB). */
export async function handleConsultaOrdenApi(
  req: Request,
  rawId: string,
  deps: ConsultaOrdenApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R3/R5: autenticacion por API key ANTES de cualquier lectura de ordenes o Storage.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1/R2 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R3 -> 403

    // 2. R13: validacion del path param SIN consultar la base.
    const parsed = idOrdenApiSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: {
          id: ["id invalido: requerido, no vacio y de hasta 128 caracteres"],
        },
      });
    }

    // 3. R6-R15: resolucion con el owner forzado y precedencia `num_guia` > `num_remision`.
    //    El dominio no tiene estado `ambiguo`, asi que este endpoint NUNCA responde 409.
    const resolucion = deps.resolucionService ?? buildResolucionService();
    const resuelta = await resolucion.resolver(auth.actor, parsed.data);
    if (resuelta.status === "not_found") throw new NotFoundError(); // R11/R12 -> 404 uniforme

    // 4. R16/R18: detalle publico (mismo DTO de la 106), sin storage_path, sin bucket, sin ids
    //    internos y sin PII del mensajero.
    const detalle = await (deps.detallePorOrdenId ?? buildDetallePorOrdenId())(
      auth.actor,
      resuelta.orden.id,
    );
    // Carrera (borrada entre la resolucion y la lectura): MISMO 404, sin filtrar nada.
    if (!detalle) throw new NotFoundError();
    return detalle;
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  return handleConsultaOrdenApi(req, id);
}

// ─── FICHA 320 — BORRADO (`DELETE`) ──────────────────────────────────────────────────────────

export interface EliminarOrdenApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  resolucionService?: IApiOrdenResolucionService;
  eliminacionService?: IApiOrdenEliminacionService;
}

function buildEliminacionService(): IApiOrdenEliminacionService {
  return new ApiOrdenEliminacionService(new OrdenRepository(getPrismaClient()));
}

/**
 * Logica del `DELETE`, con `{id}` crudo y `deps` inyectables para tests (sin DB).
 *
 * MISMOS pasos que el `GET` de arriba, en el MISMO orden y con los MISMOS 401/403/422/404: la
 * unica diferencia es el ultimo, que borra en vez de leer. Que se parezcan tanto es deliberado —
 * son el mismo recurso y la misma resolucion, solo cambia el verbo.
 */
export async function handleEliminarOrdenApi(
  req: Request,
  rawId: string,
  deps: EliminarOrdenApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. Autenticacion ANTES de tocar orden alguna. La key nunca se loguea.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // -> 403

    // 2. Validacion del path param SIN consultar la base (mismo zod que el GET).
    const parsed = idOrdenApiSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: {
          id: ["id invalido: requerido, no vacio y de hasta 128 caracteres"],
        },
      });
    }

    // 3. Resolucion `{id}` -> `orden.id` con el owner FORZADO en el `where` (177).
    const resolucion = deps.resolucionService ?? buildResolucionService();
    const resuelta = await resolucion.resolver(auth.actor, parsed.data);
    if (resuelta.status === "not_found") throw new NotFoundError(); // 404 uniforme

    // 4. Borrado. El service vuelve a exigir el dueño: el controller NO le pasa ningun owner
    //    que venga de la peticion, y el service no da por buena la resolucion previa.
    const eliminacion = deps.eliminacionService ?? buildEliminacionService();
    const res = await eliminacion.eliminar(auth.actor, resuelta.orden.id);
    // Ajena, inexistente, ya borrada o carrera: SIEMPRE el mismo 404. Un 401/403 aqui delataria
    // que la orden EXISTE y es de otro —justo lo que el 404 uniforme del canal evita—.
    if (res.status === "not_found") throw new NotFoundError();
    // Propia y viva, pero en un estado que no admite borrado -> 409, como `cancelar`.
    if (res.status === "conflict") throw new ConflictError();
    return res.data; // 200 { numGuia, numRemision, estado }
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  return handleEliminarOrdenApi(req, id);
}
