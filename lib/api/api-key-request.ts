// Feature 106 — helpers compartidos por los endpoints del canal integrador (API por key).
// Extraidos para que los tres route handlers (listado/detalle/cancelar) no dupliquen la
// extraccion del Bearer ni el armado del autenticador. Mismo comportamiento que
// `app/api/ordenes/api-key/carga/route.ts` (feature 88).
import type {
  ApiKeyAuthResult,
  IApiKeyAuthService,
} from "@/lib/interfaces/services/IApiKeyAuthService";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";

/**
 * R1: extrae el secreto del header `Authorization: Bearer <key>`. `null` si el header esta
 * ausente o no usa el esquema `Bearer` o el token esta vacio (-> el autenticador lo trata como
 * sin key, R2). La key NUNCA se loguea (R5).
 */
export function extraerBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() === "" ? null : token;
}

/** Factory del autenticador por key real (prod). En tests se inyecta un fake por `deps`. */
export function buildAutenticar(): (rawKey: string | null) => Promise<ApiKeyAuthResult> {
  const prisma = getPrismaClient();
  const auth: IApiKeyAuthService = new ApiKeyAuthService(new ApiKeyRepository(prisma));
  return (rawKey) => auth.autenticar(rawKey);
}
