// Feature 92 — TERCER modo de autenticacion: Application Default Credentials (ADC).
//
// POR QUE EXISTE: probar el flow de Route Optimization EN LOCAL sin depender del token OIDC
// de Vercel (que solo existe en el runtime de Vercel o via `vercel env pull`). En local, ADC
// resuelve la credencial de `gcloud auth application-default login`. NO es para produccion:
// en Vercel no hay identidad ambiente ni metadata server, asi que ADC no aplica alli.
//
// Para REFLEJAR produccion, si hay una SA destino se la IMPERSONA con `Impersonated` (igual
// que WIF impersona): asi el token que se prueba en local tiene los permisos de la SA real,
// no los de la cuenta del desarrollador. Si no hay SA, se usa el client ADC directo (el
// desarrollador habra dado a su propia cuenta el rol de Route Optimization).
//
// INVARIANTES (mismos que los otros dos proveedores):
//  1. R14: ningun error filtra el access_token ni el email de la SA. Se colapsa a un mensaje
//     generico de `RutaTokenError`.
//  2. TESTEABLE SIN RED: la fabrica del auth y la de `Impersonated` son inyectables por
//     `opts`. El client se crea PEREZOSAMENTE dentro de `obtener()`, asi que construir el
//     provider no dispara ninguna llamada.
import { GoogleAuth, Impersonated } from "google-auth-library";
import type { AuthClient } from "google-auth-library";
import {
  RutaTokenError,
  SCOPE_CLOUD_PLATFORM,
  type TokenProvider,
} from "@/lib/auth/google-token-shared";
import { optlog, opterror, describirToken, cronometro } from "@/lib/logging/optimizer-log";

/** Vida del token impersonado, en segundos (maximo que admite IAM Credentials). */
const IMPERSONATION_LIFETIME_S = 3600;

/** Cliente de auth minimo que este modulo consume. `GoogleAuth`/`Impersonated` lo cumplen. */
interface AuthClientLike {
  getAccessToken(): Promise<{ token?: string | null }>;
}

/** Objeto que resuelve el client base de ADC. `GoogleAuth` lo cumple. */
interface AuthLike {
  getClient(): Promise<AuthClientLike>;
}

/** Config que necesita ADC. La SA a impersonar es opcional (camino directo si falta). */
export interface AdcTokenConfig {
  GOOGLE_ROUTE_OPT_SA_EMAIL: string | null;
}

export interface AdcTokenProviderOpts {
  /**
   * Fabrica del objeto de auth base (ADC). Default: `new GoogleAuth({ scopes })`. Inyectable
   * para que los tests corran SIN red devolviendo un doble con `getClient`.
   */
  crearAuth?: (scopes: string[]) => AuthLike;
  /**
   * Fabrica del cliente impersonado. Default: `new Impersonated(...)`. Inyectable para que
   * los tests verifiquen la rama de impersonacion sin tocar IAM Credentials.
   */
  crearImpersonated?: (args: {
    sourceClient: AuthClientLike;
    targetPrincipal: string;
    targetScopes: string[];
    lifetime: number;
  }) => AuthClientLike;
  /** Scope solicitado. Default `cloud-platform`. */
  scope?: string;
}

/**
 * Proveedor de `access_token` por ADC (solo desarrollo local). Cumple el mismo contrato
 * `{ obtener() }` que los otros dos, asi que el handler no distingue.
 */
class GoogleAdcToken implements TokenProvider {
  /** Client cacheado: se crea la primera vez que se pide el token, no al construir. */
  private client: AuthClientLike | null = null;

  constructor(private readonly crearClient: () => Promise<AuthClientLike>) {}

  async obtener(): Promise<string> {
    const medir = cronometro();
    if (this.client === null) {
      optlog("auth/adc — resolviendo credencial local (application-default)");
      try {
        this.client = await this.crearClient();
      } catch (error) {
        // Aqui es donde aparece el fallo tipico del local: `gcloud auth
        // application-default login` sin hacer, o sin permiso para impersonar la SA.
        opterror("auth/adc — no se pudo inicializar el cliente", error, { ms: medir() });
        // R14: el error de ADC puede citar rutas/cuentas locales; se colapsa.
        throw new RutaTokenError("no se pudo inicializar el cliente ADC");
      }
      optlog("auth/adc — cliente listo", { ms: medir() });
    }

    let respuesta: { token?: string | null };
    try {
      respuesta = await this.client.getAccessToken();
    } catch (error) {
      opterror("auth/adc — fallo al pedir el access_token", error, { ms: medir() });
      throw new RutaTokenError("fallo al obtener access_token via ADC");
    }
    if (respuesta.token === undefined || respuesta.token === null || respuesta.token === "") {
      optlog("auth/adc — no devolvio token", { ms: medir() });
      throw new RutaTokenError("ADC no devolvio access_token");
    }
    optlog("auth/adc — access_token obtenido", {
      ...describirToken(respuesta.token),
      ms: medir(),
    });
    return respuesta.token;
  }
}

/**
 * Construye el proveedor ADC. NO valida piezas obligatorias (la SA es opcional) ni toca la
 * red: solo prepara la fabrica perezosa del client. El chequeo de `projectId` lo hace el
 * selector en `construirTokenProvider`, comun a los tres modos.
 */
export function construirTokenProviderAdc(
  config: AdcTokenConfig,
  opts: AdcTokenProviderOpts = {},
): TokenProvider {
  const scope = opts.scope ?? SCOPE_CLOUD_PLATFORM;

  const crearAuth =
    opts.crearAuth ?? ((scopes: string[]) => new GoogleAuth({ scopes }));

  const crearImpersonated =
    opts.crearImpersonated ??
    ((args) =>
      new Impersonated({
        sourceClient: args.sourceClient as unknown as AuthClient,
        targetPrincipal: args.targetPrincipal,
        targetScopes: args.targetScopes,
        lifetime: args.lifetime,
      }));

  const crearClient = async (): Promise<AuthClientLike> => {
    const source = await crearAuth([scope]).getClient();
    // Con SA destino: se impersona (refleja produccion). Sin ella: client ADC directo.
    if (config.GOOGLE_ROUTE_OPT_SA_EMAIL !== null) {
      optlog("auth/adc — impersonando la service account destino", {
        sa: config.GOOGLE_ROUTE_OPT_SA_EMAIL,
      });
      return crearImpersonated({
        sourceClient: source,
        targetPrincipal: config.GOOGLE_ROUTE_OPT_SA_EMAIL,
        targetScopes: [scope],
        lifetime: IMPERSONATION_LIFETIME_S,
      });
    }
    optlog("auth/adc — sin SA destino: se usa la credencial del desarrollador directamente");
    return source;
  };

  return new GoogleAdcToken(crearClient);
}
