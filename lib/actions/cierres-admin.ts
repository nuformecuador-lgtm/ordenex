"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { notificarMensajeroBloqueadoReal } from "@/lib/notificaciones/notificadores";
import { gestionConfig } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierresAdminService } from "@/lib/interfaces/services/ICierresAdminService";
import {
  cierreIdSchema,
  actualizarPagosGestionSchema,
  aprobarCierreSchema,
  rechazarCierreSchema,
  forzarSolicitudVencidoSchema,
  listarHistoricoCierresAdminSchema,
  listarHistoricoCierresAdminCompletoSchema,
  listarPendientesCierresAdminSchema,
  listarPendientesCierresAdminCompletoSchema,
  type ListarCierresAdminResult,
  type ListarHistoricoCierresAdminResult,
  type ListarHistoricoCierresAdminCompletoResult,
  type ListarPendientesCierresAdminResult,
  type ListarPendientesCierresAdminCompletoResult,
  type ListarGestionesCierresAdminCompletoResult,
  type VerCierreDetalleResult,
  type AprobarCierreResult,
  type RechazarCierreResult,
  type ForzarSolicitudVencidoResult,
  type ActualizarPagosGestionResult,
} from "@/lib/types/cierres-admin";
import { filtrosDescargaGestionesSchema } from "@/lib/types/filtros-cierres";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";

/**
 * Resultado del catalogo de filtros: lo que decide el servicio (`ok`/`forbidden`) mas los dos
 * que decide este borde. `validation_error` figura porque `toCierresAdminActionError` lo puede
 * producir; con una lectura sin input no deberia ocurrir, y declararlo evita que la pantalla
 * tenga que confiar en esa promesa.
 */
export type ObtenerCatalogoFiltrosCierresResult =
  | { status: "ok"; catalogo: CatalogoFiltrosCierresDTO }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
import type { AppErrorShape } from "@/lib/errors";

// Feature 38 — Server Actions de "Cierres del dia" del admin (lecturas + mutaciones
// internas del mismo proyecto; van como Server Action, no como Route API, patron
// feature 37). Resuelve el actor por sesion, valida en el borde con zod (mutaciones)
// y delega en el servicio, TODO bajo `withErrorHandler`: un error EXCEPCIONAL (caida
// de DB, fallo de storage al firmar) se normaliza a AppErrorShape. `unauthenticated`
// (UNAUTHORIZED) y `validation_error` (ZodError) se resuelven en el borde; el resto
// (forbidden/no_encontrada/conflict) los devuelve el service como resultado de dominio.

// Traduce el AppErrorShape que puede producir este borde: ZodError
// (VALIDATION_ERROR, R11) o falta de sesion (UNAUTHORIZED, R1). Espejo de
// `toRecepcionSateliteActionError`.
function toCierresAdminActionError(
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
      throw new Error(`cierres-admin: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): ICierresAdminService {
  const prisma = getPrismaClient();
  return new CierresAdminService(
    // Feature 42/T8: el repo de cierres alimenta la wallet al aprobar (R5/R7), por
    // inyeccion del repo de movimientos + el feed.
    new CierresAdminRepository(
      prisma,
      new WalletMovimientoRepository(prisma),
      // Feature 69/T16 (R12): el feed YA NO recibe el resolver de tarifa — deriva del
      // SNAPSHOT (`cierre_detail`), que trae la tarifa congelada por fila. El resolver se
      // invoca UNA vez por cierre, al SOLICITAR (en `CierreDiaRepository`), nunca al aprobar:
      // ese es exactamente el cambio que mata el vector R18.
      new WalletFeedService(),
      // Feature 43/T10: alimenta el LEDGER por tienda al aprobar (misma tx que la 42). Lee el
      // interruptor Q3 del singleton walletTiendaConfig (default true) — politica de la casa,
      // no dato de la orden: por eso no se congela.
      new WalletTiendaMovimientoRepository(prisma),
      new WalletTiendaFeedService(),
      // Feature 44/T10: alimenta el LIBRO del pago por mensajero al aprobar (misma tx que 42/43).
      // El feed consume los snapshots del cierre (P/E), emite el libro (devengo + pago) y el
      // egreso egreso_pago_mensajero=P en la caja 42 (F1.4-Qa=SI). Sin dependencias externas.
      new PagoMensajeroMovimientoRepository(prisma),
      new WalletMensajeroFeedService(),
      // Feature 158/T1.14 (R22/R26): emite el egreso `egreso_indemnizacion` del cierre al
      // aprobar, en la MISMA tx que 42/43/44. Sin dependencias externas: LEE de la propia tx
      // la suma de `gestion_orden.indemnizacion` que la aprobacion acaba de escribir.
      new WalletIndemnizacionFeedService(),
    ),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    // Evidencias: mismo bucket privado de gestion_orden (feature 36).
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
    // Feature 172/T C.2 (R22/R26/R28): SOLO LECTURA de los pagos ya registrados, para derivar
    // el pendiente de cada cierre aprobado. El servicio solo recibe las dos lecturas que
    // necesita (`Pick`), asi que esta pantalla no puede registrar ni anular un pago: aprobar y
    // pagar son dos escrituras distintas (design §8).
    new LiquidacionPagoRepository(prisma),
    // FEATURE 271 (T6.6, R42): COMPOSITION ROOT del aviso «quedaste bloqueado». Se cablea aqui y
    // no como default del service (ver `lib/notificaciones/notificadores.ts`): el default es el
    // no-op, para que ninguna suite que instancie el service escriba avisos en la base.
    notificarMensajeroBloqueadoReal,
  );
}

export interface CierresAdminDeps {
  service?: ICierresAdminService;
  getActor?: () => Promise<Actor | null>;
}

/** R1-R5/R8/R9: pendientes + historico del alcance del admin; solo maestro/adminSatelite. */
export async function listarCierresAdmin(
  deps: CierresAdminDeps = {},
): Promise<ListarCierresAdminResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const service = deps.service ?? buildService();
    return service.listarCierresAdmin(actor);
  });
  // Este borde no tiene zod: el unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/**
 * Feature 170 — FASE 2 (T I.1, R40/R41/R44): UNA pagina del HISTORICO del alcance + el total.
 *
 * Lectura interna del mismo proyecto -> Server Action, como el resto de este archivo. El
 * alcance NO viaja en el input: lo resuelve el servicio desde el actor de la sesion, igual
 * que en `listarCierresAdmin`.
 */
export async function listarHistoricoCierresAdminPaginado(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<ListarHistoricoCierresAdminResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const data = listarHistoricoCierresAdminSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarHistoricoCierresAdminPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Feature 170 — FASE 2 (T J.1, R40/R41/R42/R44): UNA pagina de la COLA de pendientes de
 * decision del alcance + el total, que es el que la cabecera de la pantalla mostrara.
 *
 * El alcance NO viaja en el input: lo resuelve el servicio desde el actor de la sesion, igual
 * que en `listarCierresAdmin`.
 */
export async function listarPendientesCierresAdminPaginado(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<ListarPendientesCierresAdminResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el service
    const data = listarPendientesCierresAdminSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPendientesCierresAdminPaginado(data, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Feature 184 — Tanda D (T D.2, R1/R6/R7/R17): el HISTORICO ENTERO del alcance, del que sale el
 * ARCHIVO de ese listado. Lectura interna del mismo proyecto -> Server Action, como el resto de
 * este archivo.
 *
 * El actor se resuelve ANTES de validar (quien no tiene sesion no debe poder deducir que claves
 * acepta esta superficie probando entradas) y la lista blanca la aplica un schema DERIVADO del
 * de la pagina: `page`/`pageSize` mueren aqui igual que `destinoZonaId` (R17). `input: unknown =
 * {}` para que la pantalla pueda llamarla sin argumentos.
 */
export async function listarHistoricoCierresAdminCompleto(
  input: unknown = {},
  deps: CierresAdminDeps = {},
): Promise<ListarHistoricoCierresAdminCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de tocar el service
    // Pedido humano del 2026-08-16: la lista blanca ya no esta vacia — trae `filtros`, y lo que
    // valida se USA. Antes se parseaba y se tiraba, porque no habia nada que transportar.
    const data = listarHistoricoCierresAdminCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarHistoricoCierresAdminCompleto(actor, data.filtros);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Feature 184 — Tanda D (T D.2, R1/R6/R7/R17): la COLA ENTERA de pendientes de decision del
 * alcance, de la que sale el ARCHIVO de ese listado. Espejo exacto de la anterior.
 */
export async function listarPendientesCierresAdminCompleto(
  input: unknown = {},
  deps: CierresAdminDeps = {},
): Promise<ListarPendientesCierresAdminCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R7: antes de tocar el service
    const data = listarPendientesCierresAdminCompletoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarPendientesCierresAdminCompleto(actor, data.filtros);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Pedido humano del 2026-08-16 — las OPCIONES de los filtros de la pantalla (bodegas destino y
 * mensajeros), ya acotadas al alcance del actor.
 *
 * Lectura de SOLO CATALOGO: no lista cierres, no pagina y no depende del filtro aplicado, asi
 * que se resuelve una vez al cargar la pantalla. No recibe input —no hay nada que el cliente
 * pueda pedir aqui— y por eso tampoco hay schema: el alcance sale del ACTOR, como en los
 * listados.
 */
export async function obtenerCatalogoFiltrosCierres(
  deps: CierresAdminDeps = {},
): Promise<ObtenerCatalogoFiltrosCierresResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.service ?? buildService();
    return service.obtenerCatalogoFiltros(actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Feature 230 — Tanda 2 (T2.3, R13/R17/R19/R32/R36) — el UNICO punto de entrada de servidor de
 * la descarga DETALLADA de esta pantalla: las gestiones de los cierres del dia del alcance.
 *
 * Server Action y no `app/api/`: la lectura es interna del mismo proyecto y el archivo se arma
 * en el navegador, que es la doctrina de la 134 y lo que hace el resto de este modulo.
 *
 * **El actor se resuelve ANTES de validar** (R17), como sus hermanas: quien no tiene sesion no
 * debe poder deducir que claves acepta esta superficie probando entradas. Y la lista blanca es
 * `.strict()`, asi que una clave ajena —`destinoZonaIds`, `page`— muere aqui con
 * `validation_error` y sin tocar la base (R19), igual que un rango de fechas invertido (R32).
 *
 * `input` NO lleva default: el conjunto de esta descarga lo redacta el dialogo, y una llamada
 * sin `mensajeroIds` no es «todos», es una llamada que no debio ocurrir (R39).
 */
export async function listarGestionesCierresAdminCompleto(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<ListarGestionesCierresAdminCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R17: antes de parsear y antes del service
    const data = filtrosDescargaGestionesSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.listarGestionesCierresAdminCompleto(actor, data);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/** R6-R9/R13: detalle de un cierre del alcance con evidencias firmadas. */
export async function verCierreDetalle(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<VerCierreDetalleResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = cierreIdSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.verCierreDetalle(data.cierreId, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/** R10/R12-R14: aprueba un cierre `solicitado` del alcance. */
export async function aprobarCierre(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<AprobarCierreResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = aprobarCierreSchema.parse(input); // ZodError -> VALIDATION_ERROR (R20/R24)
    const service = deps.service ?? buildService();
    // Feature 158/R19: la lista viaja TAL CUAL (montos STRING, sin coercion a number). Ausente
    // en el request -> `[]` por el `.default([])` del schema -> camino de la 38 intacto (R36).
    // Feature 238/R14/R15: la confirmacion fisica viaja IGUAL de tal cual — el borde valida la
    // FORMA (uuid, entero positivo) y nada mas. Quien decide si cubre el conjunto esperado es el
    // servicio, contra las gestiones reales del cierre y dentro del alcance del actor; una
    // coercion aqui seria una segunda regla que puede divergir de aquella.
    return service.aprobarCierre(
      data.cierreId,
      actor,
      data.indemnizaciones,
      data.confirmacionFisica,
    );
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Pedido humano (2026-08-19) — corrige el desglose de pago de una gestion de un cierre ABIERTO.
 * Mutacion interna -> Server Action (patron aprobar/rechazar). El borde resuelve el actor y
 * valida la forma (`validation_error` de zod); el ROL, el ALCANCE, el estado del cierre y el
 * cuadre de la suma los decide el service, que es quien puede mirar la base.
 */
export async function actualizarPagosGestion(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<ActualizarPagosGestionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = actualizarPagosGestionSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.actualizarPagosGestion(data, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/** R11-R14: rechaza un cierre `solicitado` del alcance con motivo obligatorio. */
export async function rechazarCierre(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<RechazarCierreResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = rechazarCierreSchema.parse(input); // R11: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.rechazarCierre(data.cierreId, data.motivo, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}

/**
 * Feature 111/R16 — VALVULA DE ESCAPE (emergencia, no el flujo normal): destraba un `vencido`
 * ABANDONADO transicionandolo `vencido -> solicitado` en nombre del mensajero. Mutacion interna
 * -> Server Action (patron aprobar/rechazar). `unauthenticated` (sin sesion) y `validation_error`
 * (id no-uuid) en el borde; `forbidden`/`no_encontrada`/`conflict` los devuelve el service.
 */
export async function forzarSolicitudVencido(
  input: unknown,
  deps: CierresAdminDeps = {},
): Promise<ForzarSolicitudVencidoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = forzarSolicitudVencidoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    return service.forzarSolicitudVencido(data.cierreId, actor);
  });
  return isAppErrorShape(r) ? toCierresAdminActionError(r) : r;
}
