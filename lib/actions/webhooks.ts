"use server";

// Feature 99 (design §9, D1) — CONTROLLER de registro de la suscripcion de webhook: una
// Server Action (mutacion interna, no CORS ni API publica => Server Action, no route handler;
// docs/architecture.md), autorizada al rol `maestro` (patron feature 82). NO es un endpoint
// por API key: el maestro controla que integradores tienen webhook desde `Configuracion > API`.
// La pantalla es la feature hermana F100 (D4), que CONSUME estas acciones.
//
// PRIVACIDAD (R29): aqui no se loguea el secreto ni la URL; el secreto en claro solo se
// devuelve UNA vez en el resultado `ok` (R7) para que F100 lo muestre y no vuelve a salir.
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";
import type { IWebhookSuscripcionService } from "@/lib/interfaces/services/IWebhookSuscripcionService";
import { WebhookSuscripcionService } from "@/lib/services/WebhookSuscripcionService";
import { WebhookSuscripcionRepository } from "@/lib/repositories/WebhookSuscripcionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadWebhookConfig } from "@/lib/config/webhook";
import { cifrarSecreto, WebhookSecretKeyError } from "@/lib/crypto/webhook-secret-cipher";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  registrarWebhookSchema,
  desactivarWebhookSchema,
  type DesactivarWebhookActionResult,
  type RegistrarWebhookActionResult,
} from "@/lib/types/webhook";

/** Solo `maestro` opera las suscripciones (patron `ApiKeyService.ALLOWED_ROLES`). */
const ROL_MAESTRO = "maestro";

export interface WebhookActionDeps {
  getActor?: () => Promise<Actor | null>;
  service?: IWebhookSuscripcionService;
  /** D3: comprueba que el owner objetivo es un usuario de rol `apiKey`. */
  ownerEsApiKey?: (ownerUsuarioId: string) => Promise<boolean>;
}

function buildRepo() {
  return new WebhookSuscripcionRepository(getPrismaClient());
}

/**
 * Service real: cifra con `WEBHOOK_SECRET_ENC_KEY`. Si la clave falta, `cifrarSecreto` lanza
 * `WebhookSecretKeyError` al registrar; la accion lo traduce a `config_error` (R32).
 */
function buildService(): IWebhookSuscripcionService {
  const config = loadWebhookConfig();
  return new WebhookSuscripcionService(buildRepo(), (secretoPlano) =>
    cifrarSecreto(config.WEBHOOK_SECRET_ENC_KEY, secretoPlano),
  );
}

/**
 * R5/R6/R7/R9 (D1): registra (o re-registra) la suscripcion de un owner de API key. Autoriza
 * a `maestro`, valida que el owner es rol `apiKey` (D3) y devuelve el secreto en claro UNA vez.
 */
export async function registrarWebhook(
  input: unknown,
  deps: WebhookActionDeps = {},
): Promise<RegistrarWebhookActionResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  if (actor.rol !== ROL_MAESTRO) return { status: "forbidden" };

  const parsed = registrarWebhookSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      status: "validation_error",
      fieldErrors: { url: fieldErrors.url, ownerUsuarioId: fieldErrors.ownerUsuarioId },
    };
  }

  // D3: el owner objetivo debe ser un usuario de rol `apiKey`.
  const ownerEsApiKey = deps.ownerEsApiKey ?? ((id: string) => buildRepo().ownerEsApiKey(id));
  if (!(await ownerEsApiKey(parsed.data.ownerUsuarioId))) {
    return { status: "owner_invalido" };
  }

  const service = deps.service ?? buildService();
  try {
    return await service.registrar(parsed.data);
  } catch (error) {
    // R32: sin clave de cifrado no se puede persistir el secreto cifrado.
    if (error instanceof WebhookSecretKeyError) return { status: "config_error" };
    throw error;
  }
}

/**
 * R8/R9 (D1): da de baja la suscripcion de un owner. Autoriza a `maestro`. Idempotente
 * (no-op si no habia suscripcion).
 */
export async function desactivarWebhook(
  input: unknown,
  deps: WebhookActionDeps = {},
): Promise<DesactivarWebhookActionResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  if (actor.rol !== ROL_MAESTRO) return { status: "forbidden" };

  const parsed = desactivarWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: { ownerUsuarioId: parsed.error.flatten().fieldErrors.ownerUsuarioId },
    };
  }

  const service = deps.service ?? buildService();
  await service.desactivar(parsed.data.ownerUsuarioId);
  return { status: "ok" };
}
