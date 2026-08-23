"use server";

import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { CorreccionDiaRepartoService } from "@/lib/services/CorreccionDiaRepartoService";
import { notificarDiaRepartoCorregidoReal } from "@/lib/notificaciones/notificadores";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { diaRepartoSchema } from "@/lib/types/dia-reparto";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CorregirDiaRepartoServiceResult,
  ICorreccionDiaRepartoService,
} from "@/lib/interfaces/services/ICorreccionDiaRepartoService";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

// Feature 262 (B7, design §3) — Server Action que CORRIGE el dia de reparto de un lote de ordenes ya
// asignadas. Mutacion interna del mismo proyecto => Server Action, nunca ruta API
// (`docs/architecture.md`). Molde literal de `lib/actions/deshacer-asignacion.ts`:
// `withErrorHandler` + `resolveActorFromSession` + zod en el borde + fabrica del service. NINGUNA
// regla de negocio aqui: esta capa es el borde y el reviewer lo rechaza si deja de serlo.

/**
 * R2/R21 — el borde.
 *
 * ⚠️ `dia` VA SIN `.default("hoy")`, AL CONTRARIO QUE EN LOS DOS SCHEMAS DE ASIGNACION (design
 * §4.3). Alli el default significa «como antes de la feature 246» y por eso es correcto. AQUI un
 * default significaria que una llamada SIN CAMPO mueve el lote a hoy sin que nadie lo eligiera — y
 * la mitad de las correcciones son «mañana -> hoy». El campo es OBLIGATORIO: `parse` sin `dia`
 * falla con `validation_error` antes de tocar un solo dato.
 *
 * Y es un TOKEN, no una fecha: con dos opciones que significan «el dia en curso» y «el siguiente»,
 * mover al pasado NO ES EXPRESABLE (R3). No hay ningun `if` que alguien pueda relajar.
 *
 * `motivo` (R21): `trim()` corre ANTES de las cotas, asi que «   » queda en «» y falla el `min(10)`;
 * el valor que llega al service ya viene RECORTADO. 300 es el tope del motivo de gestion
 * (consistencia visual de la linea de tiempo), copiado del borde de la 149.
 */
const corregirDiaRepartoSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  dia: diaRepartoSchema,
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

export type CorregirDiaRepartoActionResult = CorregirDiaRepartoServiceResult | BorderError;

export interface CorregirDiaRepartoDeps {
  service?: ICorreccionDiaRepartoService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * COMPOSITION ROOT del aviso al mensajero: el notificador REAL se inyecta AQUI y solo aqui (patron
 * `notificadores.ts:11-19`). El default del service es el no-op, asi que una suite que lo construya
 * sin inyectar no escribe ni una notificacion, por construccion.
 */
function buildService(): ICorreccionDiaRepartoService {
  const prisma = getPrismaClient();
  return new CorreccionDiaRepartoService(
    new OrdenRepository(prisma),
    notificarDiaRepartoCorregidoReal,
  );
}

/** Traduce el `AppErrorShape` que puede producir este borde: ZodError o falta de sesion. */
function toCorregirDiaActionError(shape: AppErrorShape): BorderError {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`corregir-dia-reparto: AppErrorCode inesperado ${shape.code}`);
  }
}

/**
 * R1-R15: fija el dia de reparto del lote COMPLETO o de ninguna orden, sin cambiar el estado, el
 * mensajero, la guia ni el instante de asignacion.
 *
 * `unauthenticated` (sin sesion) y `validation_error` (lote vacio, uuid invalido, `dia` ausente o
 * desconocido, motivo fuera de rango) se resuelven en el BORDE, sin construir el service ni tocar
 * dato alguno; `forbidden` / `sin_zona` / `conflict` los devuelve el service.
 *
 * @sin-superficie los dos modales que la disparan (`CambiarDiaRepartoModal` y su hermano del
 * listado satelite, tareas F1-F4 de `specs/262-corregir-dia-reparto/tasks.md`) llegan DESPUES: la
 * ficha es de zona `fullstack` y su `tasks.md` secuencia backend -> frontend a proposito, con el
 * bloque de UI arrancando cuando los contratos ya estan en la rama. Esta anotacion es TEMPORAL y
 * CADUCA SOLA: la otra mitad de esta misma guardia («ninguna anotacion sobrevive a su motivo») se
 * pone roja en cuanto la accion recupere superficie, asi que quien monte los modales esta obligado
 * a borrarla. Si el bloque de UI se cancelara, entonces lo que sobra es la accion entera.
 */
export async function corregirDiaReparto(
  input: unknown,
  deps: CorregirDiaRepartoDeps = {},
): Promise<CorregirDiaRepartoActionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de leer o escribir nada
    const data = corregirDiaRepartoSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();
    // UN dia y UN motivo (ya recortado por el schema) para todas las ordenes del lote.
    return service.corregir(
      { ordenIds: data.ordenIds, dia: data.dia, motivo: data.motivo },
      actor,
    );
  });
  return isAppErrorShape(r) ? toCorregirDiaActionError(r) : r;
}
