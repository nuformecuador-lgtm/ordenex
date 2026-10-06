"use server";

// Ficha 474 (design §7, T9.1) — SERVER ACTIONS de «Envíos automáticos» (Configuración). Patron de
// `lib/actions/plantillas.ts`: actor de la sesion ANTES de tocar nada (no autenticado), zod en el
// borde (`validation_error`), y el service decide `forbidden` (R1: solo maestro) antes de leer o
// escribir. Ninguna ruta API nueva; ningun cron nuevo.
import {
  guardarEnvioSchema,
  idSchema,
  listarEjecucionesSchema,
  seleccionDestinatariosSchema,
  type ApagarEnvioResult,
  type BorrarEnvioResult,
  type EncenderEnvioResult,
  type EnviosActionError,
  type FirmarPdfEjecucionResult,
  type GuardarEnvioResult,
  type ListarEjecucionesResult,
  type ListarEnviosResult,
  type ListarEventosDisponiblesResult,
  type ListarInformesResult,
  type ObtenerEjecucionResult,
  type ObtenerEnvioResult,
  type PrevisualizarDestinatariosResult,
  type ProbarEnvioResult,
  type ReprogramarEnvioResult,
} from "@/lib/types/envios-whatsapp";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWhatsappEnvioService } from "@/lib/interfaces/services/IWhatsappEnvioService";
import type { IEjecucionEnvioService } from "@/lib/interfaces/services/IEjecucionEnvioService";
import type { IWhatsappEjecucionRepository } from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { IAlmacenEnviosWhatsapp } from "@/lib/interfaces/external/IAlmacenEnviosWhatsapp";
import { buildEnviosWhatsappDeps } from "@/lib/services/jobs/whatsapp-envio-deps";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  ValidationError,
  MSG,
  type AppErrorShape,
} from "@/lib/errors";
import { toActionError } from "@/lib/actions/_shared/to-action-error";
import { TTL_FIRMA_PDF_SEGUNDOS } from "@/lib/config/whatsapp-envios";

/** Dependencias inyectables (tests). En produccion, el composition root del motor. */
export interface EnviosWhatsappActionDeps {
  getActor?: () => Promise<Actor | null>;
  configuracion?: IWhatsappEnvioService;
  ejecutor?: Pick<IEjecucionEnvioService, "probar">;
  ejecuciones?: Pick<IWhatsappEjecucionRepository, "historial" | "detalle" | "pdfDe">;
  almacen?: Pick<IAlmacenEnviosWhatsapp, "firmar">;
}

const ALLOWED_ROLES = new Set<string>(["maestro"]);

function aError(shape: AppErrorShape): EnviosActionError {
  const e = toActionError(shape);
  if (e.status === "conflict") throw new Error(`conflict inesperado en envios-whatsapp: ${shape.code}`);
  return e as EnviosActionError;
}

async function actorOError(deps: EnviosWhatsappActionDeps): Promise<Actor> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

function idValido(id: unknown): string {
  const r = idSchema.safeParse(id);
  if (!r.success) throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { id: ["id invalido"] } });
  return r.data;
}

function configuracion(deps: EnviosWhatsappActionDeps): IWhatsappEnvioService {
  return deps.configuracion ?? buildEnviosWhatsappDeps().configuracion;
}

async function ejecutar<T>(fn: () => Promise<T>): Promise<T | EnviosActionError> {
  const r = await withErrorHandler(fn);
  return isAppErrorShape(r) ? aError(r) : (r as T);
}

export async function listarEnvios(deps: EnviosWhatsappActionDeps = {}): Promise<ListarEnviosResult> {
  return ejecutar(async () => configuracion(deps).listar(await actorOError(deps)));
}

export async function obtenerEnvio(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<ObtenerEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    return configuracion(deps).obtener(idValido(id), actor);
  });
}

/**
 * R11-R16. Nace apagado (R15).
 */
export async function crearEnvio(input: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<GuardarEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const data = guardarEnvioSchema.parse(input); // ZodError -> validation_error
    const r = await configuracion(deps).crear(data, actor);
    return r;
  });
}

/**
 * R11-R16 + R20.
 */
export async function actualizarEnvio(
  id: unknown,
  input: unknown,
  deps: EnviosWhatsappActionDeps = {},
): Promise<GuardarEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const envioId = idValido(id);
    const data = guardarEnvioSchema.parse(input);
    return configuracion(deps).actualizar(envioId, data, actor);
  });
}

/**
 * R18/R22.
 */
export async function encenderEnvio(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<EncenderEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    return configuracion(deps).encender(idValido(id), actor);
  });
}

/**
 * R19.
 */
export async function apagarEnvio(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<ApagarEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    return configuracion(deps).apagar(idValido(id), actor);
  });
}

/**
 * R25: «Reprogramar» cuando falta la proxima ejecucion.
 */
export async function reprogramarEnvio(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<ReprogramarEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    return configuracion(deps).reprogramar(idValido(id), actor);
  });
}

/**
 * R21.
 */
export async function borrarEnvio(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<BorrarEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    return configuracion(deps).borrar(idValido(id), actor);
  });
}

/**
 * R17: NO escribe.
 */
export async function previsualizarDestinatarios(
  seleccion: unknown,
  deps: EnviosWhatsappActionDeps = {},
): Promise<PrevisualizarDestinatariosResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const sel = seleccionDestinatariosSchema.parse(seleccion);
    return configuracion(deps).previsualizarDestinatarios(sel, actor);
  });
}

/**
 * R49: los diez eventos disponibles con su nombre.
 */
export async function listarEventosDisponibles(
  deps: EnviosWhatsappActionDeps = {},
): Promise<ListarEventosDisponiblesResult> {
  return ejecutar(async () => configuracion(deps).listarEventosDisponibles(await actorOError(deps)));
}

/**
 * El catalogo de informes para el formulario (defaults R13, eventos R14, descriptores).
 */
export async function listarInformesWhatsapp(deps: EnviosWhatsappActionDeps = {}): Promise<ListarInformesResult> {
  return ejecutar(async () => configuracion(deps).listarInformes(await actorOError(deps)));
}

/**
 * R39-R41/R52: «Probar ahora», solo a quien pulsa, con el resultado en la misma respuesta.
 */
export async function probarEnvioWhatsapp(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<ProbarEnvioResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const envioId = idValido(id);
    const ejecutor = deps.ejecutor ?? buildEnviosWhatsappDeps().ejecutor;
    return ejecutor.probar(envioId, actor);
  });
}

/**
 * R42: historial paginado, mas reciente primero, filtrable por envio.
 */
export async function listarEjecuciones(input: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<ListarEjecucionesResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const f = listarEjecucionesSchema.parse(input ?? {});
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" as const };
    const repo = deps.ejecuciones ?? buildEnviosWhatsappDeps().ejecuciones;
    const { items, total } = await repo.historial(f);
    return { status: "ok" as const, items, page: f.page, pageSize: f.pageSize, total };
  });
}

/**
 * R42: detalle de una ejecucion con sus entregas (telefono enmascarado).
 */
export async function obtenerEjecucion(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<ObtenerEjecucionResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const ejecucionId = idValido(id);
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" as const };
    const repo = deps.ejecuciones ?? buildEnviosWhatsappDeps().ejecuciones;
    const d = await repo.detalle(ejecucionId);
    if (d === null) return { status: "not_found" as const };
    return { status: "ok" as const, ejecucion: d.ejecucion, entregas: d.entregas };
  });
}

/**
 * R43/R44: enlace firmado de corta duracion; `caducado` si ya se purgo. Solo maestro.
 */
export async function firmarPdfEjecucion(id: unknown, deps: EnviosWhatsappActionDeps = {}): Promise<FirmarPdfEjecucionResult> {
  return ejecutar(async () => {
    const actor = await actorOError(deps);
    const ejecucionId = idValido(id);
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" as const };
    const base = deps.ejecuciones === undefined || deps.almacen === undefined ? buildEnviosWhatsappDeps() : null;
    const repo = deps.ejecuciones ?? (base as NonNullable<typeof base>).ejecuciones;
    const pdf = await repo.pdfDe(ejecucionId);
    if (pdf === null) return { status: "not_found" as const };
    if (pdf.ruta === null) return { status: "sin_pdf" as const };
    if (pdf.purgado) return { status: "caducado" as const };
    const almacen = deps.almacen ?? (base as NonNullable<typeof base>).almacen;
    return { status: "ok" as const, url: await almacen.firmar(pdf.ruta, TTL_FIRMA_PDF_SEGUNDOS) };
  });
}
