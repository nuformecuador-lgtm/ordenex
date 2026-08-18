// Feature 92 (design §2.1, R11/R12/R14) — proveedor de token KEYLESS por Workload Identity
// Federation (WIF). Alternativa RECOMENDADA por Google al JWT-bearer con clave privada de
// larga vida (`google-sa-token.ts`): NO se almacena ninguna private key.
//
// FLUJO: Vercel emite un token OIDC por invocacion (`getVercelOidcToken()`); GCP lo canjea
// en su STS por un token federado y luego IMPERSONA la service account destino via IAM
// Credentials para emitir el `access_token` final. Ni una sola clave privada viaja.
//
// INVARIANTES DE ESTE ARCHIVO (mismos que `google-sa-token.ts`):
//
// 1. NADA de la credencial sale de aqui. Ni el token OIDC de Vercel, ni el token federado,
//    ni el `access_token`, ni el email de la service account aparecen en NINGUN mensaje de
//    error ni en NINGUN log (R14). Los errores citan solo la operacion.
// 2. `google-auth-library` YA cachea y renueva el `access_token` internamente, asi que aqui
//    NO se reimplementa el cacheo con margen: cada `obtener()` delega en `getAccessToken()`.
// 3. TESTEABLE SIN RED: el `subjectTokenSupplier` y la fabrica del cliente de auth son
//    inyectables por `opts`, de modo que los tests no tocan STS ni IAM Credentials ni Vercel.
import { ExternalAccountClient } from "google-auth-library";
import type { SubjectTokenSupplier } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  RutaNoConfiguradoError,
  RutaTokenError,
  SCOPE_CLOUD_PLATFORM,
  type TokenProvider,
} from "@/lib/auth/google-token-shared";
import { optlog, opterror, describirToken, cronometro } from "@/lib/logging/optimizer-log";

/** `token_url` del Security Token Service de Google (canje OIDC -> token federado). */
const STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";

/** Tipo de token de sujeto: el OIDC de Vercel es un JWT. */
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";

/** Cliente de auth minimo que este modulo consume. `ExternalAccountClient` lo cumple. */
interface AuthClientLike {
  getAccessToken(): Promise<{ token?: string | null }>;
}

/** Config WIF que necesita el proveedor. Reusa `GOOGLE_ROUTE_OPT_SA_EMAIL` como SA destino. */
export interface WifTokenConfig {
  GOOGLE_WIF_PROJECT_NUMBER: string | null;
  GOOGLE_WIF_POOL_ID: string | null;
  GOOGLE_WIF_PROVIDER_ID: string | null;
  GOOGLE_ROUTE_OPT_SA_EMAIL: string | null;
}

export interface WifTokenProviderOpts {
  /**
   * Proveedor del token de sujeto (OIDC). Default: el helper de Vercel. Inyectable para
   * que los tests no dependan de `VERCEL_OIDC_TOKEN` ni del runtime de Vercel.
   */
  subjectTokenSupplier?: SubjectTokenSupplier;
  /**
   * Fabrica del cliente de auth. Default: `ExternalAccountClient.fromJSON`. Inyectable para
   * que los tests corran SIN red (STS/IAM) devolviendo un doble con `getAccessToken`.
   */
  crearAuthClient?: (options: Record<string, unknown>) => AuthClientLike | null;
  /** Scope solicitado. Default `cloud-platform`. */
  scope?: string;
}

/** Piezas WIF requeridas, en orden de validacion. */
const PIEZAS_WIF = [
  "GOOGLE_WIF_PROJECT_NUMBER",
  "GOOGLE_WIF_POOL_ID",
  "GOOGLE_WIF_PROVIDER_ID",
  "GOOGLE_ROUTE_OPT_SA_EMAIL",
] as const;

/**
 * Proveedor de `access_token` por WIF con impersonacion de service account. Cumple el mismo
 * contrato `{ obtener() }` que `GoogleServiceAccountToken`, asi que el handler no distingue.
 */
class GoogleWifToken implements TokenProvider {
  constructor(private readonly authClient: AuthClientLike) {}

  async obtener(): Promise<string> {
    // El intercambio completo (OIDC de Vercel -> STS -> impersonacion) ocurre dentro de
    // `getAccessToken`, asi que solo se puede cronometrar de fuera: si estos ms se disparan,
    // el sospechoso es la latencia a STS/IAM, no el codigo de aqui.
    optlog("auth/wif — pidiendo access_token (OIDC -> STS -> impersonacion)");
    const medir = cronometro();
    let respuesta: { token?: string | null };
    try {
      respuesta = await this.authClient.getAccessToken();
    } catch (error) {
      opterror("auth/wif — fallo el intercambio", error, { ms: medir() });
      // R14: el error de google-auth-library puede citar el endpoint/status; nunca el token
      // OIDC, el federado ni el email de la SA. Se colapsa a un mensaje generico.
      throw new RutaTokenError("fallo en el intercambio WIF (STS/impersonacion)");
    }
    if (respuesta.token === undefined || respuesta.token === null || respuesta.token === "") {
      optlog("auth/wif — el intercambio termino SIN token", { ms: medir() });
      throw new RutaTokenError("el intercambio WIF no devolvio access_token");
    }
    optlog("auth/wif — access_token obtenido", {
      ...describirToken(respuesta.token),
      ms: medir(),
    });
    return respuesta.token;
  }
}

/**
 * R12: valida las piezas WIF y construye el proveedor. Lanza `RutaNoConfiguradoError` ANTES
 * de cualquier llamada de red, igual que el proveedor JWT-bearer. La SA a impersonar es la
 * misma `GOOGLE_ROUTE_OPT_SA_EMAIL` del otro modo.
 */
export function construirTokenProviderWif(
  config: WifTokenConfig,
  opts: WifTokenProviderOpts = {},
): TokenProvider {
  for (const pieza of PIEZAS_WIF) {
    if (config[pieza] === null) {
      optlog("auth/wif — pieza ausente; no se construye el cliente", { pieza });
      throw new RutaNoConfiguradoError(pieza);
    }
  }

  const audience =
    `//iam.googleapis.com/projects/${config.GOOGLE_WIF_PROJECT_NUMBER}` +
    `/locations/global/workloadIdentityPools/${config.GOOGLE_WIF_POOL_ID}` +
    `/providers/${config.GOOGLE_WIF_PROVIDER_ID}`;

  const subjectTokenSupplier: SubjectTokenSupplier =
    opts.subjectTokenSupplier ?? { getSubjectToken: () => getVercelOidcToken() };

  const crearAuthClient =
    opts.crearAuthClient ??
    ((options: Record<string, unknown>) => ExternalAccountClient.fromJSON(options as never));

  const authClient = crearAuthClient({
    type: "external_account",
    audience,
    subject_token_type: SUBJECT_TOKEN_TYPE,
    token_url: STS_TOKEN_URL,
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
      `${config.GOOGLE_ROUTE_OPT_SA_EMAIL}:generateAccessToken`,
    subject_token_supplier: subjectTokenSupplier,
    scopes: [opts.scope ?? SCOPE_CLOUD_PLATFORM],
  });

  if (authClient === null) {
    optlog("auth/wif — fromJSON devolvio null; opciones no validas para external_account");
    // fromJSON devuelve null si las opciones no describen una external_account valida.
    // R14: no se cita ninguna opcion (una de ellas es el email de la SA).
    throw new RutaTokenError("no se pudo inicializar el cliente WIF");
  }

  // La audience es publica (identifica el pool, no autentica). Verla en el log es lo que
  // permite cotejarla contra la consola de GCP cuando STS responde 403.
  optlog("auth/wif — cliente listo", {
    audience,
    saImpersonada: config.GOOGLE_ROUTE_OPT_SA_EMAIL,
  });
  return new GoogleWifToken(authClient);
}
