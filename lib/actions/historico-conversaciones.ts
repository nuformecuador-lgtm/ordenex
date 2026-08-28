"use server";

// Feature 318 (T3.7, design §2.1) — las DOS Server Actions del HISTORICO de conversaciones.
//
// POR QUE SERVER ACTIONS Y NO ROUTE HANDLERS (`docs/architecture.md`, tabla «Server Actions vs
// Route Handlers»): son lecturas internas que consume un componente propio de la app. No hay
// CORS, ni cliente externo, ni contrato publico que mantener. El UNICO Route Handler que esta
// feature toca de refilon es el proxy de media, que ya existe y entrega un binario con
// cabeceras — y ese es el bloque 4, no este archivo.
//
// LO QUE ESTE BORDE GARANTIZA, en este orden y no en otro:
//
//   1. sin sesion -> `unauthenticated`, y el service NO se construye ni se llama;
//   2. entrada que no valida contra su esquema `.strict()` -> `validation_error` SIN ejecutar
//      consulta alguna (R38). Se valida AQUI, antes de que nadie toque la base, porque lo que
//      llega del cliente es `unknown`: un cursor mal formado, una fecha que no es `YYYY-MM-DD`,
//      una lista vacia o un tamaño de pagina fuera de rango son entradas, no incidentes;
//   3. la AUTORIZACION POR ROL no esta aqui: vive en el service (design §2.5). Este archivo
//      resuelve el actor y lo pasa; quien decide es `HistoricoConversacionesService`.
//
// SOLO LECTURA (R25): ninguna de las dos acciones escribe, ni revalida cache, ni marca nada como
// leido. El repositorio que acaban usando recibe un cliente Prisma acotado por tipo a
// `$queryRaw`, asi que la garantia es estructural y no una promesa de este comentario.
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHistoricoConversacionesService } from "@/lib/interfaces/services/IHistoricoConversacionesService";
import { HistoricoConversacionesRepository } from "@/lib/repositories/HistoricoConversacionesRepository";
import { HistoricoConversacionesService } from "@/lib/services/HistoricoConversacionesService";
import {
  listarHilosHistoricoSchema,
  listarMensajesHistoricoSchema,
  type ListarHilosHistoricoResult,
  type ListarMensajesHistoricoResult,
} from "@/lib/types/historico-conversaciones";

/**
 * Dobles inyectables. Viajan por el SEGUNDO parametro, que el cliente nunca manda: desde el
 * navegador solo cruza el primero, asi que un `deps` no puede llegar de fuera.
 */
export interface HistoricoConversacionesActionDeps {
  historicoService?: IHistoricoConversacionesService;
  getActor?: () => Promise<Actor | null>;
}

function construirService(): IHistoricoConversacionesService {
  return new HistoricoConversacionesService(
    new HistoricoConversacionesRepository(getPrismaClient()),
  );
}

/** El primer problema del borde, en texto corto y sin ecoar el valor recibido. */
function motivoDe(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const primero = error.issues[0];
  if (primero === undefined) return "Entrada invalida";
  const ruta = primero.path.map(String).join(".");
  return ruta === "" ? primero.message : `${ruta}: ${primero.message}`;
}

/**
 * R10-R15, R33-R36, R41 — una pagina de hilos de TODOS los mensajeros. La respuesta no lleva ni
 * un mensaje: los mensajes se piden con `listarMensajesHistorico`, solo al abrir un hilo.
 */
export async function listarHilosHistorico(
  input: unknown,
  deps: HistoricoConversacionesActionDeps = {},
): Promise<ListarHilosHistoricoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  // `input ?? {}`: «sin filtros, primera pagina, tamaño por defecto» es una entrada VALIDA y se
  // expresa no mandando nada. `undefined` no es lo mismo que una entrada mal formada.
  const parsed = listarHilosHistoricoSchema.safeParse(input ?? {});
  if (!parsed.success) return { status: "validation_error", motivo: motivoDe(parsed.error) };

  const service = deps.historicoService ?? construirService();
  return service.listarHilos(parsed.data, actor);
}

/**
 * R16-R21, R28, R40, R42 — la pagina de mensajes del hilo `(orden, mensajero)` y su cabecera.
 *
 * NO acepta filtro de fecha, y el `.strict()` del esquema lo convierte en un rechazo explicito:
 * el hilo abierto se lee COMPLETO aunque el listado estuviera filtrado por un solo dia (R17).
 */
export async function listarMensajesHistorico(
  input: unknown,
  deps: HistoricoConversacionesActionDeps = {},
): Promise<ListarMensajesHistoricoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsed = listarMensajesHistoricoSchema.safeParse(input);
  if (!parsed.success) return { status: "validation_error", motivo: motivoDe(parsed.error) };

  const service = deps.historicoService ?? construirService();
  return service.listarMensajes(parsed.data, actor);
}
