"use server";

// FICHA 362 (design §4.1) — las TRES Server Actions del historial de acciones.
//
// POR QUE SERVER ACTIONS Y NO ROUTE HANDLERS (`docs/architecture.md`, tabla «Server Actions vs
// Route Handlers»): son lecturas internas que consume un componente propio de la app. No hay CORS,
// ni cliente externo, ni contrato publico que mantener.
//
// SOLO LECTURA (R21). Ninguna de las tres escribe, ni revalida cache, ni marca nada. La garantia
// no es de disciplina: el servicio recibe un repositorio que no declara un solo metodo de
// escritura, y ese repositorio recibe un cliente Prisma recortado a dos delegados de lectura.
//
// LO QUE ESTE BORDE GARANTIZA, en este orden y no en otro:
//   1. sin sesion -> `unauthenticated`, y el service NO se construye ni se llama;
//   2. la AUTORIZACION POR ROL no esta aqui: vive en `HistorialAccionService`, que compara contra
//      `ROLES_HISTORIAL_ACCIONES`. Este archivo resuelve el actor y lo pasa;
//   3. la validacion de la entrada tampoco esta aqui: el servicio la hace con
//      `filtroHistorialAccionSchema` DESPUES del gate, para que un `validation_error` no sea un
//      oraculo para quien no puede leer el modulo.
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHistorialAccionService } from "@/lib/interfaces/services/IHistorialAccionService";
import { HistorialAccionRepository } from "@/lib/repositories/HistorialAccionRepository";
import { HistorialAccionService } from "@/lib/services/HistorialAccionService";
import type {
  CatalogoActoresHistorialResult,
  ListarHistorialAccionesCompletoResult,
  ListarHistorialAccionesResult,
} from "@/lib/types/historial-accion";

/**
 * Dobles inyectables. Viajan por el SEGUNDO parametro, que el cliente nunca manda: desde el
 * navegador solo cruza el primero, asi que un `deps` no puede llegar de fuera.
 */
export interface HistorialAccionesActionDeps {
  historialService?: IHistorialAccionService;
  getActor?: () => Promise<Actor | null>;
}

function construirService(): IHistorialAccionService {
  return new HistorialAccionService(new HistorialAccionRepository(getPrismaClient()));
}

/**
 * R22/R23/R26 — una pagina del registro, resuelta ENTERA en el servidor.
 *
 * @sin-superficie el backend de la ficha 362 va por delante del frontend: la pantalla
 * `app/(app)/historico/acciones/page.tsx` es la tanda T5 y la construye el agente de frontend con
 * este contrato. NO es deuda ni una accion huerfana; la anotacion se BORRA en esa tanda, cuando el
 * modulo la importe. Mismo caso, y misma anotacion temporal, que llevaron `conteo-productos` y
 * `corregir-dia-reparto` mientras su pantalla se escribia.
 */
export async function listarHistorialAccionesPaginado(
  input: unknown,
  deps: HistorialAccionesActionDeps = {},
): Promise<ListarHistorialAccionesResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const service = deps.historialService ?? construirService();
  return service.listar(input, actor);
}

/**
 * R30/R33 — el conjunto ENTERO de la descarga, con el MISMO filtro, el MISMO orden y el MISMO gate
 * por rol que la pantalla.
 *
 * @sin-superficie idem: la descarga la cablea la tanda T6 del frontend.
 */
export async function listarHistorialAccionesCompleto(
  input: unknown,
  deps: HistorialAccionesActionDeps = {},
): Promise<ListarHistorialAccionesCompletoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const service = deps.historialService ?? construirService();
  return service.listarCompleto(input, actor);
}

/**
 * R29 — los actores que han actuado alguna vez, para el selector de filtros. Mismo gate.
 *
 * @sin-superficie idem: la barra de filtros la monta la tanda T5.3 del frontend.
 */
export async function obtenerCatalogoActoresHistorial(
  deps: HistorialAccionesActionDeps = {},
): Promise<CatalogoActoresHistorialResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const service = deps.historialService ?? construirService();
  return service.obtenerCatalogoActores(actor);
}
