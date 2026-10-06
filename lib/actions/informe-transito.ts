"use server";

// Ficha 475 (design §8.3, R38/R39) — VISTA PREVIA del panel del informe de transito.
//
// Solo `maestro` (mismo criterio que la configuracion de envios, R1 de la 474), y SOLO LECTURA: el
// repositorio inyectado es el de lectura (`IInformeTransitoRepository` no tiene escrituras). Cuenta
// con LA MISMA seleccion que `generar` (`seleccionarTransito`): lo que el panel promete es lo que
// el informe manda. Con parametros invalidos devuelve los errores por campo y las zonas (para
// pintar la tabla), sin conteo. Se importa desde el panel (`ParamsTransito`).
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IInformeTransitoRepository } from "@/lib/interfaces/repositories/IInformeTransitoRepository";
import type { PrevisualizarTransitoResult } from "@/lib/whatsapp-envios/informes/transito/tipos";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { InformeTransitoRepository } from "@/lib/repositories/InformeTransitoRepository";
import {
  erroresDeParametrosTransito,
  parametrosTransitoSchema,
} from "@/lib/whatsapp-envios/informes/transito/parametros";
import { seleccionarTransito } from "@/lib/whatsapp-envios/informes/transito/informe";

/** Dependencias inyectables (tests). En produccion: sesion, repo real y reloj. */
export interface PrevisualizarTransitoDeps {
  getActor?: () => Promise<Actor | null>;
  repo?: IInformeTransitoRepository;
  now?: () => Date;
}

const ROLES_PERMITIDOS = new Set<string>(["maestro"]);

/**
 * R38/R39 — cuantos paquetes entrarian HOY con estos parametros, cuantos estan parados y cuantos
 * no tienen el momento de inicio.
 *
 * La importa el panel `ParamsTransito` (formulario de envios, 474).
 */
export async function previsualizarInformeTransito(
  parametros: unknown,
  deps: PrevisualizarTransitoDeps = {},
): Promise<PrevisualizarTransitoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  if (!ROLES_PERMITIDOS.has(actor.rol)) return { status: "forbidden" };

  const repo = deps.repo ?? new InformeTransitoRepository(getPrismaClient());
  const ahora = (deps.now ?? (() => new Date()))();
  const p = parametrosTransitoSchema.safeParse(parametros);
  if (!p.success) {
    return { status: "validation_error", fieldErrors: erroresDeParametrosTransito(p.error), zonas: await repo.zonas() };
  }
  const { zonas, modelo } = await seleccionarTransito(repo, p.data, ahora);
  return {
    status: "ok",
    zonas,
    totalEnAlerta: modelo.totales.enAlerta,
    parados: modelo.totales.parados,
    sinHito: modelo.sinHito,
  };
}
