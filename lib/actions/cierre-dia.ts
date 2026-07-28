"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { SupabaseSignedUrlProvider } from "@/lib/storage/SupabaseSignedUrlProvider";
import { gestionConfig } from "@/lib/config/gestion";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ICierreDiaService } from "@/lib/interfaces/services/ICierreDiaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import {
  deshacerGestionSchema,
  type DeshacerGestionResult,
  type ListarCierreDiaResult,
  type SolicitarCierreResult,
} from "@/lib/types/cierre";
import { notificarCierreDiaPorAprobarReal } from "@/lib/notificaciones/notificadores";
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
    // (R3/R8) y para eso necesita el resolver de la tarifa vigente por tienda.
    new CierreDiaRepository(prisma, new TarifaVigentePorTiendaRepository(prisma)),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    // Las evidencias son las de gestion_orden (feature 36): mismo bucket privado.
    new SupabaseSignedUrlProvider(undefined, gestionConfig.EVIDENCIA_BUCKET),
    // Feature 39: resolver de la tarifa de pago al mensajero (por zona+vehiculo).
    new TarifaZonaMensajeroRepository(prisma),
    // Feature 146/R24: COMPOSITION ROOT del aviso "cierre por aprobar". Se cablea aqui y no
    // como default del service (ver `lib/notificaciones/notificadores.ts`).
    notificarCierreDiaPorAprobarReal,
  );
}

export interface CierreDiaDeps {
  service?: ICierreDiaService;
  getActor?: () => Promise<Actor | null>;
}

// Feature 41 (R21): deps del flag de bloqueo derivado del mensajero. Inyecta el repo
// (solo el metodo de bloqueo) y el actor en tests, sin tocar el service backend.
export interface EstadoBloqueoMensajeroDeps {
  ordenRepo?: Pick<IOrdenRepository, "findMensajerosBloqueados">;
  getActor?: () => Promise<Actor | null>;
}

/** Resultado del flag de bloqueo del mensajero (R21). `unauthenticated` = sin sesion. */
export type EstadoBloqueoMensajeroResult =
  | { status: "ok"; bloqueado: boolean }
  | { status: "unauthenticated" };

/**
 * Feature 41 (R21): deriva SERVER-SIDE si el mensajero (el actor) esta BLOQUEADO para
 * recibir nuevas asignaciones = tiene al menos un cierre en estado bloqueante
 * (`solicitado`/`vencido`), reutilizando `findMensajerosBloqueados` del backend (sin
 * flag persistido). El dato viaja por props a la vista del mensajero, que muestra el
 * aviso accionable. No muta nada; solo lectura.
 */
export async function estadoBloqueoMensajero(
  deps: EstadoBloqueoMensajeroDeps = {},
): Promise<EstadoBloqueoMensajeroResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R1: antes de tocar el repo
    const repo = deps.ordenRepo ?? new OrdenRepository(getPrismaClient());
    const bloqueados = await repo.findMensajerosBloqueados([actor.usuarioId]);
    return { status: "ok" as const, bloqueado: bloqueados.has(actor.usuarioId) };
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

// Feature 67 — traduce el AppErrorShape que puede producir ESTE borde: solo ZodError
// (VALIDATION_ERROR, R10) o falta de sesion (UNAUTHORIZED, R7). `forbidden`/`conflict` los
// devuelve el service como resultado de dominio, por eso NO aparecen aqui. Espejo EXACTO de
// `toDevolucionOrigenActionError` (48) / `toMisAsignacionesActionError` (36).
function toDeshacerGestionActionError(
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
 * `en_ruta`). Mutacion interna del propio proyecto -> Server Action, no Route API
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
  return isAppErrorShape(r) ? toDeshacerGestionActionError(r) : r;
}
