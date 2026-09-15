"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TraspasoMensajeroService } from "@/lib/services/TraspasoMensajeroService";
import {
  notificarTraspasoCedidoReal,
  notificarTraspasoRecibidoReal,
} from "@/lib/notificaciones/notificadores";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ITraspasoMensajeroService,
  TraspasoMensajeroServiceResult,
} from "@/lib/interfaces/services/ITraspasoMensajeroService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// FICHA 427 (T18, design §5) — Server Action que TRASPASA a otro mensajero un lote de ordenes que
// un mismo mensajero YA LLEVA ENCIMA. Mutacion interna del mismo proyecto => Server Action, nunca
// ruta API (`docs/architecture.md`). Molde literal de `lib/actions/corregir-dia-reparto.ts` y
// `lib/actions/deshacer-asignacion.ts`: `withErrorHandler` + `resolveActorFromSession` + zod en el
// borde + fabrica del service. NINGUNA regla de negocio aqui: esta capa es el borde.
//
// SIN PII EN LOGS (R37/R40): esta accion no registra destinatario, direccion, telefono ni monto.

/**
 * R8/R28 — el borde.
 *
 * ⚠️ **NO HAY CAMPO DE MENSAJERO DE ORIGEN, Y ES R8 PUESTO EN EL SCHEMA.** El origen se DERIVA de
 * las ordenes dentro del servicio. Aceptarlo del cliente permitiria pedir «mueve estas ordenes COMO
 * SI fueran de X» y la guarda del `WHERE` compararia contra un valor elegido por quien llama; que
 * el campo no exista lo hace inexpresable, en vez de depender de que nadie lo mande. Un objeto con
 * un campo de mas lo ignora `zod` por defecto, asi que el service nunca lo ve.
 *
 * `motivo` (R28): `trim()` corre ANTES de las cotas, asi que «   » (solo espacios) queda en «» y
 * falla el `min(10)`; el valor que llega al service ya viene RECORTADO. 300 es el tope del motivo
 * de gestion (consistencia visual de la linea de tiempo), copiado del borde de la 149.
 */
const traspasarSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  mensajeroDestinoId: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "explica el motivo (minimo 10 caracteres)")
    .max(300, "el motivo no puede superar los 300 caracteres"),
});

/** Estados del BORDE (los de dominio los devuelve el service). */
type BorderError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

export type TraspasarMensajeroActionResult = TraspasoMensajeroServiceResult | BorderError;

export interface TraspasarMensajeroDeps {
  service?: ITraspasoMensajeroService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * ⚠️ COMPOSITION ROOT DE LOS DOS AVISOS: los notificadores REALES se inyectan AQUI y solo aqui
 * (patron `notificadores.ts`). El default del service es el NO-OP, asi que una suite que lo
 * construya sin inyectar no escribe ni una notificacion, por construccion.
 *
 * ⚠️ Y QUE ALGUIEN LOS **PASE** ES LA MITAD DEL REQUISITO. Este repo ya tuvo **2 de 7 notificadores
 * muertos con la suite entera en verde** porque nadie comprobaba el cableado, solo que el modulo
 * los importara. `tests/unit/actions/traspasar-mensajero.test.ts` afirma que el servicio los
 * RECIBE: dejar el no-op aqui —quitar los dos argumentos— pone ESE test rojo.
 */
function buildService(): ITraspasoMensajeroService {
  const prisma = getPrismaClient();
  return new TraspasoMensajeroService(
    new OrdenRepository(prisma),
    notificarTraspasoRecibidoReal, // R38 + push al destino (R43)
    notificarTraspasoCedidoReal, // R39, sin push (R43)
  );
}

/** Traduce el `AppErrorShape` que puede producir este borde: ZodError o falta de sesion. */
function toTraspasarActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`traspasar-mensajero: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * ⭑ LA ANOTACION DE EXCEPCION DE `superficie-de-uso.guardia` VIVIO AQUI EL 2026-09-14 Y YA SE
 * BORRO, COMO ESTABA PREVISTO. La tanda de backend la puso porque el servicio, la transaccion y los
 * dos avisos
 * entraron ANTES que su pantalla; la tanda de frontend monto `TraspasarMensajeroModal` en la barra
 * de `/ordenes` (T22/T23) y con eso la OTRA mitad de `superficie-de-uso.guardia` —«ninguna
 * anotacion sobrevive a su motivo»— se puso roja hasta que se quito. Se deja escrito el episodio,
 * como lo dejo `corregirDiaReparto` (262): el mecanismo funciono y por eso esta accion no se quedo
 * sin control, que es lo que le paso a la ficha 352.
 *
 * R1-R43: traspasa el lote COMPLETO al mensajero destino —con sus conversaciones de chat, su rastro
 * y el recalculo de ruta de los DOS mensajeros— o no mueve ninguna orden.
 *
 * `unauthenticated` (sin sesion) y `validation_error` (lote vacio, uuid invalido, motivo fuera de
 * rango) se resuelven en el BORDE, sin construir el service ni tocar dato alguno; `forbidden` y
 * `conflict` los devuelve el service.
 */
export async function traspasarMensajero(
  input: unknown,
  deps: TraspasarMensajeroDeps = {},
): Promise<TraspasarMensajeroActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R2: antes de leer o escribir nada
    const data = traspasarSchema.parse(input); // R28: ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    // UN destino y UN motivo (ya recortado por el schema) para todas las ordenes del lote.
    return service.traspasar(
      {
        ordenIds: data.ordenIds,
        mensajeroDestinoId: data.mensajeroDestinoId,
        motivo: data.motivo,
      },
      actor,
    );
  });
  return isAppErrorShape(r) ? toTraspasarActionError(r) : r;
}
