"use server";

import { z } from "zod";

import {
  guardarSinpeBodegaSchema,
  type ConfirmarSinpeBodegaResult,
  type GuardarSinpeBodegaResult,
  type ListarSinpeBodegasResult,
  type SinpeBodegaActionError,
} from "@/lib/types/sinpe-bodega";
import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type { ISinpeBodegaService } from "@/lib/interfaces/services/ISinpeBodegaService";
import { SinpeBodegaService } from "@/lib/services/SinpeBodegaService";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  withErrorHandler,
  isAppErrorShape,
  UnauthenticatedError,
  ValidationError,
  MSG,
  type AppErrorShape,
} from "@/lib/errors";

/**
 * ⭑ FICHA 429 — EL BORDE DE LA SUPERFICIE DEL SINPE POR BODEGA.
 *
 * ⚠️ SERVER ACTIONS Y NO ROUTE HANDLERS: son mutaciones INTERNAS desde un componente propio, que
 * es lo que `docs/architecture.md` manda en su tabla «Server Actions vs Route Handlers». No hay
 * consumidor externo: nadie fuera de la aplicacion tiene por que poder cambiar a que cuenta
 * transfieren los clientes.
 *
 * ⚠️ ARCHIVO PROPIO Y NO `lib/actions/zonas.ts`. Aquel es `maestro`-only de arriba abajo —sus cinco
 * acciones empiezan por `esMaestro(actor)`— y su `actualizarZona` es un REEMPLAZO COMPLETO que
 * arrastra distritos, tarifas del mensajero y la marca de zona central. Meter aqui una accion con
 * OTRO modelo de permisos invita a que la siguiente edicion ensanche la equivocada: bastaria un
 * `adminSatelite` colado en el gate de `actualizarZona` para darle la reescritura de
 * `tarifa_zona_mensajero` de su zona entera. Separado, lo que ese rol gana son DOS campos.
 */

const idSchema = z.string().min(1);

/** Traduce el `AppErrorShape` del manejador global al error tipado de esta superficie. */
function toSinpeActionError(shape: AppErrorShape): SinpeBodegaActionError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    case "FORBIDDEN":
      return { status: "forbidden" };
    case "NOT_FOUND":
      return { status: "not_found" };
    // Esta superficie NO produce `conflict`: dos campos de una fila que ya existe no chocan con
    // nada. Si llegara uno, es un fallo de programacion y sube como error interno en vez de
    // convertirse en un desenlace que la pantalla no sabria pintar.
    case "CONFLICT":
    case "INTERNAL":
      throw new Error("internal");
    default: {
      const _exhaustive: never = shape.code;
      throw new Error(`Unhandled AppErrorCode: ${String(_exhaustive)}`);
    }
  }
}

function buildSinpeBodegaService(): ISinpeBodegaService {
  return new SinpeBodegaService(new ZonaRepository(getPrismaClient()));
}

export interface SinpeBodegaActionDeps {
  sinpeBodegaService?: ISinpeBodegaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Las bodegas que este actor puede ver, con su `editable` ya decidido en el servidor.
 *
 * SUPERFICIE (T21): `app/(app)/configuracion/sinpe/page.tsx` —las ocho, para `admin` y
 * `maestro`— y `app/(app)/mi-bodega/page.tsx` —una sola ficha, la del `adminSatelite`—. La
 * anotacion `@sin-superficie` que este export llevo mientras las pantallas no existian se BORRO
 * al cablearlas: dejarla habria fosilizado la excepcion y `superficie-de-uso.guardia` se la
 * habria comido en silencio.
 */
export async function listarSinpeBodegas(
  deps: SinpeBodegaActionDeps = {},
): Promise<ListarSinpeBodegasResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const service = deps.sinpeBodegaService ?? buildSinpeBodegaService();
    return service.listar(actor);
  });
  return isAppErrorShape(r) ? toSinpeActionError(r) : r;
}

/**
 * Guarda el par de UNA bodega.
 *
 * ⚠️ `.strict()` EN EL ESQUEMA: un campo desconocido devuelve `validation_error`, no un descarte
 * mudo. En una superficie de dinero, «te ignoré un campo» es la forma educada de perder un dato.
 *
 * ⚠️ EL `zonaId` VIAJA APARTE del payload y no dentro: asi no hay forma de que un campo del cuerpo
 * se confunda con la identidad de lo que se toca. Y quien decide si ese id se puede tocar es el
 * SERVICIO, con la zona que la base le asigna al actor (R20).
 *
 * SUPERFICIE (T21/T22): el modal de «SINPE por bodega», la tarjeta de `/mi-bodega` y la
 * correccion EN EL SITIO del aviso del primer ingreso (`RevisionSinpeBodega`, R27). Las tres
 * pintan el `validation_error` JUNTO AL CAMPO, que es para lo que el resultado trae `fieldErrors`
 * y no un mensaje suelto.
 */
export async function guardarSinpeBodega(
  zonaId: unknown,
  input: unknown,
  deps: SinpeBodegaActionDeps = {},
): Promise<GuardarSinpeBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = idSchema.safeParse(zonaId);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { zonaId: ["id invalido"] } });
    }
    const data = guardarSinpeBodegaSchema.parse(input);
    const service = deps.sinpeBodegaService ?? buildSinpeBodegaService();
    return service.guardar(parsedId.data, data, actor);
  });
  return isAppErrorShape(r) ? toSinpeActionError(r) : r;
}

/**
 * «Está bien»: marca la bodega como revisada. NO acepta valores (R25).
 *
 * SUPERFICIE (T22): el boton «Confirmar» de `components/shared/RevisionSinpeBodega.tsx`, y SOLO
 * cuando la persona no ha cambiado ninguno de los dos valores. Si cambio alguno se llama a
 * `guardarSinpeBodega`, que ademas deja la fila de historial.
 */
export async function confirmarSinpeBodega(
  zonaId: unknown,
  deps: SinpeBodegaActionDeps = {},
): Promise<ConfirmarSinpeBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const parsedId = idSchema.safeParse(zonaId);
    if (!parsedId.success) {
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors: { zonaId: ["id invalido"] } });
    }
    const service = deps.sinpeBodegaService ?? buildSinpeBodegaService();
    return service.confirmar(parsedId.data, actor);
  });
  return isAppErrorShape(r) ? toSinpeActionError(r) : r;
}
