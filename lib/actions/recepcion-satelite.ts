"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { AsignacionSateliteService } from "@/lib/services/AsignacionSateliteService";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRecepcionSateliteService } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { IAsignacionSateliteService } from "@/lib/interfaces/services/IAsignacionSateliteService";
import type {
  IOrdenRepository,
  BodegaBloqueoResult,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  recibirSchema,
  recibirLoteSchema,
  asignarSateliteSchema,
  listarOrdenesBodegaPaginadoSchema,
  listarOrdenesBodegaCompletoSchema,
  listarIdsVigentesBodegaSchema,
  type ListarRecepcionSateliteResult,
  type ListarOrdenesBodegaPaginadoResult,
  type ListarOrdenesBodegaCompletoResult,
  type ListarIdsVigentesBodegaResult,
  type RecibirResult,
  type RecibirLoteResult,
  type AsignarSateliteResult,
  type ListarMensajerosSateliteResult,
} from "@/lib/types/recepcion-satelite";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 33 — Server Actions de la bodega satelite (mutaciones internas del mismo
// proyecto; van como Server Action, no como Route API, patron feature 36). Resuelve
// el actor por sesion, valida en el borde con zod y delega en el servicio, TODO
// bajo `withErrorHandler` (patron mis-asignaciones.ts): un error EXCEPCIONAL
// (caida de DB) se normaliza a AppErrorShape en vez de propagarse crudo.
// `unauthenticated` se resuelve en el borde (UNAUTHORIZED); el resto
// (forbidden/sin_zona/zona_ajena/estado_invalido/ya_recibida/no_encontrada/
// conflict/validation_error) los devuelve el service como resultado de dominio.

// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR, R16) o falta de sesion (UNAUTHORIZED, R3). El resto de estados
// los devuelve el service directamente como resultado de dominio. Espejo de
// `toMisAsignacionesActionError`.
function toRecepcionSateliteActionError(
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
      throw new Error(`recepcion-satelite: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IRecepcionSateliteService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  return new RecepcionSateliteService(
    ordenRepo,
    // Feature 160 (R11/R25): derivador de intentos EN LOTE (un solo lote para los 5 grupos).
    new OrdenHistorialService(
      ordenRepo,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
  );
}

function buildAsignacionService(): IAsignacionSateliteService {
  const prisma = getPrismaClient();
  // Feature 92/R8: + el gate de asignabilidad por coordenadas, que lee la cola de jobs.
  return new AsignacionSateliteService(
    new OrdenRepository(prisma),
    new AsignabilidadCoordenadasService(new JobRepository(prisma)),
  );
}

// Feature 34/T6: repo minimo del loader de mensajeros de la zona (solo lectura).
function buildOrdenRepoParaMensajeros(): Pick<
  IOrdenRepository,
  | "findUsuarioZonaId"
  | "findMensajerosByZona"
  | "findMensajerosBloqueadosPorCierres" // feature 271/R32: los que el servidor va a rechazar
> {
  return new OrdenRepository(getPrismaClient());
}

export interface RecepcionSateliteDeps {
  service?: IRecepcionSateliteService;
  getActor?: () => Promise<Actor | null>;
}

// Feature 34/T5: deps de la asignacion (inyecta el service en tests).
export interface AsignacionSateliteDeps {
  service?: IAsignacionSateliteService;
  getActor?: () => Promise<Actor | null>;
}

// Feature 34/T6: deps del loader de mensajeros (inyecta el repo en tests).
export interface ListarMensajerosSateliteDeps {
  ordenRepo?: Pick<
    IOrdenRepository,
    | "findUsuarioZonaId"
    | "findMensajerosByZona"
    | "findMensajerosBloqueadosPorCierres" // feature 271/R32: los que el servidor va a rechazar
  >;
  getActor?: () => Promise<Actor | null>;
}

// Feature 41/T F3 (R22): deps del flag de bloqueo de la bodega satelite (inyecta el
// repo minimo + actor en tests, sin tocar services/repos del backend).
export interface EstadoBloqueoBodegaSateliteDeps {
  ordenRepo?: Pick<
    IOrdenRepository,
    "findUsuarioZonaId" | "existeBodegaSateliteBloqueada"
  >;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Feature 41/R22: resultado del flag de bloqueo de la bodega satelite del actor.
 * `bloqueo` trae `bloqueada` + las dos causas (porMensajeros / porCierreBodega) para
 * que la UI muestre el mensaje accionable diferenciado (R17 regla estricta). Sin zona
 * -> `bloqueada=false` (no hay bodega que bloquear).
 */
export type EstadoBloqueoBodegaSateliteResult =
  | { status: "ok"; bloqueo: BodegaBloqueoResult }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

/** R3/R4/R5/R6/R8: lista "Por recibir" / "Recibidas" de la zona del adminSatelite. */
export async function listarRecepcionSatelite(
  deps: RecepcionSateliteDeps = {},
): Promise<ListarRecepcionSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listar(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 170 — FASE 2 (T K.1, R40/R41/R44/R45/R51) — UNA pagina del listado «Órdenes de la
 * bodega», con estado ∧ cantón ∧ distrito resueltos en el SERVIDOR.
 *
 * Sustituye, para esa tabla, al `listarRecepcionSatelite` que bajaba el conjunto entero. La
 * pantalla sigue llamando a aquel para «Por recibir», `zonaNombre` y `sinZona`: esta acción no
 * los duplica.
 *
 * `input` vacío (`{}`) es válido y es lo que pide la página 1: los defaults los pone el schema
 * del dominio. Un filtro fuera de la lista blanca —o una clave de alcance colada— muere aquí
 * con `validation_error`, sin llegar al servicio.
 */
export async function listarOrdenesBodegaPaginado(
  input: unknown = {},
  deps: RecepcionSateliteDeps = {},
): Promise<ListarOrdenesBodegaPaginadoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de tocar el service
    const data = listarOrdenesBodegaPaginadoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarOrdenesBodegaPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}

/**
 * Feature 184 — Tanda A (T A.3, R1/R3/R6/R7) — el CONJUNTO filtrado entero de «Órdenes de la
 * bodega», para producir el archivo.
 *
 * Calcada del borde de su página: mismo actor, mismo servicio y el mismo schema menos
 * `page`/`pageSize`. Los filtros vigentes viajan tal cual y el conjunto vuelve YA filtrado por
 * la base: la pantalla deja de releer los cinco grupos de la zona para volver a filtrarlos en
 * el navegador (Q-K4).
 *
 * Una clave no declarada —o una de alcance, como `zonaId`— muere aquí con `validation_error`,
 * sin llegar al servicio (R17).
 */
export async function listarOrdenesBodegaCompleto(
  input: unknown = {},
  deps: RecepcionSateliteDeps = {},
): Promise<ListarOrdenesBodegaCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de tocar el service
    const data = listarOrdenesBodegaCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarOrdenesBodegaCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}

/**
 * Feature 184 — Tanda A (T A.3, R18/R21/R22) — cuáles de los identificadores marcados siguen
 * en el conjunto filtrado. Con esto la pantalla PODA su selección.
 *
 * Devuelve los VIGENTES, no los caducados: el cliente interseca, así que si esta acción falla
 * —o si devuelve menos de lo que debería por un error— lo peor que pasa es que no se pode
 * (R22). El tope de identificadores lo impone el schema (Q2), y pasarse es `validation_error`
 * sin tocar la selección.
 */
export async function listarIdsVigentesBodega(
  input: unknown,
  deps: RecepcionSateliteDeps = {},
): Promise<ListarIdsVigentesBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R3: antes de tocar el service
    const data = listarIdsVigentesBodegaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarIdsVigentesBodega(data, actor);
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}

/** R3/R10/R16/R17: recibe una orden por el `num_guia` escaneado (el QR codifica /paquete/<numGuia>). */
export async function recibirPorQr(
  input: unknown,
  deps: RecepcionSateliteDeps = {},
): Promise<RecibirResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recibirSchema.parse(input); // R16: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recibir(data.numGuia, actor);
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}

/**
 * Feature 63 — recibe EN LOTE ("Aceptar/Recibir todas") las ordenes indicadas del
 * adminSatelite logueado que sigan en `en_ruta_bodega_satelite` de SU zona, pasandolas
 * a `en_bodega_satelite` (paridad con `recogerAsignaciones` del mensajero). ADITIVO: NO
 * altera el flujo por-QR `recibirPorQr`. `unauthenticated` (borde) y `validation_error`
 * de zod se resuelven aqui; `forbidden`/`sin_zona`/`validation_error` de dominio los
 * devuelve el service. El alcance por zona + estado de origen se impone server-side.
 */
export async function recibirLote(
  input: unknown,
  deps: RecepcionSateliteDeps = {},
): Promise<RecibirLoteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = recibirLoteSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.recibirLote({ ordenIds: data.ordenIds }, actor);
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}

/**
 * Feature 34/R1/R7/R15/R19: asigna un lote de ordenes `en_bodega_satelite` de la
 * zona del adminSatelite a un mensajero de su zona (transicion a
 * `por_recoger`). `unauthenticated` (R1) y `validation_error` de zod
 * (R19) se resuelven en el borde; `forbidden`/`sin_zona`/`conflict`/
 * `validation_error` de dominio los devuelve el service. Patron `recibirPorQr`.
 */
export async function asignarDesdeSatelite(
  input: unknown,
  deps: AsignacionSateliteDeps = {},
): Promise<AsignarSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1/R15: antes de tocar el service
    const data = asignarSateliteSchema.parse(input); // R19: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildAsignacionService();
    return service.asignar(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toRecepcionSateliteActionError(r) : r;
}

/**
 * Feature 34/R2/R5/R6: loader de mensajeros de la zona del adminSatelite para el
 * modal de asignacion. Rol != adminSatelite -> forbidden; sin zona -> lista vacia
 * (R6). Scoped a la zona del actor (server-side), NUNCA a un parametro del cliente.
 * Espejo de `listarMensajerosParaAsignacion` (17) pero por la zona del actor.
 *
 * FEATURE 271 (T4.5, R32) — + `bloqueadosIds`, Y ES LA MITAD QUE FALTABA. Este selector NO
 * devolvia NADA de esto, ni antes ni despues de la 241: el del maestro al menos habia tenido el
 * dato, este nunca. Y esta es la superficie DONDE OCURRIO EL INCIDENTE DEL 18/08 —la pantalla
 * dejaba elegir a un mensajero que el servidor rechazaba, con un mensaje falso—, asi que el
 * conjunto que viaja aqui tiene que ser EXACTAMENTE el que `AsignacionSateliteService.asignar`
 * rechaza (T4.2). Ni uno mas, ni uno menos.
 */
export async function listarMensajerosSatelite(
  deps: ListarMensajerosSateliteDeps = {},
): Promise<ListarMensajerosSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "adminSatelite") return { status: "forbidden" as const }; // R1/R13
    const repo = deps.ordenRepo ?? buildOrdenRepoParaMensajeros();
    const zonaId = await repo.findUsuarioZonaId(actor.usuarioId); // R2
    if (zonaId === null) return { status: "ok" as const, mensajeros: [] }; // R6
    const mensajeros = await repo.findMensajerosByZona(zonaId); // R5
    // R32: el MISMO predicado que aplica el servidor al escribir. No se re-deriva aqui.
    const bloqueados = await repo.findMensajerosBloqueadosPorCierres(mensajeros.map((m) => m.id));
    return { status: "ok" as const, mensajeros, bloqueadosIds: [...bloqueados] };
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 41/R22: deriva SERVER-SIDE si la bodega satelite del actor esta BLOQUEADA
 * para asignar a sus mensajeros (regla estricta R17: (i) cierres de sus mensajeros en
 * `solicitado`/`vencido` O (ii) su propio `CierreBodega` `solicitado`). Reutiliza
 * `existeBodegaSateliteBloqueada` del backend. El flag + causas viajan por props a la
 * vista de asignacion, que muestra el aviso diferenciado y deshabilita "Asignar". Solo
 * lectura. Sin zona -> no bloqueada (no hay bodega). Rol != adminSatelite -> forbidden.
 */
export async function estadoBloqueoBodegaSatelite(
  deps: EstadoBloqueoBodegaSateliteDeps = {},
): Promise<EstadoBloqueoBodegaSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "adminSatelite") return { status: "forbidden" as const };
    const repo =
      deps.ordenRepo ??
      (new OrdenRepository(getPrismaClient()) as Pick<
        IOrdenRepository,
        "findUsuarioZonaId" | "existeBodegaSateliteBloqueada"
      >);
    const zonaId = await repo.findUsuarioZonaId(actor.usuarioId);
    if (zonaId === null) {
      // Sin zona no hay bodega que bloquear (la vista ya avisa `sinZona`).
      return {
        status: "ok" as const,
        bloqueo: {
          bloqueada: false,
          porMensajeros: false,
          porCierreBodega: false,
          cierresAbiertos: 0,
          totalMensajeros: 0,
          mensajerosConCierreIds: [],
        },
      };
    }
    const bloqueo = await repo.existeBodegaSateliteBloqueada(zonaId);
    return { status: "ok" as const, bloqueo };
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}
