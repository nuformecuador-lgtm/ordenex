"use server";

import {
  asignarBodegaSchema,
  asignarRecoleccionSchema,
  desasignarRecoleccionSchema,
  generarGuiaSchema,
  rutearSateliteSchema,
  type AsignarBodegaResult,
  type AsignarRecoleccionResult,
  type GenerarGuiaResult,
  type ListarMensajerosParaAsignacionResult,
  type ListarZonasBloqueadasResult,
  type RutearSateliteResult,
} from "@/lib/types/orden-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGuiaAsignacionService } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

function buildGuiaService(): IGuiaAsignacionService {
  const prisma = getPrismaClient();
  // Feature 30/R18: inyecta ademas ZonaRepository (guardia GAM); firmas estables.
  // Feature 92/R8: + el gate de asignabilidad por coordenadas, que lee la cola de jobs.
  return new GuiaAsignacionService(
    new OrdenRepository(prisma),
    new ZonaRepository(prisma),
    new AsignabilidadCoordenadasService(new JobRepository(prisma)),
  );
}

function buildOrdenRepo(): Pick<
  IOrdenRepository,
  | "findMensajerosByZona"
  | "findMensajerosBloqueados"
  | "findMensajerosConOrdenesEn" // feature 157: regla de dedicación
> {
  return new OrdenRepository(getPrismaClient());
}

function buildZonaRepoParaMensajeros(): Pick<IZonaRepository, "findCentralZonaId"> {
  return new ZonaRepository(getPrismaClient());
}

function buildOrdenRepoParaZonasBloqueadas(): Pick<
  IOrdenRepository,
  "findZonasConMensajeroBloqueado"
> {
  return new OrdenRepository(getPrismaClient());
}

export interface GuiaActionDeps {
  guiaService?: IGuiaAsignacionService;
  getActor?: () => Promise<Actor | null>;
}

export interface ListarMensajerosDeps {
  ordenRepo?: Pick<
    IOrdenRepository,
    | "findMensajerosByZona"
    | "findMensajerosBloqueados"
    | "findMensajerosConOrdenesEn" // feature 157: regla de dedicación
  >;
  zonaRepo?: Pick<IZonaRepository, "findCentralZonaId">;
  getActor?: () => Promise<Actor | null>;
}

export interface ListarZonasBloqueadasDeps {
  ordenRepo?: Pick<IOrdenRepository, "findZonasConMensajeroBloqueado">;
  getActor?: () => Promise<Actor | null>;
}

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR) o falta de sesion (UNAUTHORIZED, R14). `forbidden` y
// `conflict` los devuelve el service directamente como resultado de dominio
// (nunca como excepcion), por eso NO aparecen aqui.
function toGuiaActionError(
  shape: AppErrorShape,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      // FORBIDDEN/NOT_FOUND/CONFLICT/INTERNAL: este borde nunca los lanza como
      // AppError; si algo desconocido llega aqui, se propaga como fallo real.
      throw new Error(`ordenes-guia: AppErrorCode inesperado ${shape.code}`);
  }
}

/** R11-R14/R18-R25/R27-R29: genera guia y transiciona el lote (solo maestro). */
export async function generarGuia(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<GenerarGuiaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R14: antes de tocar el service
    const data = generarGuiaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.guiaService ?? buildGuiaService();
    return service.generarGuia(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/** R26-R29: asigna mensajero a ordenes en_bodega_central (solo maestro). */
export async function asignarDesdeBodega(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = asignarBodegaSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.asignarDesdeBodega(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * Feature 157 (R3-R9): asigna el mensajero que ira a la tienda a RECOLECTAR el lote. NO
 * transiciona (la orden sigue en `por_recolectar_en_tienda` hasta que el mensajero confirme):
 * escribe solo `mensajero_asignado_id`. Solo acceso total.
 */
export async function asignarRecoleccion(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarRecoleccionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = asignarRecoleccionSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.asignarRecoleccion(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * Feature 157 (ampliacion): "Quitar mensajero" de una recolección asignada. La devuelve a
 * `por_recolectar_en_tienda` y sin mensajero, para poder asignarla a otro. Solo acceso total.
 */
export async function desasignarRecoleccion(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarRecoleccionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = desasignarRecoleccionSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.desasignarRecoleccion(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * Feature 30/R5/R18: SOLO los usuarios rol mensajero de la zona GAM (firma y tipo
 * `MensajeroLiteDTO[]` intactos respecto a la feature 17). Resuelve `centralZonaId` y
 * filtra por zona en el repo; si aun no hay zona GAM configurada -> lista vacia
 * (la UI ya maneja lista vacia; la escritura falla con R4 en el service, mensaje
 * claro). `maestro` escribe y `admin` es solo-lectura (R16); ambos pueden listar
 * mensajeros para el modal. El resto -> forbidden.
 */
export async function listarMensajerosParaAsignacion(
  deps: ListarMensajerosDeps = {},
): Promise<ListarMensajerosParaAsignacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "maestro" && actor.rol !== "admin") {
      return { status: "forbidden" as const };
    }
    const zonaRepo = deps.zonaRepo ?? buildZonaRepoParaMensajeros();
    const centralZonaId = await zonaRepo.findCentralZonaId();
    if (centralZonaId === null) {
      // R5: sin zona GAM configurada, no hay mensajeros GAM que listar.
      return { status: "ok" as const, mensajeros: [] };
    }
    const repo = deps.ordenRepo ?? buildOrdenRepo();
    const mensajeros = await repo.findMensajerosByZona(centralZonaId);
    // Ajuste maestro: marca los mensajeros GAM con un cierre abierto para que la UI los
    // deshabilite en el selector (no se les asignan nuevas órdenes hasta resolverlo).
    const ids = mensajeros.map((m) => m.id);
    const bloqueados = await repo.findMensajerosBloqueados(ids);
    // Feature 157 (regla de dedicación): repartir y recolectar son viajes incompatibles.
    // Se marcan las DOS caras para que cada modal deshabilite la suya y el maestro vea el
    // motivo en vez de toparse con un rechazo del servidor al confirmar.
    const [conReparto, conRecoleccion] = await Promise.all([
      repo.findMensajerosConOrdenesEn(ids, ["por_recoger", "en_reparto"]),
      repo.findMensajerosConOrdenesEn(ids, ["por_recolectar_en_tienda"]),
    ]);
    return {
      status: "ok" as const,
      mensajeros,
      bloqueadosIds: [...bloqueados],
      conRepartoIds: [...conReparto],
      conRecoleccionIds: [...conRecoleccion],
    };
  });
  // Este borde solo puede lanzar UnauthenticatedError (no hay zod aqui): el
  // unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** Feature 30/R13/R16: rutea ordenes no-GAM a en_ruta_bodega_satelite (solo maestro). */
export async function rutearABodegaSatelite(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<RutearSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = rutearSateliteSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.guiaService ?? buildGuiaService();
    return service.rutearABodegaSatelite(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

// BORRADO 2026-08-07 (chore de deuda de superficie, decision humana): aqui vivia
// `listarCatalogoEstatus` (soporte R15/R16, feature 17), el loader de solo lectura del catalogo
// `order_status`. Es la SEGUNDA VICTIMA del commit `54757be4` (2026-07-31), el mismo que dejo a
// `rutearABodegaSatelite` sin boton y causo el incidente de produccion. Ese commit borro
// `OrdenesRevisionMaestro.tsx`, que era su UNICO consumidor (la importaba y la llamaba). Aquel
// borrado dejo dos cosas colgando y solo se reparo una; esto cierra la otra.
//
// NO es capacidad perdida: la sustituta viva es `listarOrderStatus`
// (`lib/actions/order-status.ts`), montada desde `ordenes/_components/OrdenesListado.tsx`, con
// autorizacion MAS AMPLIA (todos menos mensajero, frente a solo maestro/admin) y mejor probada.
// `IOrdenRepository.listOrderStatus()` NO se toca: lo sigue usando esa sustituta.

/**
 * Gate de seleccion del maestro — loader de solo lectura de las zonas BLOQUEADAS: las
 * que tienen AL MENOS 1 mensajero con un cierre abierto (`solicitado`/`vencido`). Cubre
 * TODAS las zonas (central GAM y satelites) con la misma regla, para que la UI
 * deshabilite la seleccion de esas ordenes con el mismo criterio que la guarda de
 * escritura del servidor (`existeBodegaSateliteBloqueada` / `zonasSateliteBloqueadas`).
 * Una zona sin mensajeros nunca sale bloqueada. `maestro` y `admin` pueden leer (mismo
 * criterio de solo-lectura que `listarMensajerosParaAsignacion`); el resto -> forbidden.
 */
export async function listarZonasBloqueadasPorCierre(
  deps: ListarZonasBloqueadasDeps = {},
): Promise<ListarZonasBloqueadasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "maestro" && actor.rol !== "admin") {
      return { status: "forbidden" as const };
    }
    const repo = deps.ordenRepo ?? buildOrdenRepoParaZonasBloqueadas();
    const zonas = await repo.findZonasConMensajeroBloqueado();
    return { status: "ok" as const, zonasBloqueadasIds: [...zonas] };
  });
  // Este borde solo puede lanzar UnauthenticatedError (no hay zod aqui): el
  // unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
