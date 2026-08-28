"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CorregirDatosClienteServiceResult,
  ICorregirDatosClienteService,
} from "@/lib/interfaces/services/ICorregirDatosClienteService";
import { corregirDatosClienteSchema } from "@/lib/types/correccion-datos-cliente";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// FICHA 312 — Server Action de la correccion de los datos del cliente. Mutacion INTERNA del mismo
// proyecto => Server Action, nunca ruta API (`docs/architecture.md`). Patron literal de
// `lib/actions/eliminar-orden.ts`: `withErrorHandler` + `resolveActorFromSession` + zod en el
// borde + fabrica del service.
//
// ⚠️ NI UN `console` EN ESTE ARCHIVO, y no es estilo: el destinatario, el telefono, el producto y
// las notas de una orden son datos de una persona real. Un `console.error("fallo", input)` en un
// `catch` los vuelca enteros al log de la plataforma, donde los lee quien nunca tuvo permiso — y
// no rompe nada, asi que nadie se entera (R16). Una guardia lo vigila.
//
// ⚠️ SIN RASTRO (D4, 2026-08-28): corregir no deja nota, ni historial, ni auditoria. El unico
// rastro es el `updated_at` de la fila.

// Estados del BORDE (los de dominio los devuelve el service).
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type CorregirDatosClienteActionResult = CorregirDatosClienteServiceResult | BorderError;

export interface CorregirDatosClienteDeps {
  service?: ICorregirDatosClienteService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * El COMPOSITION ROOT. Construye el repositorio real y LO PASA al service: importarlo no basta —
 * un servicio que recibe `undefined` compila igual y muere en produccion.
 */
function buildService(): ICorregirDatosClienteService {
  return new CorregirDatosClienteService(new OrdenRepository(getPrismaClient()));
}

/** Espejo de `toEliminarActionError`: solo los dos codigos que este borde puede producir. */
function toCorregirActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`corregir-datos-cliente: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * Corrige los datos del cliente de UNA orden: `destinatario`, `telefonoDest`, `producto` y
 * `notas`, y nada mas (D1).
 *
 * El orden importa y esta medido en su test: la SESION se comprueba antes que el schema, asi que
 * ni una peticion sin sesion ni una entrada invalida llegan a construir el service ni a tocar
 * ninguna fila (R7, R2, R3). `forbidden` y `conflict` los devuelve el service, que revalida rol,
 * pertenencia y estado en CADA peticion, con independencia de lo que la pantalla haya ofrecido
 * (R25).
 *
 * @sin-superficie ficha 312 en dos tandas: el backend entra primero y su modal (bloque E) y su
 * celda de `/novedades` (bloque F) llegan despues, en la misma ficha y contra este mismo codigo.
 * La anotacion CADUCA: en cuanto alguna pantalla la importe, esta guardia exige borrarla.
 */
export async function corregirDatosCliente(
  input: unknown,
  deps: CorregirDatosClienteDeps = {},
): Promise<CorregirDatosClienteActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = corregirDatosClienteSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.corregir(
      {
        ordenId: data.ordenId,
        destinatario: data.destinatario,
        telefonoDest: data.telefonoDest,
        producto: data.producto,
        notas: data.notas,
      },
      actor,
    );
  });
  return isAppErrorShape(r) ? toCorregirActionError(r) : r;
}
