import { describe, it, expect, vi } from "vitest";
import { construirTokenProviderAdc } from "@/lib/auth/google-adc-token";
import { RutaTokenError } from "@/lib/auth/google-token-shared";

// Feature 92 (R11/R14) — el proveedor ADC se prueba SIN red: la fabrica del auth base y la
// de `Impersonated` son inyectables. Se verifica el CONTRATO, la rama de impersonacion y el
// saneo de errores.

const SA_EMAIL = "sa-destino@mi-proyecto.iam.gserviceaccount.com";

/** Doble del client final: getAccessToken devuelve un token fijo. */
function clientFake(token: string | null) {
  return { getAccessToken: vi.fn(async () => ({ token })) };
}

/** Doble de GoogleAuth: getClient devuelve el source. */
function authFake(source: { getAccessToken: unknown }) {
  return { getClient: vi.fn(async () => source) } as never;
}

describe("R11 — ADC devuelve el access_token", () => {
  it("con SA email: IMPERSONA y devuelve el token del client impersonado", async () => {
    const source = clientFake("token-source");
    const impersonado = clientFake("token-impersonado");
    const crearImpersonated = vi.fn((_args: {
      sourceClient: unknown;
      targetPrincipal: string;
      targetScopes: string[];
      lifetime: number;
    }) => impersonado);

    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: SA_EMAIL },
      { crearAuth: () => authFake(source), crearImpersonated },
    );

    expect(await provider.obtener()).toBe("token-impersonado");
    expect(crearImpersonated).toHaveBeenCalledTimes(1);
    const args = crearImpersonated.mock.calls[0][0];
    expect(args.targetPrincipal).toBe(SA_EMAIL);
    expect(args.lifetime).toBe(3600);
    // El source NO se uso para el token final (se uso el impersonado).
    expect(source.getAccessToken).not.toHaveBeenCalled();
  });

  it("sin SA email: va DIRECTO al client ADC, sin impersonar", async () => {
    const source = clientFake("token-directo");
    const crearImpersonated = vi.fn();

    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: null },
      { crearAuth: () => authFake(source), crearImpersonated },
    );

    expect(await provider.obtener()).toBe("token-directo");
    expect(crearImpersonated).not.toHaveBeenCalled();
    expect(source.getAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("R14 — ningun error de ADC filtra el token ni la SA", () => {
  // Los VALORES sensibles: el email de la SA y cualquier token emitido ("token-...").
  // (La palabra generica "access_token" del mensaje NO es un secreto.)
  const SECRETOS = [SA_EMAIL, "token-directo", "token-impersonado", "token-source"];

  function assertSinSecretos(mensaje: string) {
    for (const secreto of SECRETOS) {
      expect(mensaje).not.toContain(secreto);
    }
  }

  it("getClient lanza (con detalle sensible) -> RutaTokenError generico", async () => {
    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: SA_EMAIL },
      {
        crearAuth: () =>
          ({
            getClient: async () => {
              throw new Error(`ADC no encontro credencial para ${SA_EMAIL}`);
            },
          }) as never,
      },
    );
    const error = await provider.obtener().catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaTokenError);
    assertSinSecretos((error as Error).message);
  });

  it("getAccessToken lanza -> RutaTokenError sin volcar nada", async () => {
    const source = {
      getAccessToken: async () => {
        throw new Error(`STS fallo para ${SA_EMAIL}`);
      },
    };
    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: null },
      { crearAuth: () => authFake(source) },
    );
    const error = await provider.obtener().catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaTokenError);
    assertSinSecretos((error as Error).message);
  });

  it("token vacio -> RutaTokenError", async () => {
    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: null },
      { crearAuth: () => authFake(clientFake(null)) },
    );
    const error = await provider.obtener().catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaTokenError);
  });
});

describe("R11 — el provider ADC es PEREZOSO: construirlo no toca la red", () => {
  it("crearAuth no se invoca hasta el primer obtener()", async () => {
    const source = clientFake("t");
    const crearAuth = vi.fn(() => authFake(source));

    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: null },
      { crearAuth },
    );
    // Construido, pero sin pedir token: no se ha tocado el auth.
    expect(crearAuth).not.toHaveBeenCalled();

    await provider.obtener();
    expect(crearAuth).toHaveBeenCalledTimes(1);
  });

  it("el client se cachea: dos obtener() crean el auth una sola vez", async () => {
    const source = clientFake("t");
    const crearAuth = vi.fn(() => authFake(source));
    const provider = construirTokenProviderAdc(
      { GOOGLE_ROUTE_OPT_SA_EMAIL: null },
      { crearAuth },
    );

    await provider.obtener();
    await provider.obtener();
    expect(crearAuth).toHaveBeenCalledTimes(1);
  });
});
