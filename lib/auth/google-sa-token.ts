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
//
// ADEMAS este archivo hospeda el SELECTOR de los tres modos de autenticacion
// (`construirTokenProvider`, al final): ADC en local, WIF keyless en produccion y este
// JWT-bearer como fallback. Vive aqui —y no en un archivo aparte— porque es donde los
// llamadores ya lo importaban y donde `credenciales-google.md` dice que esta.
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
  type TokenProvider,
} from "@/lib/auth/google-token-shared";
import {
  construirTokenProviderWif,
  type WifTokenProviderOpts,
} from "@/lib/auth/google-wif-token";
import {
  construirTokenProviderAdc,
  type AdcTokenProviderOpts,
} from "@/lib/auth/google-adc-token";
import { optlog, opterror, describirToken, cronometro } from "@/lib/logging/optimizer-log";

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
      optlog("auth/jwt — token servido de cache", {
        segundosParaRenovar: this.cache.expiraAt - ahoraS,
      });
      return this.cache.token;
    }

    optlog("auth/jwt — firmando assertion e intercambiandola por access_token");
    const assertion = this.firmarAssertion(ahoraS);

    const medir = cronometro();
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      opterror("auth/jwt — fallo de red o timeout pidiendo el token", error, {
        ms: medir(),
      });
      // R14: el detalle NO puede incluir el cuerpo (lleva la assertion firmada).
      throw new RutaTokenError("fallo de red o timeout");
    }

    optlog("auth/jwt — respuesta del endpoint de token", {
      status: respuesta.status,
      ms: medir(),
    });

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
      optlog("auth/jwt — respuesta con forma inesperada", { campos });
      throw new RutaTokenError(`respuesta con forma inesperada: ${campos}`);
    }

    optlog("auth/jwt — access_token obtenido", {
      ...describirToken(parsed.data.access_token),
      expiraEnS: parsed.data.expires_in,
    });

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
 * R12: valida las TRES piezas de la credencial JWT-bearer y construye el proveedor. Lanza
 * `RutaNoConfiguradoError` ANTES de firmar nada y ANTES de cualquier llamada de red.
 * El `projectId` se valida aqui aunque no lo use el token: es la pieza que la URL de
 * `optimizeTours` necesita, y fallar entero y temprano es mas barato que fallar a mitad.
 *
 * Este es el modo FALLBACK. El punto de entrada normal es `construirTokenProvider`, que
 * elige entre los tres modos.
 */
export function construirTokenProviderJwt(
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

/**
 * Config que consume el SELECTOR. Las piezas de WIF y el flag de ADC son OPCIONALES a
 * proposito: un llamador que solo conozca la credencial JWT-bearer (los tests del modo
 * fallback, por ejemplo) sigue compilando y sigue cayendo al modo fallback.
 */
export interface TokenProviderConfig {
  GOOGLE_ROUTE_OPT_PROJECT_ID: string | null;
  GOOGLE_ROUTE_OPT_SA_EMAIL: string | null;
  GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: string | null;
  GOOGLE_WIF_PROJECT_NUMBER?: string | null;
  GOOGLE_WIF_POOL_ID?: string | null;
  GOOGLE_WIF_PROVIDER_ID?: string | null;
  GOOGLE_ROUTE_OPT_USE_ADC?: boolean;
}

/**
 * Opts del selector. Las del modo JWT-bearer van PLANAS (compatibilidad: los llamadores que
 * ya existian pasaban `{ fetchImpl, now }` directamente); las de los otros dos modos van
 * anidadas, porque sus fabricas inyectables no tienen nada que ver entre si.
 */
export type TokenProviderOpts = GoogleServiceAccountTokenOpts & {
  wif?: WifTokenProviderOpts;
  adc?: AdcTokenProviderOpts;
};

/** Las tres piezas que activan el modo WIF. Si falta UNA, el modo no se considera presente. */
const PIEZAS_WIF = [
  "GOOGLE_WIF_PROJECT_NUMBER",
  "GOOGLE_WIF_POOL_ID",
  "GOOGLE_WIF_PROVIDER_ID",
] as const;

/**
 * SELECTOR de modo de autenticacion (R11/R12). Precedencia, documentada en
 * `specs/92-optimizacion-ruta-mensajero/credenciales-google.md`:
 *
 *   1. `GOOGLE_ROUTE_OPT_USE_ADC=true` -> ADC (SOLO desarrollo local).
 *   2. Las tres piezas `GOOGLE_WIF_*` presentes -> WIF keyless (produccion, recomendado).
 *   3. Si no -> JWT-bearer con clave privada de larga vida (fallback).
 *
 * POR QUE ESTE ORDEN: el flag de ADC es EXPLICITO (alguien lo escribio a mano en un
 * `.env.local`), mientras que las piezas WIF pueden quedar heredadas en el entorno; lo
 * explicito gana. Y WIF va antes que JWT porque si el humano se molesto en configurar el
 * pool federado, tener ademas una clave privada colgada no debe silenciarlo.
 *
 * INVARIANTE COMPARTIDA: `GOOGLE_ROUTE_OPT_PROJECT_ID` se exige en los TRES modos —lo
 * consume la URL de `optimizeTours`, no el token— y se valida ANTES de elegir, para que el
 * mensaje de error no dependa del modo. Como todas las validaciones, lanza
 * `RutaNoConfiguradoError` SIN tocar la red, y el llamador (`getToken`, perezoso) lo traduce
 * en una caida al orden local (Haversine) en vez de en un job muerto.
 */
export function construirTokenProvider(
  config: TokenProviderConfig,
  opts: TokenProviderOpts = {},
): TokenProvider {
  // Se traza QUE piezas hay, en booleanos: presencia si, valores no. Es justo lo que hace
  // falta para entender por que se eligio un modo y no otro.
  optlog("auth/selector — evaluando modo", {
    projectId: config.GOOGLE_ROUTE_OPT_PROJECT_ID ?? "AUSENTE",
    useAdc: config.GOOGLE_ROUTE_OPT_USE_ADC === true,
    hayWifProjectNumber: (config.GOOGLE_WIF_PROJECT_NUMBER ?? null) !== null,
    hayWifPoolId: (config.GOOGLE_WIF_POOL_ID ?? null) !== null,
    hayWifProviderId: (config.GOOGLE_WIF_PROVIDER_ID ?? null) !== null,
    haySaEmail: config.GOOGLE_ROUTE_OPT_SA_EMAIL !== null,
    hayPrivateKey: config.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY !== null,
  });

  if (config.GOOGLE_ROUTE_OPT_PROJECT_ID === null) {
    optlog("auth/selector — SIN project id; se aborta antes de elegir modo");
    throw new RutaNoConfiguradoError("GOOGLE_ROUTE_OPT_PROJECT_ID");
  }

  if (config.GOOGLE_ROUTE_OPT_USE_ADC === true) {
    optlog("auth/selector — modo elegido: ADC (solo desarrollo local)", {
      impersonaSa: false,
    });
    return construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: config.GOOGLE_ROUTE_OPT_SA_EMAIL },
      opts.adc,
    );
  }

  const hayWif = PIEZAS_WIF.every(
    (pieza) => config[pieza] !== undefined && config[pieza] !== null,
  );
  if (hayWif) {
    optlog("auth/selector — modo elegido: WIF keyless", {
      poolId: config.GOOGLE_WIF_POOL_ID,
      providerId: config.GOOGLE_WIF_PROVIDER_ID,
      projectNumber: config.GOOGLE_WIF_PROJECT_NUMBER,
    });
    return construirTokenProviderWif(
      {
        GOOGLE_WIF_PROJECT_NUMBER: config.GOOGLE_WIF_PROJECT_NUMBER ?? null,
        GOOGLE_WIF_POOL_ID: config.GOOGLE_WIF_POOL_ID ?? null,
        GOOGLE_WIF_PROVIDER_ID: config.GOOGLE_WIF_PROVIDER_ID ?? null,
        GOOGLE_ROUTE_OPT_SA_EMAIL: config.GOOGLE_ROUTE_OPT_SA_EMAIL,
      },
      opts.wif,
    );
  }

  optlog("auth/selector — modo elegido: JWT-bearer (fallback, clave de larga vida)");
  return construirTokenProviderJwt(config, opts);
}
