"use server";

// Ficha 470 (design §3.5, R5/R6/R11/R12/R13/R15) — la PREPARACION de una descarga de Familia A.
//
// Ejecuta la accion de descarga registrada (`REGISTRO_DESCARGAS`) con la MISMA entrada que manda el
// navegador y dentro de la misma peticion, con la misma sesion: los permisos, la validacion zod y el
// tope son exactamente los de hoy (R13). Despues decide el TRANSPORTE (`EntregaDescargaService`): el
// resultado en la respuesta si es pequeño, o un objeto temporal con URL firmada si es grande (R5/R6).
//
// No abre superficie nueva: las 33 acciones ya son Server Actions invocables desde el navegador, y esta
// solo puede invocar esas, con un solo argumento (nunca `deps`). La URL firmada solo viaja en la
// respuesta a quien hizo la peticion.
import { z } from "zod";
import { withErrorHandler, isAppErrorShape } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { ActionError } from "@/lib/types/orden";
import type { ResultadoPreparado } from "@/lib/types/descarga-preparada";
import type { IEntregaDescargaService } from "@/lib/interfaces/services/IEntregaDescargaService";
import { EntregaDescargaService } from "@/lib/services/EntregaDescargaService";
import { SupabaseAlmacenDescargas } from "@/lib/storage/SupabaseAlmacenDescargas";
import { loadDescargaConfig } from "@/lib/config/descarga";
import { toActionError } from "@/lib/actions/_shared/to-action-error";
import { NOMBRES_DESCARGA, REGISTRO_DESCARGAS } from "@/lib/actions/_shared/registro-descargas";

export interface PrepararDescargaDeps {
  entrega?: IEntregaDescargaService;
  registro?: Record<string, (input: unknown) => Promise<unknown>>;
}

/**
 * Lo que devuelve `prepararDescargaAction`:
 *  - el sobre (`{ modo: "directo", resultado }` | `{ modo: "almacen", url }`), o
 *  - `validation_error` si el nombre no esta en el registro (R12), o
 *  - `AppErrorShape` (`status: "error"`, mensaje generico) si fallo el almacen, la firma o la accion
 *    lanzo (R15). El error real queda registrado en el servidor; nada interno viaja al navegador.
 */
export type PrepararDescargaResult = ResultadoPreparado<unknown> | ActionError | AppErrorShape;

const nombreSchema = z.enum(NOMBRES_DESCARGA);

/** COMPOSITION ROOT: la config se resuelve en CADA llamada (umbral y TTL configurables por entorno). */
function buildEntrega(): IEntregaDescargaService {
  const cfg = loadDescargaConfig();
  return new EntregaDescargaService(new SupabaseAlmacenDescargas(undefined, cfg.BUCKET), cfg);
}

/**
 * @sin-superficie FICHA 470 (backend antes que pantalla): la cablea `components/shared/descarga-datos.ts` (`descargarDatos`) en el bloque 4 de la MISMA rama, que borra esta anotacion al hacerlo; el backend se entrega primero para que el frontend lo consuma.
 */
export async function prepararDescargaAction(
  nombre: unknown,
  input: unknown,
  deps: PrepararDescargaDeps = {},
): Promise<PrepararDescargaResult> {
  // R12: nombre fuera del registro ⇒ rechazo SIN ejecutar ninguna lectura ni tocar el almacen.
  const parsed = nombreSchema.safeParse(nombre);
  if (!parsed.success) return { status: "validation_error", fieldErrors: { nombre: ["Descarga desconocida"] } };
  const registro: Record<string, (input: unknown) => Promise<unknown>> = deps.registro ?? REGISTRO_DESCARGAS;
  const accion = registro[parsed.data];
  if (typeof accion !== "function") {
    return { status: "validation_error", fieldErrors: { nombre: ["Descarga desconocida"] } };
  }

  const r = await withErrorHandler(async () => {
    // R13: UN solo argumento, la entrada tal cual. La accion resuelve sesion, zod y permisos.
    const resultado = await accion(input);
    // R11: los resultados de error de la accion son pequeños y vuelven directos, sin almacen.
    return (deps.entrega ?? buildEntrega()).entregar(resultado);
  });
  if (!isAppErrorShape(r)) return r;
  // R15: el fallo del almacen (INTERNAL) vuelve como AppErrorShape generico, nunca como excepcion; el
  // resto de codigos conserva el contrato ActionError del repo.
  return r.code === "INTERNAL" ? r : toActionError(r);
}
