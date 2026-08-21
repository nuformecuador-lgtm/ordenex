"use server";

import { headers } from "next/headers";

import { loadPostulacionRecursoConfig } from "@/lib/config/postulacion-recurso";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { IPostulacionRecursoService } from "@/lib/interfaces/services/IPostulacionRecursoService";
import { notificarPostulacionRecursoPendienteReal } from "@/lib/notificaciones/notificadores";
import { PostulacionRecursoRepository } from "@/lib/repositories/PostulacionRecursoRepository";
import { PostulacionRecursoService } from "@/lib/services/PostulacionRecursoService";
import {
  postulacionRecursoSchema,
  type PostularRecursoResult,
} from "@/lib/types/postulacion-recurso";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";

// Feature 253 (T4.1, design §4) — Server Action PUBLICA de la postulacion de vehiculo o bodega.
//
// ⛔ NO RESUELVE ACTOR NI COMPRUEBA ROL, Y ES DELIBERADO: es publica, exactamente igual que
// `lib/actions/rastreo-publico.ts:18-22` y `lib/actions/postulacion-mensajero.ts:21-24`. La
// ausencia de `resolveActorFromSession` NO es un olvido y no hay que "arreglarla". Este modulo
// tampoco importa `cookies`: NO lee ni escribe cookies y NO concede sesion (R4).
//
// Se postea a `/`, que el middleware deja pasar sin cookie por coincidencia EXACTA
// (`middleware.ts:56-59`), igual que ya hace el rastreo publico desde la misma landing. **Esta
// feature NO toca `middleware.ts` y no crea ruta**, y eso importa: tocarlo obligaria al gate
// completo por otra via y a inventar una proteccion CSRF que la Server Action ya trae
// (design §14-E).
//
// ⚠ RIESGO ACEPTADO Y FIRMADO (design §12.1): `ResetRateLimiter` guarda la ventana EN MEMORIA DEL
// PROCESO. En serverless cada instancia tiene su contador y cada despliegue los reinicia: acota al
// torpe, no al decidido. Es el mismo riesgo que la 229 firmo y que la 21 lleva en produccion. Un
// limite persistido es FICHA APARTE (exige tabla o Redis). Aqui el dano de saltarselo son filas
// basura en una tabla, no una fuga: la escritura NO dispara ningun efecto externo (ni correo, ni
// webhook, ni cobro).

/** Instancia a nivel de MODULO para que la ventana deslizante sobreviva entre invocaciones (R16). */
const postulacionRecursoLimiter = new ResetRateLimiter();

/**
 * D4 FIRMADA — la clave es `ip|correo`, la de la feature 21, y NO la de la 229 (solo IP).
 *
 * La 229 excluye la guia porque el atacante la cambia en cada intento y estrenaria cubo cada vez;
 * aqui el correo NO es el objetivo del ataque, asi que incluirlo no abre esa puerta y si evita que
 * una IP compartida (una oficina, un cafe) bloquee a la segunda persona que quiere postular.
 */
function buildRateKey(ip: string, correo: string): string {
  return `postulacion-recurso:${ip}|${correo.toLowerCase()}`;
}

export interface RequestContext {
  ipAddress: string;
}

/** `x-forwarded-for` -> primer valor -> `x-real-ip` -> `"unknown"`. Copiado de las dos anteriores. */
async function requestContextFromHeaders(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (requestHeaders.get("x-real-ip") ?? "unknown");
  return { ipAddress };
}

/**
 * COMPOSITION ROOT. El notificador REAL de la campana (D6) se cablea AQUI —donde ya vive el acceso
 * a la base— y NO como default del service, para que un service construido sin cablear (los dobles
 * de test) no pueda escribir en `notificacion`. Mismo criterio que `postulacion-mensajero.ts:49-56`.
 */
function buildService(): IPostulacionRecursoService {
  return new PostulacionRecursoService(
    new PostulacionRecursoRepository(getPrismaClient()),
    notificarPostulacionRecursoPendienteReal,
  );
}

export interface PostularRecursoDeps {
  service?: IPostulacionRecursoService;
  getContext?: () => Promise<RequestContext>;
  limiter?: ResetRateLimiter;
}

/**
 * Registra una postulacion de vehiculo o bodega desde la landing publica. Sin sesion y sin actor
 * (R4).
 *
 * ORDEN DE OPERACIONES, y es parte del contrato (R18):
 *
 *   1. zod sobre la entrada CRUDA -> `validation_error` con `fieldErrors` (R14/R15). Nada tocado.
 *   2. IP desde cabeceras.
 *   3. limite -> `rate_limited` SIN escribir ninguna fila (R16).
 *   4. registrar el intento — SIEMPRE, acierte o no lo que venga despues (R18): contar solo los
 *      exitos dejaria vaciar el cubo provocando fallos.
 *   5. servicio -> `ok` | `error`.
 *
 * NUNCA LANZA: toda salida es un resultado discriminado, igual que `consultarRastreoPublico`. Un
 * `throw` que cruce la Server Action deja la pantalla muda —el defecto de la 248— y aqui, encima,
 * sobre alguien que no es empleado y no va a reportar nada.
 */
export async function postularRecurso(
  entrada: unknown,
  deps: PostularRecursoDeps = {},
): Promise<PostularRecursoResult> {
  // 1. Borde: zod. R14 — se revalida el objeto COMPLETO aunque el modal ya lo haya validado; la
  //    validacion del cliente no es una garantia, es una cortesia.
  const parsed = postulacionRecursoSchema.safeParse(entrada);
  if (!parsed.success) {
    return {
      status: "validation_error",
      // R15: por campo, para que la pantalla pueda senalar al culpable.
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // 2. IP.
  const config = loadPostulacionRecursoConfig();
  const limiter = deps.limiter ?? postulacionRecursoLimiter;
  const context = await (deps.getContext ?? requestContextFromHeaders)();
  const rateKey = buildRateKey(context.ipAddress, parsed.data.correo);

  // 3. R16: se rechaza SIN escribir ninguna fila. El servicio ni se construye.
  if (limiter.superaLimite(rateKey, config.RATE_MAX, config.RATE_WINDOW_MINUTES * 60_000)) {
    return { status: "rate_limited" };
  }

  // 4. R18: el intento se registra siempre que la validacion haya pasado.
  limiter.registrar(rateKey);

  // 5. El servicio no lanza: devuelve `ok` o `error` (R2).
  const service = deps.service ?? buildService();
  return service.registrar(parsed.data);
}
