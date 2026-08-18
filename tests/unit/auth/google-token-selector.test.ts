import { describe, it, expect, vi } from "vitest";
import { construirTokenProvider } from "@/lib/auth/google-sa-token";
import { RutaNoConfiguradoError } from "@/lib/auth/google-token-shared";

// Feature 92 (R11/R12) — SELECTOR de modo de autenticacion. Lo que se prueba aqui es la
// PRECEDENCIA (ADC > WIF > JWT-bearer) y que ninguna rama toque la red: las fabricas de los
// tres modos son inyectables, asi que un `fetchImpl`/`crearAuthClient` espia basta para
// saber QUE modo se eligio sin salir del proceso.
//
// POR QUE ESTE ARCHIVO EXISTE: durante un tiempo `credenciales-google.md` documento un
// selector de tres modos que el codigo NO tenia — `construirTokenProvider` solo construia el
// JWT-bearer. El efecto era silencioso y caro: en un entorno con WIF bien configurado pero
// sin clave privada, la credencial se daba por ausente y la feature caia SIEMPRE al orden
// local (Haversine) sin llamar nunca a Google. Estos tests son la guardia de esa regresion.

const SA_EMAIL = "sa-destino@mi-proyecto.iam.gserviceaccount.com";

/** Config con TODAS las piezas de los tres modos. Cada test apaga las que no le interesan. */
const CONFIG_TODO = {
  GOOGLE_ROUTE_OPT_PROJECT_ID: "mi-proyecto",
  GOOGLE_ROUTE_OPT_SA_EMAIL: SA_EMAIL,
  GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nfalsa\n-----END PRIVATE KEY-----\n",
  GOOGLE_WIF_PROJECT_NUMBER: "123456789012",
  GOOGLE_WIF_POOL_ID: "vercel",
  GOOGLE_WIF_PROVIDER_ID: "vercel",
  GOOGLE_ROUTE_OPT_USE_ADC: false,
};

/** Dobles de las tres fabricas. Ninguno sale a la red; cada uno marca su rama. */
function espias() {
  const wifAuthClient = vi.fn(() => ({ getAccessToken: async () => ({ token: "token-wif" }) }));
  const adcAuth = vi.fn(() => ({
    getClient: async () => ({ getAccessToken: async () => ({ token: "token-adc" }) }),
  }));
  const jwtFetch = vi.fn();
  return {
    jwtFetch,
    opts: {
      fetchImpl: jwtFetch as unknown as typeof fetch,
      wif: { crearAuthClient: wifAuthClient, subjectTokenSupplier: { getSubjectToken: async () => "oidc" } },
      adc: { crearAuth: adcAuth, crearImpersonated: (args: { sourceClient: unknown }) => args.sourceClient as { getAccessToken: () => Promise<{ token?: string | null }> } },
    },
    wifAuthClient,
    adcAuth,
  };
}

describe("R11 — precedencia ADC > WIF > JWT-bearer", () => {
  it("con GOOGLE_ROUTE_OPT_USE_ADC=true gana ADC aunque WIF este completo", async () => {
    const { opts, adcAuth, wifAuthClient } = espias();
    const provider = construirTokenProvider(
      { ...CONFIG_TODO, GOOGLE_ROUTE_OPT_USE_ADC: true },
      opts,
    );

    expect(await provider.obtener()).toBe("token-adc");
    expect(adcAuth).toHaveBeenCalledTimes(1);
    expect(wifAuthClient).not.toHaveBeenCalled();
  });

  it("sin flag de ADC, con las tres piezas WIF gana WIF aunque haya clave privada", async () => {
    // Esta es la combinacion REAL de un entorno migrado a keyless al que le sobrevive la
    // clave vieja: si ganara el JWT-bearer, la migracion no habria servido de nada.
    const { opts, wifAuthClient, adcAuth, jwtFetch } = espias();
    const provider = construirTokenProvider(CONFIG_TODO, opts);

    expect(await provider.obtener()).toBe("token-wif");
    expect(wifAuthClient).toHaveBeenCalledTimes(1);
    expect(adcAuth).not.toHaveBeenCalled();
    expect(jwtFetch).not.toHaveBeenCalled();
  });

  it("la audience del modo WIF se arma con las piezas de la config", async () => {
    let opcionesVistas: Record<string, unknown> | null = null;
    const provider = construirTokenProvider(CONFIG_TODO, {
      wif: {
        subjectTokenSupplier: { getSubjectToken: async () => "oidc" },
        crearAuthClient: (opciones) => {
          opcionesVistas = opciones;
          return { getAccessToken: async () => ({ token: "t" }) };
        },
      },
    });
    await provider.obtener();

    const o = opcionesVistas as unknown as Record<string, unknown>;
    expect(o.audience).toBe(
      "//iam.googleapis.com/projects/123456789012/locations/global" +
        "/workloadIdentityPools/vercel/providers/vercel",
    );
    expect(o.service_account_impersonation_url).toContain(SA_EMAIL);
  });

  it("sin ADC y sin WIF cae al JWT-bearer (firma con la clave privada)", async () => {
    const { opts } = espias();
    const provider = construirTokenProvider(
      {
        ...CONFIG_TODO,
        GOOGLE_WIF_PROJECT_NUMBER: null,
        GOOGLE_WIF_POOL_ID: null,
        GOOGLE_WIF_PROVIDER_ID: null,
      },
      opts,
    );

    // La PEM del fixture es falsa: llegar a `createSign` y fallar ALLI prueba que se eligio
    // esta rama sin necesidad de un par RSA real (que ya cubre google-sa-token.test.ts).
    await expect(provider.obtener()).rejects.toThrow(/assertion|firmar/i);
  });

  it("una pieza WIF suelta NO activa WIF: hacen falta las tres", () => {
    // Media configuracion WIF es un error de despliegue, no una intencion. Activar el modo
    // con dos de tres daria un 403 opaco de STS en vez de un fallback previsible.
    const { opts } = espias();
    const provider = construirTokenProvider(
      { ...CONFIG_TODO, GOOGLE_WIF_PROVIDER_ID: null },
      opts,
    );
    // Cayo al JWT-bearer: el provider es el de firma, no el federado.
    expect(provider.constructor.name).toBe("GoogleServiceAccountToken");
  });

  it("piezas WIF AUSENTES (undefined, no null) tampoco activan WIF", () => {
    const provider = construirTokenProvider({
      GOOGLE_ROUTE_OPT_PROJECT_ID: "p",
      GOOGLE_ROUTE_OPT_SA_EMAIL: SA_EMAIL,
      GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: "pem",
    });
    expect(provider.constructor.name).toBe("GoogleServiceAccountToken");
  });
});

describe("R12 — validacion comun y errores sin tocar la red", () => {
  it.each([
    ["ADC", { GOOGLE_ROUTE_OPT_USE_ADC: true }],
    ["WIF", {}],
    ["JWT", { GOOGLE_WIF_POOL_ID: null }],
  ] as const)(
    "falta GOOGLE_ROUTE_OPT_PROJECT_ID -> lanza en modo %s, igual que en los demas",
    (_modo, extra) => {
      const { opts, adcAuth, wifAuthClient, jwtFetch } = espias();
      expect(() =>
        construirTokenProvider(
          { ...CONFIG_TODO, ...extra, GOOGLE_ROUTE_OPT_PROJECT_ID: null },
          opts,
        ),
      ).toThrow(RutaNoConfiguradoError);
      expect(adcAuth).not.toHaveBeenCalled();
      expect(wifAuthClient).not.toHaveBeenCalled();
      expect(jwtFetch).not.toHaveBeenCalled();
    },
  );

  it("modo WIF sin SA a impersonar -> RutaNoConfiguradoError citando la variable", () => {
    const { opts } = espias();
    expect(() =>
      construirTokenProvider({ ...CONFIG_TODO, GOOGLE_ROUTE_OPT_SA_EMAIL: null }, opts),
    ).toThrow(/GOOGLE_ROUTE_OPT_SA_EMAIL/);
  });

  it("sin ADC, sin WIF y sin clave privada -> RutaNoConfiguradoError (no un provider mudo)", () => {
    // Es el estado de un despliegue sin credencial ninguna. Debe LANZAR aqui para que
    // `FallbackRouteOptimizationClient` lo reconozca y caiga al orden local.
    const { opts, jwtFetch } = espias();
    expect(() =>
      construirTokenProvider(
        {
          GOOGLE_ROUTE_OPT_PROJECT_ID: "p",
          GOOGLE_ROUTE_OPT_SA_EMAIL: SA_EMAIL,
          GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: null,
        },
        opts,
      ),
    ).toThrow(RutaNoConfiguradoError);
    expect(jwtFetch).not.toHaveBeenCalled();
  });

  it("el modo ADC NO exige clave privada ni piezas WIF", () => {
    const { opts, adcAuth } = espias();
    expect(() =>
      construirTokenProvider(
        {
          GOOGLE_ROUTE_OPT_PROJECT_ID: "p",
          GOOGLE_ROUTE_OPT_SA_EMAIL: null,
          GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: null,
          GOOGLE_ROUTE_OPT_USE_ADC: true,
        },
        opts,
      ),
    ).not.toThrow();
    // Perezoso: construir el provider ADC no resuelve todavia ninguna credencial.
    expect(adcAuth).not.toHaveBeenCalled();
  });
});
