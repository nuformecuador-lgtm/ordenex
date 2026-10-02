"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { AbonoTiendaRepository } from "@/lib/repositories/AbonoTiendaRepository";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import {
  EgresoCajaDocumentosRepository,
  IndemnizacionDocumentosRepository,
  PagoTiendaCajaDocumentosRepository,
  PremioCajaDocumentosRepository,
} from "@/lib/repositories/EgresoCajaDocumentosRepository";
import { RechazoTiendaCobroAnulacionRepository } from "@/lib/repositories/RechazoTiendaCobroAnulacionRepository";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { EstadoCuentaRepository } from "@/lib/repositories/EstadoCuentaRepository";
import { CobroTiendaAnulacionRepository } from "@/lib/repositories/CobroTiendaAnulacionRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { AjusteCajaService } from "@/lib/services/AjusteCajaService";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import { CajaConDetalleService } from "@/lib/services/LibroConDetalleService";
import { CajaKardexService } from "@/lib/services/LibroKardexService";
import type { ICajaKardexService } from "@/lib/interfaces/services/ICajaKardexService";
import type { LibroCajaKardexConDetalleServiceResult, LibroCajaKardexServiceResult } from "@/lib/types/libro-kardex";
import { WalletService } from "@/lib/services/WalletService";
import { OrigenLegibleRepository } from "@/lib/repositories/OrigenLegibleRepository";
import { OrigenLegibleService } from "@/lib/services/OrigenLegibleService";
import {
  origenEnItems,
  origenEnPagina,
  type ConOrigenEnItems,
  type ConOrigenEnPagina,
} from "@/lib/services/origen-en-resultado";
import type { ICajaConDetalleService } from "@/lib/interfaces/services/ICajaConDetalleService";
import type { CajaConDetalleServiceResult } from "@/lib/types/detalle-en-lote";
import type { IOrigenLegibleService } from "@/lib/interfaces/services/IOrigenLegibleService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletService,
  ListarMovimientosDeFilaServiceResult,
  ListarMovimientosServiceResult,
  RegistrarMovimientoManualServiceResult,
  VerResumenCajaServiceResult,
} from "@/lib/interfaces/services/IWalletService";
import type {
  IDetalleMovimientoService,
  VerDetalleMovimientoCompletoServiceResult,
  VerDetalleMovimientoServiceResult,
} from "@/lib/interfaces/services/IDetalleMovimientoService";
import type { IAjusteCajaService } from "@/lib/interfaces/services/IAjusteCajaService";
import {
  anularAjusteCajaSchema,
  listarLibroCajaCompletoSchema,
  listarLibroCajaSchema,
  listarMovimientosDeFilaSchema,
  listarMovimientosSchema,
  type AnularAjusteCajaResult,
  type ListarMovimientosCompletoResult,
} from "@/lib/types/wallet";
import {
  verDetalleDeMovimientoCompletoSchema,
  verDetalleDeMovimientoSchema,
} from "@/lib/types/detalle-movimiento";
import { registrarMovimientoManualConLateralesSchema, separarComprobante } from "@/lib/types/wallet-laterales";
import { buildComprobantes, leerComprobanteOpcional } from "@/lib/actions/_shared/comprobante-lateral";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 42 (T10) — Server Actions de la wallet (mutaciones/lecturas internas del mismo
// proyecto -> Server Action, no Route API, patron cierres-admin). Resuelve el actor por
// sesion, valida en el borde con zod y delega en el servicio bajo `withErrorHandler`.
// `unauthenticated` (sin sesion) y `validation_error` (ZodError) se resuelven en el borde;
// `forbidden`/`ok` los devuelve el service como resultado de dominio. Money-safe: los DTOs
// exponen montos como STRING (R21/R25); el cliente nunca recibe Prisma.Decimal.

export type ListarMovimientosActionResult =
  // Ficha 458-A (TA.2, R5–R8): cada fila baja con su origen legible (`origen`).
  | ConOrigenEnPagina<ListarMovimientosServiceResult>
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/**
 * Ficha 339 (T3.4) — el detalle de una fila en el BORDE. Se DERIVA del resultado del servicio,
 * igual que el del listado: `forbidden` lo decide el dominio; `unauthenticated` (sin sesion) y
 * `validation_error` (ZodError: `fila` fuera del catalogo o `pageSize` por encima del tope) se
 * resuelven aqui. **Ninguna rama de error viaja con movimientos** (R32/R38).
 */
export type ListarMovimientosDeFilaActionResult =
  | ConOrigenEnPagina<ListarMovimientosDeFilaServiceResult>
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type VerResumenCajaActionResult =
  | VerResumenCajaServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** Con un OBJETO (el dialogo de hoy) no hay `comprobante_no_guardado`; con un `FormData` (458-C) si. */
export type RegistrarMovimientoManualActionResult =
  | Exclude<RegistrarMovimientoManualServiceResult, { status: "comprobante_no_guardado" }>
  | { status: "unauthenticated" };

export type RegistrarMovimientoManualConComprobanteActionResult =
  | RegistrarMovimientoManualActionResult
  | { status: "comprobante_no_guardado" };

// Traduce el AppErrorShape del borde: ZodError (VALIDATION_ERROR) o falta de sesion
// (UNAUTHORIZED). Espejo de `toCierresAdminActionError`.
function toWalletActionError(
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
      throw new Error(`wallet: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IWalletService {
  const prisma = getPrismaClient();
  const repo = new WalletMovimientoRepository(prisma);
  // Ficha 459 (R14/R21): el lector REAL del saldo inicial vigente (`aporte_capital`).
  const aportes = new AporteCapitalRepository(prisma);
  // Ficha 459 (design §7.3, R66/R67): los lectores REALES del estado de los documentos del libro.
  // Ficha 461 (design §5.4, R20/R37): + el de los cobros de Ordenex a una tienda.
  // Ficha 461 (R71, auditoria D3): + el de las correcciones de caja.
  // Ficha 457 (design §8.5, R41): + el de los pagos de una tienda a Ordenex.
  return new WalletService(repo, prisma, aportes, {
    pagosPorCuenta: new PagoPorCuentaTiendaRepository(prisma),
    aportes,
    cobros: new CobroTiendaAnulacionRepository(prisma),
    ajustes: new AjusteCajaAnulacionRepository(prisma),
    abonos: new AbonoTiendaRepository(prisma),
    // Ficha 458-B (design §3.6, R71/R72): egresos, indemnizaciones y cobros por rechazo.
    egresos: new EgresoCajaDocumentosRepository(prisma),
    indemnizaciones: new IndemnizacionDocumentosRepository(prisma),
    rechazos: new RechazoTiendaCobroAnulacionRepository(prisma),
    // Ficha 458-C (revision B3, R71): el pago de Ordenex a una tienda y el premio del ranking.
    pagosATienda: new PagoTiendaCajaDocumentosRepository(prisma),
    premios: new PremioCajaDocumentosRepository(prisma),
  }, buildComprobantes(prisma)); // Ficha 458-B (R74): el comprobante de la correccion
}

/**
 * Ficha 461 (R69–R71, auditoria D3) — el composition root de la ANULACION de una correccion de caja:
 * el repositorio del libro (lee la correccion y escribe el contra-asiento), el de la anulacion
 * (constancia + historial) y la transaccion REAL de Prisma. El servicio no construye ninguno.
 */
function buildAjusteCajaService(): IAjusteCajaService {
  const prisma = getPrismaClient();
  return new AjusteCajaService(
    new WalletMovimientoRepository(prisma),
    new AjusteCajaAnulacionRepository(prisma),
    (fn) => prisma.$transaction((tx) => fn(tx as never)),
  );
}

/**
 * Ficha 344 — el composition root del detalle de una fila del libro.
 *
 * Las TRES dependencias se inyectan aqui y solo aqui: la lectura del movimiento de la caja, la
 * del libro por tienda (que el detalle de `/mi-wallet` usa desde su propio borde) y el
 * repositorio de aportes. El servicio no construye ninguna.
 */
function buildDetalleService(): IDetalleMovimientoService {
  const prisma = getPrismaClient();
  return new DetalleMovimientoService(
    new WalletMovimientoRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new CierreAporteRepository(prisma),
    new EstadoCuentaRepository(prisma), // 458-D (servidor, R19): la fila del mensajero; este borde no la usa
  );
}

/**
 * Ficha 464 (design §4) — el composition root de la descarga de la caja CON detalle por orden: el
 * servicio del libro de SIEMPRE (el mismo `buildService` que la descarga sin detalle, para que la hoja
 * de movimientos sea la misma, R14) y el detalle en lote sobre sus dos repositorios reales. Ninguna
 * dependencia es opcional (`tests/unit/actions/libro-con-detalle-464.composition-root.test.ts`).
 */
function buildCajaConDetalleService(): ICajaConDetalleService {
  const prisma = getPrismaClient();
  return new CajaConDetalleService(
    buildService(),
    buildDetalleEnLote(prisma),
  );
}

/**
 * Ficha 468 — el lote del detalle por guia sobre sus TRES repositorios reales (aportes, libro de la
 * tienda y libro del mensajero). Lo comparten el composition root de la 464 y el del kardex.
 */
function buildDetalleEnLote(prisma: ReturnType<typeof getPrismaClient>): DetalleEnLoteService {
  return new DetalleEnLoteService(
    new CierreAporteRepository(prisma),
    new WalletTiendaMovimientoRepository(prisma),
    new EstadoCuentaRepository(prisma),
  );
}

/**
 * Ficha 468 (design §3.4/§4.3) — el composition root del libro de la caja como KARDEX: el servicio del
 * libro de SIEMPRE (`buildService`, la misma hoja y el mismo guard que la descarga de antes), el
 * repositorio REAL de la caja para el saldo corrido y las cifras de la tarjeta, y el lote real (conteos y
 * detalle). Ninguna dependencia es opcional (`tests/unit/actions/libro-kardex-468.action.test.ts`).
 */
function buildCajaKardexService(): ICajaKardexService {
  const prisma = getPrismaClient();
  return new CajaKardexService(buildService(), new WalletMovimientoRepository(prisma), buildDetalleEnLote(prisma));
}

/** Ficha 468 — dependencias de la descarga del kardex de la caja, inyectables en test. */
export interface CajaKardexDeps {
  service?: ICajaKardexService;
  getActor?: () => Promise<Actor | null>;
  origenes?: IOrigenLegibleService;
}

/** Ficha 468 — el resultado en el BORDE: las filas con su origen legible + `kardex` (y `porGuia`). */
export type LibroCajaKardexActionResult =
  | ConOrigenEnItems<LibroCajaKardexServiceResult>
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type LibroCajaKardexConDetalleActionResult =
  | ConOrigenEnItems<LibroCajaKardexConDetalleServiceResult>
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** Ficha 464 — dependencias de la descarga con detalle, inyectables en test. */
export interface CajaConDetalleDeps {
  service?: ICajaConDetalleService;
  getActor?: () => Promise<Actor | null>;
  origenes?: IOrigenLegibleService;
}

/**
 * Ficha 464 (R14/R36/R38/R39) — el resultado en el BORDE: el `ok` lleva las filas con su origen
 * legible (como `listarMovimientosCompletoAction`) y el `detalle`; `limite_excedido` lleva `hoja`.
 */
export type ListarMovimientosCompletoConDetalleActionResult =
  | ConOrigenEnItems<CajaConDetalleServiceResult>
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export interface WalletDeps {
  service?: IWalletService;
  getActor?: () => Promise<Actor | null>;
  /** Ficha 458-A (TA.2): el origen legible de las filas; en produccion, el real sobre Prisma. */
  origenes?: IOrigenLegibleService;
}

/** Ficha 458-A (TA.2) — composition root del origen legible (una consulta por tipo presente). */
function buildOrigenes(): IOrigenLegibleService {
  return new OrigenLegibleService(new OrigenLegibleRepository(getPrismaClient()));
}

/** Ficha 461 (R69): las dependencias de la anulacion de una correccion, inyectables en test. */
export interface AjusteCajaDeps {
  service?: IAjusteCajaService;
  getActor?: () => Promise<Actor | null>;
}

/** Las dependencias del detalle, inyectables en test igual que las del libro. */
export interface DetalleMovimientoDeps {
  service?: IDetalleMovimientoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Ficha 344 (T4.4) — el detalle de una fila del libro en el BORDE. `forbidden`, `not_found` y
 * `sin_reparto` los decide el DOMINIO; `unauthenticated` (sin sesion) y `validation_error`
 * (ZodError: id que no es uuid, `pageSize` sobre el tope o una clave colada) se resuelven aqui.
 * NINGUNA rama de error viaja con ordenes (R29/R42).
 */
export type VerDetalleDeMovimientoActionResult =
  | VerDetalleMovimientoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type VerDetalleDeMovimientoCompletoActionResult =
  | VerDetalleMovimientoCompletoServiceResult
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/** R19/R20/R25: lista el libro (solo maestro). Forbidden/unauthenticated sin exponer datos. */
export async function listarMovimientosAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R19: antes de tocar el service
    // Ficha 463 (R24/R33/R40): el borde DEL LIBRO — el de las cifras + termino y orden.
    const data = listarLibroCajaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    const r = await service.listarMovimientos(data, actor);
    return origenEnPagina(deps.origenes ?? buildOrigenes(), "caja", r, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Feature 170 (T C.2, design §4) — libro de caja COMPLETO, sin paginacion, para la descarga.
 * Calcado de `listarMovimientosAction`: mismo borde, mismo actor, mismo schema (menos
 * `page`/`pageSize`, y `.strict()`) y el MISMO servicio, que es quien autoriza y aplica el
 * tope. Ninguna rama devuelve filas junto a un error (R16/R17/R18).
 */
export async function listarMovimientosCompletoAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosCompletoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    // Ficha 463 (R42): el borde de la descarga del libro, con termino y orden.
    const data = listarLibroCajaCompletoSchema.parse(input ?? {}); // R18: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    const r = await service.listarMovimientosCompleto(data, actor);
    return origenEnItems(deps.origenes ?? buildOrigenes(), "caja", r, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Ficha 464 (design §2.3, R14/R36/R38/R39) — la descarga «Movimientos y detalle por orden» de la caja,
 * en UNA peticion: la MISMA entrada y el MISMO servicio que `listarMovimientosCompletoAction` (filtros,
 * termino y orden de la 463; `.strict()`), mas el detalle por orden de ESOS movimientos. El tope de la
 * hoja de movimientos y el del detalle los aplica el SERVIDOR (`limite_excedido` con `hoja`).
 *
 * Superficie (ficha 464, T8): la descarga «Movimientos y detalle por orden» del libro de `/wallet`
 * (`WalletModule.tsx`). Su `@sin-superficie` se borró al cablearla.
 */
export async function listarMovimientosCompletoConDetalleAction(
  input: unknown,
  deps: CajaConDetalleDeps = {},
): Promise<ListarMovimientosCompletoConDetalleActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = listarLibroCajaCompletoSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildCajaConDetalleService();
    const r = await service.cajaConDetalle(data, actor);
    return origenEnItems(deps.origenes ?? buildOrigenes(), "caja", r, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Ficha 468 (design §3–§4, R5–R16, R53, R57, R61) — la descarga «Solo los movimientos · una hoja» del libro
 * de la caja como KARDEX: la MISMA entrada que `listarMovimientosCompletoAction` (filtros, termino;
 * `.strict()`), con el orden FORZADO a cronologico ascendente en el servidor (R7) y, junto a las filas, el
 * `kardex` (saldo inicial y final de la tarjeta, la columna y el saldo de cada fila, totales y el «N
 * guía(s)» de los conteos, sin leer ninguna orden).
 *
 * @sin-superficie FICHA 468 (Bloque B pendiente): la cablea el frontend en la descarga del libro de `/wallet` (`WalletModule.tsx`); hasta entonces la descarga sigue en `listarMovimientosCompletoAction`. Al cablearla se borra esta anotacion.
 */
export async function libroCajaKardexAction(
  input: unknown,
  deps: CajaKardexDeps = {},
): Promise<LibroCajaKardexActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = listarLibroCajaCompletoSchema.parse(input ?? {}); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildCajaKardexService();
    const r = await service.kardex(data, actor);
    return origenEnItems(deps.origenes ?? buildOrigenes(), "caja", r, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Ficha 468 (R26, R33–R46, R53) — la descarga «Movimientos y detalle por guía · dos hojas» de la caja, en
 * UNA peticion: el kardex de `libroCajaKardexAction` y el detalle AGRUPADO por guia (`porGuia`), cuyo
 * TOTAL GENERAL el servidor afirma igual al «Total del periodo». Topes: el de la hoja de movimientos y el
 * del detalle (`limite_excedido` con `hoja`).
 *
 * @sin-superficie FICHA 468 (Bloque B pendiente): la cablea el frontend en la descarga con detalle del libro de `/wallet` (`WalletModule.tsx`), sustituyendo a `listarMovimientosCompletoConDetalleAction`. Al cablearla se borra esta anotacion.
 */
export async function libroCajaKardexConDetalleAction(
  input: unknown,
  deps: CajaKardexDeps = {},
): Promise<LibroCajaKardexConDetalleActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarLibroCajaCompletoSchema.parse(input ?? {});
    const service = deps.service ?? buildCajaKardexService();
    const r = await service.kardexConDetalle(data, actor);
    return origenEnItems(deps.origenes ?? buildOrigenes(), "caja", r, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Ficha 339 (T3.4, design §4.5) — los movimientos que componen UNA fila de la tarjeta de la
 * ganancia. Calcada de `listarMovimientosAction`: resuelve el actor, lanza `UnauthenticatedError`
 * si no hay sesion, valida con el schema derivado del listado y delega en el servicio.
 *
 * Lectura interna del mismo proyecto ⇒ Server Action, no ruta API (`docs/architecture.md`). El
 * cliente manda el TOKEN de la fila; quien traduce ese token a un conjunto de categorias es el
 * servicio, con la misma definicion que produjo el importe de la fila.
 *
 * SU SUPERFICIE (bloque B5 de la 343): `DetalleFilaComposicion`, el panel que se despliega al
 * abrir una fila de la tarjeta «Como se compone la ganancia de Ordenex». Mientras esa pantalla
 * no existio, este docstring llevo la anotacion de excepcion de
 * `superficie-de-uso.guardia.test.ts`; al cablear el desplegable se borro, que es exactamente lo
 * que esa guardia obliga a hacer.
 */
export async function listarMovimientosDeFilaAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<ListarMovimientosDeFilaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = listarMovimientosDeFilaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    const r = await service.listarMovimientosDeFila(data, actor);
    return origenEnPagina(deps.origenes ?? buildOrigenes(), "caja", r, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Feature 173 (T D.2 — R8/R64/R65): las DOS cifras de la caja para el conjunto filtrado.
 *
 * Mismo borde que `listarMovimientosAction` y **el mismo schema**: los filtros del resumen no
 * pueden ser otros que los del listado, ni siquiera por accidente de validacion. El servicio es
 * quien autoriza (R65) y quien deriva; aqui no se toca ni un monto. Money-safe: el DTO cruza la
 * frontera con todos los importes como STRING (R64) — el navegador nunca ve un `Prisma.Decimal`
 * ni recalcula dinero.
 *
 * Feature 231 (T2.3): la rama `ok` pasa a llevar tambien `composicion`. El tipo de retorno de
 * esta accion NO se toca porque ya se DERIVA del contrato del servicio
 * (`VerResumenCajaActionResult = VerResumenCajaServiceResult | …`): ampliar el resultado del
 * servicio lo amplia aqui solo. Sin schema nuevo, sin accion nueva (design §6.3) y sin una
 * sola operacion aritmetica en el borde.
 */
export async function verResumenCajaAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<VerResumenCajaActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = listarMovimientosSchema.parse(input); // los filtros de la WALLET; `.strict()`: termino u orden => validation_error (463/R14)
    const service = deps.service ?? buildService();
    return service.verResumenCaja(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

// Feature 173 (T H.2/Tanda H) — el PUENTE `verBalanceAction` se RETIRA aqui.
//
// Existio entre la Tanda D y la Tanda G, y estaba declarado como puente desde el primer dia:
// `WalletService.verBalance` desaparecio con `T D.2` (design §5.2, sustituido por
// `verResumenCaja`), pero `/wallet` seguia siendo la pantalla de la 42 y la fase backend no
// podia tocarla. El puente proyectaba los campos del DTO nuevo sobre la forma vieja
// (`enCaja` -> `balance`), sin una sola operacion aritmetica propia.
//
// `T G.3` lo dejo SIN UN SOLO CONSUMIDOR (la pagina y el modulo pasaron a
// `verResumenCajaAction`); su docstring decia «lo borra `T G.3`» y era falso —retirarlo es
// tocar `lib/`, que es backend—. Lo borra esta tanda, que es la que puede.
//
// Con el se van `VerBalanceActionResult` y el import de `WalletBalanceDTO`, que no tenian otro
// uso en este archivo. `WalletBalanceDTO` NO se borra del arbol: es el tipo de retorno de
// `derivarBalance` (`lib/utils/wallet-balance.ts`), que R9 protege intacto.

/**
 * Ficha 344 (T4.4, design §3.5) — las ordenes que componen el importe de UNA fila del libro de
 * la caja. Calcada de `listarMovimientosDeFilaAction`: resuelve el actor, lanza
 * `UnauthenticatedError` sin sesion, valida con el schema y delega en el servicio.
 *
 * Lectura interna del mismo proyecto ⇒ Server Action, no ruta API (`docs/architecture.md`). El
 * cliente manda el id del MOVIMIENTO y la pagina, y nada mas: ni el cierre, ni la categoria, ni
 * la tienda (R42). Todo lo demas lo resuelve el servidor leyendo esa fila.
 *
 * Superficie viva (ficha 344, B6): `DetalleMovimientoCierre`, el panel que despliega cada fila
 * de cierre del libro de `/wallet`. La anotacion `@sin-superficie` con la que nacio esta accion
 * se BORRO al cablearlo, porque la guardia de superficie de uso falla tambien cuando una
 * anotacion sobrevive a su motivo.
 */
export async function verDetalleDeMovimientoAction(
  input: unknown,
  deps: DetalleMovimientoDeps = {},
): Promise<VerDetalleDeMovimientoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de tocar el service
    const data = verDetalleDeMovimientoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildDetalleService();
    return service.verDetalleDeMovimiento(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * Ficha 344 (T4.4, R32/R33) — el MISMO detalle sin recorte por pagina, para la descarga. El tope
 * lo evalua y lo aplica el SERVICIO: el navegador no selecciona, no ordena y no recorta.
 *
 * Superficie viva (ficha 344, B8): el control de descarga de `DetalleMovimientoCierre`, que la
 * consume via `filasDesdeResultado` tras descartar la rama `sin_reparto`. Su `@sin-superficie`
 * se borro al cablearla, por el mismo motivo que en su hermana paginada.
 */
export async function verDetalleDeMovimientoCompletoAction(
  input: unknown,
  deps: DetalleMovimientoDeps = {},
): Promise<VerDetalleDeMovimientoCompletoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = verDetalleDeMovimientoCompletoSchema.parse(input); // R29: ZodError -> validation
    const service = deps.service ?? buildDetalleService();
    return service.verDetalleDeMovimientoCompleto(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}

/**
 * R15/R19: registra un movimiento manual de ajuste (solo maestro; monto>0, descripcion obligatoria).
 * FICHA 458-B (R42/R74): acepta tambien un `FormData` con `contraparteNombre`, `referencia` y
 * `comprobante` opcionales (molde 459); anotacion y comprobante van en la MISMA transaccion.
 */
export async function registrarMovimientoManualAction(
  input: FormData,
  deps?: WalletDeps,
): Promise<RegistrarMovimientoManualConComprobanteActionResult>;
export async function registrarMovimientoManualAction(
  input: unknown,
  deps?: WalletDeps,
): Promise<RegistrarMovimientoManualActionResult>;
export async function registrarMovimientoManualAction(
  input: unknown,
  deps: WalletDeps = {},
): Promise<RegistrarMovimientoManualConComprobanteActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const { crudo, comprobante } = separarComprobante(input);
    const data = registrarMovimientoManualConLateralesSchema.parse(crudo); // ZodError -> VALIDATION_ERROR
    const archivo = await leerComprobanteOpcional(comprobante);
    const service = deps.service ?? buildService();
    return archivo === null
      ? service.registrarMovimientoManual(data, actor)
      : service.registrarMovimientoManual(data, actor, archivo);
  });
  // El service ya devuelve validation_error de dominio si aplica; el borde solo traduce
  // ZodError/UNAUTHORIZED.
  if (isAppErrorShape(r)) {
    const t = toWalletActionError(r);
    if (t.status === "unauthenticated") return t;
    return { status: "validation_error", fieldErrors: t.fieldErrors };
  }
  return r;
}

/**
 * Ficha 461 (R69–R71, auditoria D3) — ANULA una correccion de caja con motivo. Sesion ANTES del
 * schema y del servicio; `anularAjusteCajaSchema` es `.strict()` (R70): una peticion con `monto` o
 * con cualquier clave no prevista muere aqui con `validation_error`, sin escribir nada. Molde:
 * `anularCobroTiendaAction`.
 */
export async function anularAjusteCajaAction(
  input: unknown,
  deps: AjusteCajaDeps = {},
): Promise<AnularAjusteCajaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = anularAjusteCajaSchema.parse(input); // R70: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildAjusteCajaService();
    return service.anular(data, actor);
  });
  return isAppErrorShape(r) ? toWalletActionError(r) : r;
}
