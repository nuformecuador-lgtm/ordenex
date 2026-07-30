// Feature 92 (design §2.1, R11/R12) — PRIMER flujo OAuth2 SALIENTE del repo: intercambio
// JWT-bearer (RFC 7523) de la credencial de una service account de Google por un
// `access_token` de corta vida.
//
// POR QUE EXISTE ESTE ARCHIVO: Route Optimization (`routeoptimization.googleapis.com`) NO
// acepta API key. Exige `Authorization: Bearer <token>` obtenido de una service account.
// La `GOOGLE_MAPS_API_KEY` de la feature 91 no sirve (design §9.A, override consciente).
//
// TRES INVARIANTES DE ESTE ARCHIVO:
//
// 1. `fetch` y RELOJ INYECTABLES (patron `GoogleGeocodeClient`): los tests ejercitan la
//    firma, el cacheo y la renovacion sin tocar la red y sin una credencial real (se firma
//    con un par RSA generado en el propio test).
// 2. NADA de la credencial sale de aqui. Ni la clave PEM, ni el JWT firmado, ni el
//    `access_token`, ni el email de la service account aparecen en NINGUN mensaje de
//    error ni en NINGUN log (R14). Los mensajes citan la operacion y el estado HTTP.
// 3. Sin dependencia nueva: se firma con `node:crypto` (`createSign("RSA-SHA256")`). NO se
//    anade `google-auth-library` por un flujo de 40 lineas.
import { createSign } from "node:crypto";
import { z } from "zod";
// ⚠️ LAS CLASES DE ERROR VIVEN EN UN SOLO SITIO (`google-token-shared.ts`) Y SE RE-EXPORTAN.
// NO volver a declararlas aqui: `instanceof` compara IDENTIDAD DE CLASE, no nombre. Cuando
// existian dos `RutaNoConfiguradoError` (una aqui, otra en shared), el
// `error instanceof RutaNoConfiguradoError` de `FallbackRouteOptimizationClient` —que importa
// la de shared— daba false, el error escapaba y un despliegue SIN credencial se caia con
// INTERNAL en vez de caer al orden local (Haversine). El scope va por el mismo motivo.
import {
  RutaNoConfiguradoError,
  RutaTokenError,
  SCOPE_CLOUD_PLATFORM,
} from "@/lib/auth/google-token-shared";

export { RutaNoConfiguradoError, RutaTokenError, SCOPE_CLOUD_PLATFORM };

/** Endpoint de intercambio del JWT por el access token (RFC 7523 §2.1). */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** `grant_type` del perfil JWT-bearer. */
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** Vida del JWT de assertion, en segundos. Google admite hasta 3600. */
const ASSERTION_TTL_S = 3600;

/**
 * R11: margen de seguridad. Un token se considera agotado 60 s ANTES de su expiracion
 * real, para que una peticion en vuelo no se quede sin credencial a mitad de camino.
 */
export const RENOVAR_ANTES_S = 60;

// Contrato MINIMO de la respuesta del endpoint de token. Zod hace STRIP por defecto: los
// campos que Google manda y no estan declarados (`token_type`, `scope`) no sobreviven al
// parseo. NO anadir `.passthrough()`: mantiene la superficie de lo que circula al minimo.
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export interface ServiceAccountCredential {
  /** Email de la service account (claim `iss` y `sub`). */
  email: string;
  /** Clave privada PEM (PKCS#8 o PKCS#1), con saltos de linea REALES. */
  privateKey: string;
}

export interface GoogleServiceAccountTokenOpts {
  /** `fetch` inyectable: los tests no tocan la red (invariante 1). */
  fetchImpl?: typeof fetch;
  /** Reloj inyectable: los tests controlan la expiracion sin esperar (invariante 1). */
  now?: () => Date;
  /** Scope solicitado. Default `cloud-platform`. */
  scope?: string;
  /** Timeout de la llamada al endpoint de token, en ms. */
  timeoutMs?: number;
}

/** Base64URL sin padding, como exige JWS (RFC 7515 §2). */
function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * R11 — proveedor de `access_token` para las APIs de Google Cloud con credencial de
 * service account. El token se cachea EN LA INSTANCIA (no en un global del modulo): asi
 * dos tests no se contaminan entre si y el reset es "construye otro".
 */
export class GoogleServiceAccountToken {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly scope: string;
  private readonly timeoutMs: number;

  /** Token vigente cacheado. `expiraAt` YA lleva descontado `RENOVAR_ANTES_S`. */
  private cache: { token: string; expiraAt: number } | null = null;

  constructor(
    private readonly credencial: ServiceAccountCredential,
    opts: GoogleServiceAccountTokenOpts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.scope = opts.scope ?? SCOPE_CLOUD_PLATFORM;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * Devuelve un `access_token` valido. R11: si el token cacheado sigue a mas de
   * `RENOVAR_ANTES_S` de expirar, se REUTILIZA sin tocar la red (ni pagar latencia ni
   * cuota); si no, se firma una assertion nueva y se intercambia.
   */
  async obtener(): Promise<string> {
    const ahoraS = Math.floor(this.now().getTime() / 1000);
    if (this.cache !== null && ahoraS < this.cache.expiraAt) {
      return this.cache.token;
    }

    const assertion = this.firmarAssertion(ahoraS);

    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // R14: el detalle NO puede incluir el cuerpo (lleva la assertion firmada).
      throw new RutaTokenError("fallo de red o timeout");
    }

    if (!respuesta.ok) {
      // R14: SOLO el status. El cuerpo de un 400 de Google ecoa parte de la assertion.
      throw new RutaTokenError(`HTTP ${respuesta.status}`);
    }

    let json: unknown;
    try {
      json = await respuesta.json();
    } catch {
      throw new RutaTokenError("cuerpo no es JSON");
    }

    const parsed = tokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Se citan los CAMPOS que fallan, jamas sus valores (uno de ellos es el token).
      const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new RutaTokenError(`respuesta con forma inesperada: ${campos}`);
    }

    // R11: se descuenta el margen AL GUARDAR, para que la comparacion de arriba sea un
    // simple `<` y no haya dos sitios donde el margen pueda divergir.
    this.cache = {
      token: parsed.data.access_token,
      expiraAt: ahoraS + parsed.data.expires_in - RENOVAR_ANTES_S,
    };
    return this.cache.token;
  }

  /** Construye y firma el JWT de assertion (RS256) con la clave privada de la SA. */
  private firmarAssertion(ahoraS: number): string {
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({
        iss: this.credencial.email,
        sub: this.credencial.email,
        scope: this.scope,
        aud: TOKEN_ENDPOINT,
        iat: ahoraS,
        exp: ahoraS + ASSERTION_TTL_S,
      }),
    );
    const firmable = `${header}.${claims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(firmable);
    signer.end();
    // Si la PEM es invalida, `sign` lanza con un mensaje de OpenSSL que NO contiene la
    // clave; aun asi se envuelve para no propagar detalle de la libreria hacia arriba.
    let firma: string;
    try {
      firma = base64url(signer.sign(this.credencial.privateKey));
    } catch {
      throw new RutaTokenError("no se pudo firmar la assertion (clave privada invalida)");
    }
    return `${firmable}.${firma}`;
  }
}

/**
 * R12: valida las TRES piezas de la credencial y construye el proveedor de token. Lanza
 * `RutaNoConfiguradoError` ANTES de firmar nada y ANTES de cualquier llamada de red.
 * El `projectId` se valida aqui aunque no lo use el token: es la pieza que la URL de
 * `optimizeTours` necesita, y fallar entero y temprano es mas barato que fallar a mitad.
 */
export function construirTokenProvider(
  config: {
    GOOGLE_ROUTE_OPT_PROJECT_ID: string | null;
    GOOGLE_ROUTE_OPT_SA_EMAIL: string | null;
    GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: string | null;
  },
  opts: GoogleServiceAccountTokenOpts = {},
): GoogleServiceAccountToken {
  if (config.GOOGLE_ROUTE_OPT_PROJECT_ID === null) {
    throw new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_PROJECT_ID");
  }
  if (config.GOOGLE_ROUTE_OPT_SA_EMAIL === null) {
    throw new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_SA_EMAIL");
  }
  if (config.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY === null) {
    throw new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY");
  }
  return new GoogleServiceAccountToken(
    {
      email: config.GOOGLE_ROUTE_OPT_SA_EMAIL,
      privateKey: config.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY,
    },
    opts,
  );
}
