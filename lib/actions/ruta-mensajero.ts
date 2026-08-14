"use server";

// Feature 92 (design §6.2, R22/R32/R33/R34) — Server Action de la sincronizacion MANUAL de
// la ruta del mensajero (mutacion interna del mismo proyecto: Server Action, no Route API,
// patron de las features 21/36). Resuelve el actor por sesion, valida en el borde con zod y
// delega en el servicio, TODO bajo `withErrorHandler` (patron `mis-asignaciones.ts`).
//
// ═══ POR QUE ES SINCRONA Y NO ENCOLADA (gate F1.4-Q5) ═══
// El modulo del mensajero NO usa SWR: es Server Component + props + `router.refresh()`
// (verificado). Encolar obligaria al mensajero a esperar hasta 60 s al cron sin ningun
// feedback y sin nada con lo que hacer polling. El coste —una llamada facturada por
// pulsacion— lo acota R34 (intervalo minimo), que se aplica DENTRO del service.
//
// ═══ LA GUARDA DE ROL ES DEFENSA EN PROFUNDIDAD, NO DECORACION (R33) ═══
// La pagina que monta el modulo ya hace `notFound()` para roles distintos de `mensajero`,
// pero una Server Action es un ENDPOINT: se puede invocar directamente con su id, sin pasar
// por la pagina. Sin esta guarda, cualquier sesion valida podria disparar una llamada
// facturada contra la ruta de otra persona.
import { buildOptimizacionRutaService } from "@/lib/services/jobs/optimizacion-ruta-handler";
import { RutaIntentoFallidoError } from "@/lib/services/OptimizacionRutaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOptimizacionRutaService } from "@/lib/interfaces/services/IOptimizacionRutaService";
import {
  sincronizarRutaSchema,
  type SincronizarRutaResult,
} from "@/lib/types/ruta-mensajero";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

/** Unico rol autorizado (R33). */
const ROL_AUTORIZADO = "mensajero";

export interface RutaMensajeroDeps {
  service?: IOptimizacionRutaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * Espejo de `toMisAsignacionesActionError`: este borde solo puede producir VALIDATION_ERROR
 * (ZodError) o UNAUTHORIZED (sin sesion). `forbidden` y `conflict` los decide esta action o
 * el service como resultado de DOMINIO, nunca como excepcion.
 */
function toRutaActionError(
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
      throw new Error(`ruta-mensajero: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildService(): IOptimizacionRutaService {
  // Se reusa la fabrica del handler de la cola: el MISMO service con las MISMAS guardas de
  // coste corre por el cron y por el boton. Duplicar la fabrica seria la via mas rapida a
  // que el boton acabe corriendo sin alguna guarda.
  return buildOptimizacionRutaService();
}

/**
 * R32: ejecuta la optimizacion de forma SINCRONA (sin esperar el debounce ni el cron).
 * R33: `forbidden` para cualquier rol distinto de `mensajero`, SIN efectos ni llamada.
 * R34: el intervalo minimo lo aplica el service; aqui se traduce a `conflict`.
 * R22: `ubicacion` opcional, validada en el borde en los rangos del sistema de coordenadas.
 */
export async function sincronizarRuta(
  input: unknown = {},
  deps: RutaMensajeroDeps = {},
): Promise<SincronizarRutaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    // R33: el rol se comprueba ANTES de parsear y ANTES de construir el service: un actor
    // no autorizado no llega ni a tocar la configuracion del proveedor.
    if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" as const };

    const data = sincronizarRutaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.service ?? buildService();

    let resultado;
    try {
      resultado = await service.ejecutar(actor.usuarioId, {
        motivo: "manual",
        ubicacion: data.ubicacion,
      });
    } catch (error) {
      // R27: el proveedor fallo. En la COLA eso debe propagarse (backoff), pero aqui hay
      // una persona esperando: se traduce a `conflict` accionable. La ruta ya quedo
      // marcada `desactualizada` por el service y el ULTIMO ORDEN VALIDO sigue intacto.
      // El mensaje es fijo: `error.message` viene saneado, pero no se reenvia al cliente.
      if (error instanceof RutaIntentoFallidoError) {
        return {
          status: "conflict" as const,
          motivo: "no se pudo recalcular la ruta ahora; se conserva el ultimo orden",
        };
      }
      throw error;
    }

    // R34: la guarda de intervalo minimo del service se traduce a `conflict` para que la
    // UI pueda decir "espera un momento" en vez de fingir que recalculo.
    if (resultado.status === "omitida" && resultado.razon === "intervalo_minimo") {
      return {
        status: "conflict" as const,
        motivo: "la ruta se sincronizo hace muy poco; intenta de nuevo en unos segundos",
      };
    }
    // El trazado (polilinea + distancia) sube al cliente para que el mapa lo pinte al
    // instante. No va atado a `status`: con UNA sola parada la optimizacion se OMITE (R35)
    // y aun asi hay linea que dibujar. Se reenvia siempre que el service lo produzca.
    return {
      status: "ok" as const,
      omitida: resultado.status === "omitida",
      ...(resultado.trazado !== undefined ? { trazado: resultado.trazado } : {}),
    };
  });
  return isAppErrorShape(r) ? toRutaActionError(r) : r;
}
