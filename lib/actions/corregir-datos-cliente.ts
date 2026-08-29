"use server";

import { z } from "zod";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CorregirDatosClienteServiceResult,
  ICorregirDatosClienteService,
  ObtenerUbicacionServiceResult,
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

/** FICHA 327 (R31) — el desenlace de la PRECARGA. `forbidden` es el mismo objeto opaco (R18/R30). */
export type ObtenerUbicacionOrdenResult = ObtenerUbicacionServiceResult | BorderError;

export interface CorregirDatosClienteDeps {
  service?: ICorregirDatosClienteService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * El COMPOSITION ROOT. Construye los repositorios reales y LOS PASA al service: importarlos no
 * basta — un servicio que recibe `undefined` compila igual y muere en produccion.
 *
 * ⚠️ EL SEGUNDO ARGUMENTO ES OBLIGATORIO Y ESTE ES EL UNICO SITIO QUE LO PASA. Sin
 * `TarifaVigenteRepository`, el aviso del importe de R11 reventaria en la primera correccion que
 * cambiara el distrito, en produccion y no en ningun test. Un test del composition root real lo
 * fija.
 */
function buildService(): ICorregirDatosClienteService {
  const prisma = getPrismaClient();
  return new CorregirDatosClienteService(
    new OrdenRepository(prisma),
    new TarifaVigenteRepository(prisma),
  );
}

/**
 * FICHA 327 — el borde de la PRECARGA. Solo el id: no hay nada que validar mas alla de que sea un
 * uuid, y `.strict()` cierra la puerta a que alguien cuele campos por aqui.
 */
const obtenerUbicacionOrdenSchema = z.object({ ordenId: z.uuid() }).strict();

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
 * Corrige los datos del cliente de UNA orden y, desde la ficha 327, tambien su ubicacion:
 * `destinatario`, `telefonoDest`, `producto`, `notas`, `direccion`, `provinciaId`, `cantonId`,
 * `distritoId` y `peso`. Nada mas (312/D1 + 327/D1).
 *
 * ⚠️ ESTA ACCION PUEDE MOVER DINERO (327/D5), y por eso puede responder `confirmacion_requerida`:
 * si la correccion cambia el DISTRITO y no llega `confirmaCambioDeUbicacion: true`, el servidor NO
 * escribe nada y devuelve los importes de la ubicacion actual y de la propuesta. La pantalla los
 * pinta y reenvia confirmando. El gate esta en el servidor —no en el modal— justo para que no se
 * lo pueda saltar un cliente hecho a mano.
 *
 * `zonaId` NO se acepta ni con confirmacion: la deriva el servidor del distrito (327/R5).
 *
 * El orden importa y esta medido en su test: la SESION se comprueba antes que el schema, asi que
 * ni una peticion sin sesion ni una entrada invalida llegan a construir el service ni a tocar
 * ninguna fila (R7, R2, R3). `forbidden` y `conflict` los devuelve el service, que revalida rol,
 * pertenencia y estado en CADA peticion, con independencia de lo que la pantalla haya ofrecido
 * (R25).
 *
 * ⏳ AQUI VIVIA LA ANOTACION DE «SIN SUPERFICIE», y se BORRO el 2026-08-28 al llegar la tanda de
 * frontend de esta misma ficha. Decia que el backend entraba primero y que su modal (bloque E) y su
 * celda de `/novedades` (bloque F) llegaban despues, y terminaba: «la anotacion CADUCA: en cuanto
 * alguna pantalla la importe, esta guardia exige borrarla». Eso es lo que paso: hoy la importan y
 * la llaman `CorregirDatosClienteAccion` (modulo de ordenes) y `NovedadesModule` (las cards de
 * `/novedades`, en los DOS grupos), asi que la excusa habria sobrevivido a su motivo — que es
 * exactamente lo que `superficie-de-uso.guardia.test.ts` pone en rojo. No se repone: si algun dia
 * las dos pantallas desaparecieran, lo que sobra es la accion, no la excusa.
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
        // Ficha 327 — la ubicacion. `distritoId` sale del schema como `string | undefined`: el
        // `refine` de R4 ya descarto el `null` que el origen admitia.
        direccion: data.direccion,
        provinciaId: data.provinciaId,
        cantonId: data.cantonId,
        distritoId: data.distritoId ?? undefined,
        peso: data.peso,
        confirmaCambioDeUbicacion: data.confirmaCambioDeUbicacion,
      },
      actor,
    );
  });
  return isAppErrorShape(r) ? toCorregirActionError(r) : r;
}

/**
 * FICHA 327 (R31, design §9.3) — LA PRECARGA del editor: los nueve valores actuales de la orden
 * mas los nombres que la pantalla pinta.
 *
 * VIVE EN ESTE ARCHIVO Y NO EN UNO NUEVO a proposito: la guardia de la 312 vigila un CENSO de
 * modulos, y un archivo nuevo con datos del cliente dentro tendria que entrar en el. Aqui ya esta
 * vigilado.
 *
 * MISMO ORDEN QUE LA ESCRITURA: sesion antes que schema, y el service revalida rol, pertenencia y
 * ventana (R18/R28). A quien no cruza esa puerta se le devuelve el MISMO `forbidden` opaco que por
 * cualquier otro motivo (R30): ni un dato de la orden.
 *
 * @sin-superficie TRANSITORIA: la 327 entra en dos tandas y esta es la de backend. Su pantalla es
 * el bloque E de la misma ficha (`CorregirDatosClienteModal` la llama al abrirse, para precargar
 * los nueve campos, `tasks.md` E2). **LA ANOTACION CADUCA EN CUANTO EL MODAL LA IMPORTE**, y la
 * propia guardia lo exige: su caso «ninguna anotacion sobrevive a su motivo» se pone ROJA el dia
 * que esta accion sea alcanzable y la excusa siga aqui. Es exactamente lo que le paso a
 * `listarAyudaTiendaCompletoAction` (novedades) y a la hermana `corregirDatosCliente` de este mismo
 * archivo. **Si el bloque E se cancelara, lo que sobra es la accion, no la anotacion.**
 */
export async function obtenerUbicacionOrden(
  input: unknown,
  deps: CorregirDatosClienteDeps = {},
): Promise<ObtenerUbicacionOrdenResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = obtenerUbicacionOrdenSchema.parse(input);
    const service = deps.service ?? buildService();
    return service.obtenerUbicacion(data.ordenId, actor);
  });
  return isAppErrorShape(r) ? toCorregirActionError(r) : r;
}
