"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { ConteosPublicosRepository } from "@/lib/repositories/ConteosPublicosRepository";
import { crearConteosPublicosCacheDeNext } from "@/lib/cache/next-conteos-publicos-cache";
import {
  CONTEOS_PUBLICOS_CACHE_KEY,
  CONTEOS_PUBLICOS_CACHE_TTL_SEGUNDOS,
} from "@/lib/config/conteos-publicos-cache";
import type { IConteosPublicosCache } from "@/lib/interfaces/external/IConteosPublicosCache";
import type { IConteosPublicosRepository } from "@/lib/interfaces/repositories/IConteosPublicosRepository";
import type { ConteosPublicos } from "@/lib/types/conteos-publicos";

// Feature 198 — los tres conteos publicos.
//
// ⛔ ESTA ACCION NO RESUELVE ACTOR NI COMPRUEBA ROL, Y ES DELIBERADO (decision humana del
// 2026-08-10): es publica. La ausencia de `resolveActorFromSession` NO es un olvido; si
// alguien la "arregla" añadiendolo, esta cambiando el contrato, no corrigiendo un bug.
//
// Lo que SI hace falta respetar, y es la contrapartida de esa decision:
//
//   1. NO ACEPTA PARAMETROS. Ninguno. En este repo Prisma va con SERVICE ROLE y la capa de
//      aplicacion es la unica separacion entre inquilinos —no hay una sola policy RLS en
//      db/migrations/—. Un filtro (zona, tienda, mensajero) en una lectura sin sesion
//      convertiria esto en un oraculo: cualquiera podria preguntar «cuantas ordenes sin
//      gestionar tiene la zona X» y reconstruir el negocio de un inquilino consulta a
//      consulta. La firma vacia es la defensa, y una guardia la atornilla.
//
//   2. Solo devuelve NUMEROS. Nunca ids, nombres ni listas: un conteo no identifica a nadie;
//      una lista, si.
//
//   3. La cache no es rendimiento, es CONTENCION. Al no haber sesion tampoco hay a quien
//      limitar por rate limit, asi que sin cache esta accion seria un amplificador de carga
//      gratuito contra la base: tres consultas historicas sin ventana temporal por visita.
//      Con 6 h de TTL, el trafico contra Postgres queda acotado pase lo que pase.
//
// No hay capa de servicio entre la accion y el repositorio, y tampoco es un descuido: no hay
// NINGUNA regla de negocio que sostener —ni alcance por rol, ni derivacion, ni validacion—.
// Un servicio aqui seria un archivo que solo reenvia. La decision de que se cuenta vive en el
// repositorio, que es donde esta la consulta.

export interface ConteosPublicosDeps {
  repo?: IConteosPublicosRepository;
  cache?: IConteosPublicosCache;
}

/**
 * Los tres conteos globales. Sin argumentos (ver arriba); `deps` existe solo para los tests.
 *
 * Se declara con `deps` OPCIONAL y no como segundo parametro de datos: la guardia comprueba
 * que la accion no toma entrada de dominio, y una inyeccion de dobles no es entrada de
 * dominio.
 */
export async function obtenerConteosPublicos(
  deps: ConteosPublicosDeps = {},
): Promise<ConteosPublicos> {
  const repo = deps.repo ?? new ConteosPublicosRepository(getPrismaClient());
  const cache = deps.cache ?? crearConteosPublicosCacheDeNext();

  return cache.envolver(CONTEOS_PUBLICOS_CACHE_KEY, () => repo.contar());
}

/** Re-export para que un consumidor pueda anunciar la frescura del dato sin adivinar el TTL. */
export { CONTEOS_PUBLICOS_CACHE_TTL_SEGUNDOS };
