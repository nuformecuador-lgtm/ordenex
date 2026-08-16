"use server";

import { headers } from "next/headers";

import { loadRastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { IRastreoPublicoService } from "@/lib/interfaces/services/IRastreoPublicoService";
import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import {
  consultaRastreoSchema,
  type ResultadoRastreoPublico,
} from "@/lib/types/rastreo-publico";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";

// Feature 229 — Server Action PUBLICA del rastreo del envio (design §2.3).
//
// ⛔ NO RESUELVE ACTOR NI COMPRUEBA ROL, Y ES DELIBERADO (R13, decision humana del
// 2026-08-15): es publica, igual que `lib/actions/conteos-publicos.ts:12-15`. La ausencia
// de `resolveActorFromSession` NO es un olvido. Se postea a `/`, que el middleware deja
// pasar sin cookie por coincidencia EXACTA (`middleware.ts:62-65`) — por eso esta feature
// no toca el middleware ni crea ruta.
//
// La diferencia con la 198 justifica el resto: aquella NO acepta parametros para no ser un
// oraculo; esta acepta DOS (guia + segundo factor), luego necesita:
//
//   1. un segundo factor (los 4 ultimos digitos del telefono del destinatario, G1), y
//   2. un limite de intentos por IP, que es la defensa REAL contra el barrido: `num_guia`
//      es incremental y contiguo (`db/schema.prisma:483`), asi que sin limite un bucle de
//      enteros recorreria la base de envios entera.
//
// ⚠ RIESGO ACEPTADO Y FIRMADO (design §5.bis): `ResetRateLimiter` guarda la ventana EN
// MEMORIA DEL PROCESO. En serverless cada instancia tiene su contador y cada despliegue los
// resetea: acota al torpe, no al decidido. Un limite persistido es FICHA APARTE (exige
// migracion, que esta feature excluye). No es un bug pendiente.

/** Instancia a nivel de MODULO para que la ventana deslizante sobreviva entre invocaciones. */
const rastreoLimiter = new ResetRateLimiter();

/**
 * G4 — la clave es SOLO la IP, y no es un detalle de estilo: con `ip|guia` el atacante
 * estrenaria cubo en cada intento (cambia de guia cada vez) y el limite no frenaria nada.
 * La guia NO entra aqui jamas.
 */
function buildRateKey(ip: string): string {
  return `rastreo:${ip}`;
}

export interface RequestContext {
  ipAddress: string;
}

async function requestContextFromHeaders(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (requestHeaders.get("x-real-ip") ?? "unknown");
  return { ipAddress };
}

function buildService(): IRastreoPublicoService {
  return new RastreoPublicoService(new RastreoPublicoRepository(getPrismaClient()));
}

export interface RastreoPublicoDeps {
  service?: IRastreoPublicoService;
  getContext?: () => Promise<RequestContext>;
  limiter?: ResetRateLimiter;
}

/**
 * Consulta publica de un envio por guia + segundo factor. Sin sesion y sin actor (R2/R13).
 *
 * Orden de operaciones (R8 lo testea): zod -> IP -> limite -> registrar -> service. Ni la
 * validacion ni el limite tocan datos, y ninguna rama revela si la guia existia (R7/R9).
 * Nunca lanza: toda salida es un resultado discriminado (R32).
 *
 * Su superficie es `app/_landing/RastreoDialog.tsx` (T3.1), montado por la nav de la landing
 * (T3.3). La anotacion de excepcion que llevaba mientras el modal no existia se retiro al
 * montarlo: una excepcion que sobrevive a su motivo pone roja la guardia de superficie.
 */
export async function consultarRastreoPublico(
  entrada: unknown,
  deps: RastreoPublicoDeps = {},
): Promise<ResultadoRastreoPublico> {
  // 1. Borde: zod. R12 — los mensajes son literales fijos del schema, sin interpolar la
  //    guia ni el factor.
  const parsed = consultaRastreoSchema.safeParse(entrada);
  if (!parsed.success) {
    const campos: Record<string, string> = {};
    for (const [campo, errores] of Object.entries(parsed.error.flatten().fieldErrors)) {
      const primero = errores?.[0];
      if (primero !== undefined) campos[campo] = primero;
    }
    return { estado: "validation_error", campos };
  }

  // 2. IP (patron `postulacion-mensajero.ts:38-45`).
  const config = loadRastreoPublicoConfig();
  const limiter = deps.limiter ?? rastreoLimiter;
  const context = await (deps.getContext ?? requestContextFromHeaders)();
  const rateKey = buildRateKey(context.ipAddress);

  // 3. Limite de intentos: se rechaza SIN tocar datos, y el rechazo es el mismo con guias
  //    existentes y con inexistentes (R9).
  if (limiter.superaLimite(rateKey, config.RATE_MAX, config.RATE_WINDOW_MINUTES * 60_000)) {
    return { estado: "demasiados_intentos" };
  }

  // 4. El intento se registra SIEMPRE, acierte o no: contar solo los fallos dejaria barrer
  //    con aciertos y volveria el limite inutil contra quien ya tiene un factor valido.
  limiter.registrar(rateKey);

  // 5. Proyeccion. El service no corta antes de comparar el segundo factor (R8).
  const service = deps.service ?? buildService();
  return service.consultar(parsed.data.numGuia, parsed.data.factor);
}
