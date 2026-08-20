"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { NovedadesService } from "@/lib/services/NovedadesService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  INovedadesService,
  ListarNovedadesServiceResult,
} from "@/lib/interfaces/services/INovedadesService";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type { GrupoNovedad } from "@/lib/types/novedad-grupo";
import type { NovedadDTO } from "@/lib/types/novedad";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 87 (T4, design §2.3) — Server Action de la lista de NOVEDADES (lectura interna del
// mismo proyecto -> Server Action, no Route API: el telefono del destinatario es PII, patron
// wallet-tienda.ts). Resuelve el actor por sesion, valida `page` en el borde con zod y delega
// en el service bajo `withErrorHandler`. `unauthenticated` (sin sesion) y `validation_error`
// (ZodError) se resuelven en el borde; `forbidden`/`ok` los devuelve el service. Se usa como
// pre-fetch server-side (pagina 1) desde la page Y como re-fetch de pagina desde el modulo
// cliente (patron `listarMisMovimientosAction`).

// R22: tamano de pagina FIJO. El cliente NO lo elige (no viaja en el input).
const PAGE_SIZE = 10;

// Valida solo `page` (entero >= 1, default 1). `input` opcional/undefined -> pagina 1
// (el borde normaliza a `{}` antes de parsear).
const listarNovedadesSchema = z.object({
  page: z.number().int().min(1).default(1),
});

/**
 * El listado COMPLETO no admite ninguna clave: su alcance sale SIEMPRE del actor de la sesion
 * (la tienda del adminTienda), nunca de la entrada. `.strict()` para que una clave inventada
 * —`tiendaId`, la que convertiria el archivo de una tienda en el de la vecina— sea un
 * `validation_error` y no un parametro ignorado en silencio. Lista blanca de CERO claves.
 */
const listarNovedadesCompletoSchema = z.object({}).strict();

export type ListarNovedadesActionResult =
  | ListarNovedadesServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/**
 * El conjunto ENTERO tal como lo recibe el cliente. Union de error ANCHO (`ListarCompletoResult`)
 * y no el estrecho de la pagina: quien lo consume es `filasDesdeResultado`, el adaptador comun de
 * la descarga, que redacta el mensaje de CUALQUIER error de borde en un solo sitio.
 * `limite_excedido` lleva SOLO conteos, jamas filas ni un conjunto truncado.
 */
export type ListarNovedadesCompletoActionResult = ListarCompletoResult<NovedadDTO>;

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toWalletTiendaActionError`.
function toNovedadesActionError(
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
      throw new Error(`novedades: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): INovedadesService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new NovedadesService(
    ordenRepo,
    // Feature 160 (R11/R26): derivador de intentos EN LOTE de la pagina de novedades.
    new OrdenHistorialService(ordenRepo, new OrdenHistorialRepository(prisma)),
  );
}

export interface NovedadesDeps {
  service?: INovedadesService;
  getActor?: () => Promise<Actor | null>;
}

/** R1/R5/R22: lista paginada (10/pagina) de las ordenes `devuelta` de la tienda del adminTienda. */
export async function listarNovedadesAction(
  input?: { page?: number },
  deps: NovedadesDeps = {},
): Promise<ListarNovedadesActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const { page } = listarNovedadesSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listar({ page, pageSize: PAGE_SIZE, grupo: GRUPO_DEVOLUCION }, actor);
  });
  return isAppErrorShape(r) ? toNovedadesActionError(r) : r;
}

/**
 * El MISMO listado SIN recorte por pagina, para la DESCARGA del archivo de novedades. Espejo
 * exacto de la de arriba: mismo actor de sesion, mismo service, mismo `withErrorHandler`. El
 * tope de filas lo evalua y lo aplica el SERVICIO; aqui solo se transporta lo que decidio.
 *
 * Feature 236 (T3.1, R38): al fijar el grupo, este archivo DEJA DE TRAER las ordenes en ayuda —
 * sin tocar su archivo de columnas—. Hasta hoy salian aqui con la columna «Causa de devolucion»
 * diciendo «Sin causa registrada» sobre una orden que nunca se devolvio.
 */
export async function listarNovedadesCompletoAction(
  input: unknown = {},
  deps: NovedadesDeps = {},
): Promise<ListarNovedadesCompletoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    listarNovedadesCompletoSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarCompleto({ grupo: GRUPO_DEVOLUCION }, actor);
  });
  return isAppErrorShape(r) ? toNovedadesActionError(r) : r;
}

// =============================================================================================
// Feature 236 (T2.6, design §4) — LA SUPERFICIE DE AYUDA: dos acciones propias, no una con bandera
// =============================================================================================
//
// POR QUE EL GRUPO **NO** VIAJA EN EL INPUT. Si el cliente eligiera el grupo, estaria eligiendo QUE
// ESTATUS SE CONSULTA, y este borde pasaria a tener un parametro de filtrado controlado desde fuera
// sobre la pantalla que ya sufrio una fuga de visibilidad. Aunque zod acotara el enum, la forma del
// riesgo es la misma. Con cuatro acciones, el grupo es una CONSTANTE DEL MODULO SERVIDOR: el cliente
// elige a que funcion llama, no que filtra.
//
// Es el mismo criterio con el que `listarNovedadesCompletoSchema` es `z.object({}).strict()` —lista
// blanca de CERO claves— para que un `tiendaId` inventado sea un error y no un parametro ignorado.
//
// Todo lo demas es copia literal de las dos de arriba: mismo `PAGE_SIZE`, mismos schemas, mismo
// `withErrorHandler`, `unauthenticated` ANTES de tocar el service y `forbidden` desde el service.

/** Constantes de MODULO SERVIDOR: el cliente no las puede elegir ni sobrescribir. */
const GRUPO_DEVOLUCION: GrupoNovedad = "devolucion";
const GRUPO_AYUDA: GrupoNovedad = "ayuda";

/**
 * R1/R12: la pagina (10/pagina) de las ordenes sobre las que los mensajeros de esta tienda PIDIERON
 * AYUDA (`ayuda_tienda`). Ordenadas por la fecha de la solicitud, la que lleva mas esperando primero
 * (D7/R17); el orden lo decide el servicio, no el cliente.
 *
 * SU SUPERFICIE (T4.1, cableada el 2026-08-19): la pestaña «Ayuda solicitada» de `/novedades` — el
 * pre-fetch de la pagina 1 en `app/(app)/novedades/page.tsx` y el re-fetch de pagina en
 * `NovedadesModule` via `RECURSOS_POR_GRUPO.ayuda`. Aqui vivio una anotacion `@sin-superficie`
 * TRANSITORIA mientras la pantalla era otra tanda del mismo PR; se retiro al cablearla, que es lo
 * que la guardia `superficie-de-uso` exige de toda anotacion en cuanto su motivo caduca.
 */
export async function listarAyudaTiendaAction(
  input?: { page?: number },
  deps: NovedadesDeps = {},
): Promise<ListarNovedadesActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const { page } = listarNovedadesSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listar({ page, pageSize: PAGE_SIZE, grupo: GRUPO_AYUDA }, actor);
  });
  return isAppErrorShape(r) ? toNovedadesActionError(r) : r;
}

/**
 * R37: el MISMO listado de ayuda SIN recorte por pagina, para su DESCARGA propia (D3). Mismo
 * alcance y mismo predicado que su pestaña — el archivo publica lo que la pantalla enseña.
 *
 * SU SUPERFICIE (T4.2, cableada el 2026-08-19): el `DescargarDatasetButton` de la pestaña «Ayuda
 * solicitada», que la llama a traves de `RECURSOS_POR_GRUPO.ayuda.listarCompleto` con las columnas
 * de `_components/ayuda-descarga-columnas.ts` —sin causa de devolucion (R39)—. Aqui vivio una
 * anotacion `@sin-superficie` TRANSITORIA mientras la pantalla era otra tanda del mismo PR; se
 * retiro al cablearla. Si hubiera sobrevivido, la pestaña habria salido SIN descarga y la tienda
 * habria PERDIDO una capacidad que ya tenia (esas filas hoy se descargan, mezcladas): la regresion
 * silenciosa que D3-(c) descartaba.
 */
export async function listarAyudaTiendaCompletoAction(
  input: unknown = {},
  deps: NovedadesDeps = {},
): Promise<ListarNovedadesCompletoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    listarNovedadesCompletoSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarCompleto({ grupo: GRUPO_AYUDA }, actor);
  });
  return isAppErrorShape(r) ? toNovedadesActionError(r) : r;
}
