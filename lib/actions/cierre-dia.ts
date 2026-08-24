"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierreDiaService } from "@/lib/interfaces/services/ICierreDiaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
// Feature 271: el detalle del bloqueo (N, V y cual toca primero) viaja entero al borde.
import type { BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import {
  deshacerGestionSchema,
  listarCierresPasadosCompletoSchema,
  listarCierresPasadosSchema,
  verCierrePasadoSchema,
  type DeshacerGestionResult,
  type ListarCierreDiaResult,
  type ListarCierresPasadosCompletoResult,
  type ListarCierresPasadosResult,
  type SolicitarCierreResult,
  type VerCierrePasadoResult,
} from "@/lib/types/cierre";
import {
  notificarCierreDiaPorAprobarReal,
  notificarMensajeroBloqueadoReal,
} from "@/lib/notificaciones/notificadores";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 37 — Server Actions del "Cierre del dia" del mensajero (mutaciones y
// lecturas internas del mismo proyecto; van como Server Action, no como Route API,
// patron feature 36). Resuelve el actor por sesion y delega en el servicio, TODO
// bajo `withErrorHandler`: un error EXCEPCIONAL (caida de DB, fallo de storage al
// firmar) se normaliza a AppErrorShape en vez de propagarse crudo. `unauthenticated`
// se resuelve en el borde (UNAUTHORIZED); el resto (forbidden/conflict/
// validation_error) los devuelve el service como resultado de dominio. Sin input de
// negocio ni zod: el unico AppErrorShape posible en este borde es UNAUTHORIZED.

function buildService(): ICierreDiaService {
  const prisma = getPrismaClient();
  return new CierreDiaService(
    // Feature 69/T10: el repo del cierre congela `cierre_detail` en la tx de `crearCierre`
    // (R3/R8) y para eso necesita el resolver de la tarifa vigente. Feature 274: ese resolver
    // resuelve por el PAR (tienda, zona) con la cascada de R1, ya no por tienda sola.
    new CierreDiaRepository(prisma, new TarifaVigenteRepository(prisma)),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    // Las evidencias son las de gestion_orden (feature 36): mismo bucket privado.
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
    // Feature 39: resolver de la tarifa de pago al mensajero (por zona+vehiculo).
    new TarifaZonaMensajeroRepository(prisma),
    // Feature 146/R24: COMPOSITION ROOT del aviso "cierre por aprobar". Se cablea aqui y no
    // como default del service (ver `lib/notificaciones/notificadores.ts`).
    notificarCierreDiaPorAprobarReal,
    // FEATURE 271 (T6.5, R40/R41): COMPOSITION ROOT del aviso «quedaste bloqueado por acumular».
    notificarMensajeroBloqueadoReal,
  );
}

export interface CierreDiaDeps {
  service?: ICierreDiaService;
  getActor?: () => Promise<Actor | null>;
}

// Feature 41 (R21): deps del bloqueo derivado del mensajero. Inyecta el repo (solo el metodo de
// bloqueo) y el actor en tests, sin tocar el service backend.
export interface EstadoBloqueoMensajeroDeps {
  ordenRepo?: Pick<IOrdenRepository, "findBloqueoDetalle">;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Resultado del bloqueo del mensajero (R21). `unauthenticated` = sin sesion.
 *
 * ⚠️ FEATURE 271: ya NO es un booleano. La pantalla tiene que decir CUANTOS cierres arrastra y
 * CUAL toca resolver primero (R43), y eso no cabe en un `bloqueado: boolean`. `bloqueado` sigue
 * DENTRO del detalle (`bloqueo.bloqueado`), que es donde la regla lo calcula — y NO se duplica
 * fuera: el campo puente que existio durante la pasada de backend se retiro con T9.3, en cuanto
 * las cuatro pantallas pasaron a bajar el detalle entero.
 */
export type EstadoBloqueoMensajeroResult =
  | { status: "ok"; bloqueo: BloqueoDetalle }
  | { status: "unauthenticated" };

/**
 * Feature 41 (R21) -> FEATURE 271 — deriva SERVER-SIDE el BLOQUEO del mensajero (el actor)
 * reutilizando `findBloqueoDetalle` del backend, sin flag persistido (R12).
 *
 * QUE DICE ESTE AVISO AHORA. Se enciende exactamente cuando el mensajero esta BLOQUEADO por la
 * regla N/V: `N >= 2` (acumula cierres) o `V >= 1` (arrastra uno sin enviar a aprobacion). Y NO se
 * enciende con `N = 1, V = 0` —un solo cierre `solicitado`—: ese mensajero ya hizo lo suyo y
 * espera al admin (mediana 8,2 h, p90 22,1 h medidas contra produccion), asi que sigue trabajando
 * con normalidad. Esa es la mitad de la regla del 2026-08-20 que la 271 conserva.
 *
 * ⚠️ Y EL AVISO YA SI HABLA DE ASIGNACIONES, en sentido contrario al de la 241: desde el
 * 2026-08-23 un mensajero bloqueado TAMPOCO recibe trabajo nuevo —ni reparto ni recoleccion—, asi
 * que decirlo dejo de ser una promesa falsa y paso a ser lo que el servidor hace. El texto vive en
 * `lib/constants/bloqueo-mensajero.ts` (`avisoBloqueo`), compartido por los tres portales y por la
 * campana.
 *
 * Se CONSULTA el mismo predicado que aplica el servidor, no se re-deriva, para que el aviso diga
 * exactamente lo que el servidor va a rechazar — que es la propiedad que la incoherencia del
 * 2026-08-18 rompio en la bodega satelite. No muta nada; solo lectura.
 */
export async function estadoBloqueoMensajero(
  deps: EstadoBloqueoMensajeroDeps = {},
): Promise<EstadoBloqueoMensajeroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el repo
    const repo = deps.ordenRepo ?? new OrdenRepository(getPrismaClient());
    const bloqueo = await repo.findBloqueoDetalle(actor.usuarioId);
    return { status: "ok" as const, bloqueo };
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** R1-R11/R17/R18: detalle del dia + totales + gate + historico; solo `mensajero`. */
export async function listarCierreDia(
  deps: CierreDiaDeps = {},
): Promise<ListarCierreDiaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listarCierreDia(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina de «Cierres solicitados» del
 * mensajero + el total. El `mensajero_id` no viaja en el input: lo pone el servicio desde el
 * actor de la sesion, igual que en `listarCierreDia`.
 */
export async function listarCierresPasadosPaginado(
  input: unknown,
  deps: CierreDiaDeps = {},
): Promise<ListarCierresPasadosResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = listarCierresPasadosSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarCierresPasadosPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toCierreDiaActionError(r) : r;
}

/**
 * Feature 184 — Tanda C (R1/R4/R6/R7/R9) — el CONJUNTO de «Cierres solicitados» del propio
 * mensajero, sin recorte, para producir el archivo.
 *
 * Sustituye a la relectura de `listarCierreDia()` que hacia la pantalla, que ademas del historico
 * traia las gestiones del dia, la tarifa por zona+vehiculo y la FIRMA en lote de las evidencias
 * fotograficas de todas ellas — de todo eso, el archivo usaba un solo campo y ninguna URL (R9).
 *
 * El `mensajero_id` no viaja en el input: lo pone el servicio desde el actor de la sesion. Y como
 * este listado no tiene filtros, la lista blanca derivada de la de su pagina no deja NINGUNA
 * clave: cualquier cosa que llegue —empezando por `mensajeroId`— muere aqui con
 * `validation_error` sin tocar el servicio (R17). El input se parsea aunque no se transporte
 * nada: parsear ES la barrera.
 */
export async function listarCierresPasadosCompleto(
  input: unknown = {},
  deps: CierreDiaDeps = {},
): Promise<ListarCierresPasadosCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de tocar el service
    listarCierresPasadosCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarCierresPasadosCompleto(actor);
  });
  return isAppErrorShape(r) ? toCierreDiaActionError(r) : r;
}

/** R10-R16: crea la solicitud de cierre del dia del mensajero. */
export async function solicitarCierre(
  deps: CierreDiaDeps = {},
): Promise<SolicitarCierreResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.solicitarCierre(actor);
  });
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Detalle de UN cierre PASADO del propio mensajero (solo lectura). Lectura interna del mismo
 * proyecto -> Server Action, no Route API. `unauthenticated` (sin sesion) y `validation_error`
 * (cierreId no-uuid) se resuelven en el borde; `forbidden` (rol) y `no_encontrada` (cierre
 * ajeno o inexistente, sin distinguirse) los devuelve el service.
 */
export async function verCierrePasado(
  input: unknown,
  deps: CierreDiaDeps = {},
): Promise<VerCierrePasadoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = verCierrePasadoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.verCierrePasado(data.cierreId, actor);
  });
  return isAppErrorShape(r) ? toCierreDiaActionError(r) : r;
}

// Feature 67 — traduce el AppErrorShape que puede producir un borde CON zod de este archivo:
// solo ZodError (VALIDATION_ERROR, R10) o falta de sesion (UNAUTHORIZED, R7).
// `forbidden`/`conflict` los devuelve el service como resultado de dominio, por eso NO
// aparecen aqui. Espejo EXACTO de `toDevolucionOrigenActionError` (48) /
// `toMisAsignacionesActionError` (36).
//
// Feature 170 (T I.1): lo comparte el listado paginado, que valida su `page`/`pageSize` con
// el mismo zod. Y el detalle de un cierre pasado (`verCierrePasado`) produce exactamente los
// mismos dos. Por eso se llama por el modulo y ya no por una de sus acciones.
function toCierreDiaActionError(
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
      throw new Error(`cierre-dia: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Feature 67/R1-R10 — DESHACE una gestion (la anula con rastro y devuelve su orden a
 * `en_reparto`). Mutacion interna del propio proyecto -> Server Action, no Route API
 * (`docs/architecture.md`). `unauthenticated` (R7, sin sesion) y `validation_error` (R10,
 * gestionId no-uuid) se resuelven en el borde; `forbidden` (R8/R9) y `conflict` (R2-R6) los
 * devuelve el service como resultado de dominio.
 */
export async function deshacerGestion(
  input: unknown,
  deps: CierreDiaDeps = {},
): Promise<DeshacerGestionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de la logica de negocio y de la DB
    const data = deshacerGestionSchema.parse(input); // R10: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.deshacerGestion(data.gestionId, actor);
  });
  return isAppErrorShape(r) ? toCierreDiaActionError(r) : r;
}
