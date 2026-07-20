import { describe, it, expect, vi } from "vitest";
import { createPrivateKey, createPublicKey, generateKeyPairSync, createVerify } from "node:crypto";
import {
  GoogleServiceAccountToken,
  RutaNoConfiguradoError,
  RutaTokenError,
  SCOPE_CLOUD_PLATFORM,
  construirTokenProvider,
} from "@/lib/auth/google-sa-token";

// Feature 92 (R11/R12/R14) — el intercambio JWT-bearer se prueba SIN red y SIN credencial
// real: el par RSA se genera aqui mismo, asi que la firma se puede VERIFICAR de verdad en
// vez de darla por buena.

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const CREDENCIAL = { email: "sa@proyecto.iam.gserviceaccount.com", privateKey };
const T0 = new Date("2026-07-20T10:00:00.000Z");

/** Decodifica un segmento base64url de un JWT. */
function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function respuestaToken(token: string, expiresIn = 3600): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: token, expires_in: expiresIn, token_type: "Bearer" }),
  } as unknown as Response;
}

describe("R11 — firma de la assertion JWT-bearer", () => {
  it("los claims llevan iss/sub, scope cloud-platform, aud del endpoint y exp = iat + 3600", async () => {
    const fetchImpl = vi.fn(async () => respuestaToken("tok-1"));
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => T0,
    });

    await provider.obtener();

    const body = String((fetchImpl.mock.calls[0] as unknown[])[1] &&
      ((fetchImpl.mock.calls[0] as unknown[])[1] as { body: string }).body);
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const jwt = params.get("assertion") as string;
    const [header, claims] = jwt.split(".");
    expect(decodeSegment(header)).toEqual({ alg: "RS256", typ: "JWT" });

    const c = decodeSegment(claims);
    const iat = Math.floor(T0.getTime() / 1000);
    expect(c.iss).toBe(CREDENCIAL.email);
    expect(c.sub).toBe(CREDENCIAL.email);
    expect(c.scope).toBe(SCOPE_CLOUD_PLATFORM);
    expect(c.aud).toBe("https://oauth2.googleapis.com/token");
    expect(c.iat).toBe(iat);
    expect(c.exp).toBe(iat + 3600);
  });

  it("la firma RS256 VERIFICA contra la clave publica del par (no es un placeholder)", async () => {
    const fetchImpl = vi.fn(async () => respuestaToken("tok-1"));
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => T0,
    });
    await provider.obtener();

    const params = new URLSearchParams(
      ((fetchImpl.mock.calls[0] as unknown[])[1] as { body: string }).body,
    );
    const jwt = params.get("assertion") as string;
    const [header, claims, firma] = jwt.split(".");

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    verifier.end();
    expect(
      verifier.verify(createPublicKey(publicKey), Buffer.from(firma, "base64url")),
    ).toBe(true);
    // Y la clave PRIVADA no es la que verifica: la asercion de arriba no es trivial.
    expect(createPrivateKey(privateKey).asymmetricKeyType).toBe("rsa");
  });
});

describe("R11 — cache del token en memoria", () => {
  it("un token vigente se REUTILIZA sin volver a llamar al endpoint", async () => {
    const fetchImpl = vi.fn(async () => respuestaToken("tok-1", 3600));
    let ahora = T0;
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => ahora,
    });

    expect(await provider.obtener()).toBe("tok-1");
    ahora = new Date(T0.getTime() + 1_000_000); // +16 min, muy dentro de la vida del token
    expect(await provider.obtener()).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a menos de 60 s de expirar, el token se RENUEVA (margen RENOVAR_ANTES_S)", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => respuestaToken(`tok-${++n}`, 3600));
    let ahora = T0;
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => ahora,
    });

    expect(await provider.obtener()).toBe("tok-1");
    // Justo ANTES del umbral (3600 - 60 = 3540 s): todavia se reutiliza.
    ahora = new Date(T0.getTime() + 3539 * 1000);
    expect(await provider.obtener()).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Alcanzado el umbral: se pide uno nuevo, aunque el token "real" aun no expiro.
    ahora = new Date(T0.getTime() + 3540 * 1000);
    expect(await provider.obtener()).toBe("tok-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("R12 — credencial incompleta corta ANTES de firmar y ANTES de la red", () => {
  const COMPLETA = {
    GOOGLE_ROUTE_OPT_PROJECT_ID: "proyecto",
    GOOGLE_ROUTE_OPT_SA_EMAIL: CREDENCIAL.email,
    GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: privateKey,
  };

  it.each([
    ["GOOGLE_ROUTE_OPT_PROJECT_ID"],
    ["GOOGLE_ROUTE_OPT_SA_EMAIL"],
    ["GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY"],
  ] as const)("falta %s -> RutaNoConfiguradoError sin tocar fetch", (pieza) => {
    const fetchImpl = vi.fn();
    expect(() =>
      construirTokenProvider(
        { ...COMPLETA, [pieza]: null },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).toThrow(RutaNoConfiguradoError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("con las tres piezas construye el provider sin lanzar", () => {
    expect(() => construirTokenProvider(COMPLETA)).not.toThrow();
  });
});

describe("R14 — ningun mensaje de error filtra credencial, token ni assertion", () => {
  const SECRETOS = [CREDENCIAL.email, privateKey, "BEGIN PRIVATE KEY", "tok-secreto"];

  function assertSinSecretos(mensaje: string) {
    for (const secreto of SECRETOS) {
      expect(mensaje).not.toContain(secreto);
    }
    // Y nunca el `assertion` firmado (empieza por el header base64url de RS256).
    expect(mensaje).not.toContain("eyJhbGciOiJSUzI1NiI");
  }

  it("fallo de red -> mensaje generico", async () => {
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: (async () => {
        throw new Error(`socket hang up para ${CREDENCIAL.email}`);
      }) as unknown as typeof fetch,
      now: () => T0,
    });
    await expect(provider.obtener()).rejects.toThrow(RutaTokenError);
    await provider.obtener().catch((e: Error) => assertSinSecretos(e.message));
  });

  it("HTTP 400 -> solo el status; el cuerpo (que ecoa la assertion) NO se propaga", async () => {
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: (async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "invalid_grant", error_description: privateKey }),
      })) as unknown as typeof fetch,
      now: () => T0,
    });
    const error = await provider.obtener().catch((e: Error) => e);
    expect((error as Error).message).toContain("HTTP 400");
    assertSinSecretos((error as Error).message);
  });

  it("respuesta con forma invalida -> cita los CAMPOS, nunca sus valores", async () => {
    const provider = new GoogleServiceAccountToken(CREDENCIAL, {
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok-secreto" }), // falta expires_in
      })) as unknown as typeof fetch,
      now: () => T0,
    });
    const error = await provider.obtener().catch((e: Error) => e);
    expect((error as Error).message).toContain("expires_in");
    assertSinSecretos((error as Error).message);
  });

  it("clave PEM invalida -> error de firma sin volcar la clave", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleServiceAccountToken(
      { email: CREDENCIAL.email, privateKey: "-----BEGIN PRIVATE KEY-----\nrota\n-----END PRIVATE KEY-----" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => T0 },
    );
    const error = await provider.obtener().catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaTokenError);
    expect((error as Error).message).not.toContain("rota");
    // Y no llego a salir a la red con una assertion sin firmar.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
