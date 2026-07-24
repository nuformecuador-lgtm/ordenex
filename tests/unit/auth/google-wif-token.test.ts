import { describe, it, expect, vi } from "vitest";
import { construirTokenProviderWif } from "@/lib/auth/google-wif-token";
import { RutaNoConfiguradoError, RutaTokenError } from "@/lib/auth/google-token-shared";

// Feature 92 (R11/R12/R14) — el proveedor WIF se prueba SIN red: la fabrica del cliente de
// auth (`crearAuthClient`) y el `subjectTokenSupplier` son inyectables, asi que ni STS ni
// IAM Credentials ni Vercel se tocan. Lo que se verifica es el CONTRATO y el SANEO de errores.

const OIDC_SECRETO = "oidc-token-supersecreto-de-vercel";
const SA_EMAIL = "sa-destino@mi-proyecto.iam.gserviceaccount.com";

const CONFIG_COMPLETA = {
  GOOGLE_WIF_PROJECT_NUMBER: "123456789012",
  GOOGLE_WIF_POOL_ID: "mi-pool",
  GOOGLE_WIF_PROVIDER_ID: "vercel-oidc",
  GOOGLE_ROUTE_OPT_SA_EMAIL: SA_EMAIL,
};

/** Supplier fake: nunca sale a la red, y guarda si se le pidio el token. */
const supplierFake = { getSubjectToken: async () => OIDC_SECRETO };

describe("R11 — WIF devuelve el access_token del intercambio", () => {
  it("obtener() delega en getAccessToken() y devuelve el .token", async () => {
    const getAccessToken = vi.fn(async () => ({ token: "access-token-federado" }));
    const provider = construirTokenProviderWif(CONFIG_COMPLETA, {
      subjectTokenSupplier: supplierFake,
      crearAuthClient: () => ({ getAccessToken }),
    });

    expect(await provider.obtener()).toBe("access-token-federado");
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("construye la audience del pool con las tres piezas WIF", async () => {
    let opcionesVistas: Record<string, unknown> | null = null;
    const provider = construirTokenProviderWif(CONFIG_COMPLETA, {
      subjectTokenSupplier: supplierFake,
      crearAuthClient: (opciones) => {
        opcionesVistas = opciones;
        return { getAccessToken: async () => ({ token: "t" }) };
      },
    });
    await provider.obtener();

    expect(opcionesVistas).not.toBeNull();
    const o = opcionesVistas as unknown as Record<string, unknown>;
    expect(o.type).toBe("external_account");
    expect(o.audience).toBe(
      "//iam.googleapis.com/projects/123456789012/locations/global" +
        "/workloadIdentityPools/mi-pool/providers/vercel-oidc",
    );
    expect(o.subject_token_type).toBe("urn:ietf:params:oauth:token-type:jwt");
    expect(o.token_url).toBe("https://sts.googleapis.com/v1/token");
    expect(o.service_account_impersonation_url).toBe(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA_EMAIL}:generateAccessToken`,
    );
  });
});

describe("R14 — ningun error del intercambio WIF filtra el token OIDC ni la SA", () => {
  const SECRETOS = [OIDC_SECRETO, SA_EMAIL, "access-token", "BEGIN"];

  function assertSinSecretos(mensaje: string) {
    for (const secreto of SECRETOS) {
      expect(mensaje).not.toContain(secreto);
    }
  }

  it("getAccessToken lanza (con detalle sensible) -> RutaTokenError generico", async () => {
    const provider = construirTokenProviderWif(CONFIG_COMPLETA, {
      subjectTokenSupplier: supplierFake,
      crearAuthClient: () => ({
        getAccessToken: async () => {
          throw new Error(`STS rechazo el token ${OIDC_SECRETO} para ${SA_EMAIL}`);
        },
      }),
    });
    const error = await provider.obtener().catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaTokenError);
    assertSinSecretos((error as Error).message);
  });

  it("getAccessToken devuelve sin token -> RutaTokenError sin volcar nada", async () => {
    const provider = construirTokenProviderWif(CONFIG_COMPLETA, {
      subjectTokenSupplier: supplierFake,
      crearAuthClient: () => ({ getAccessToken: async () => ({ token: null }) }),
    });
    const error = await provider.obtener().catch((e: Error) => e);
    expect(error).toBeInstanceOf(RutaTokenError);
    assertSinSecretos((error as Error).message);
  });

  it("fromJSON devuelve null -> RutaTokenError sin citar la SA", () => {
    const error = (() => {
      try {
        construirTokenProviderWif(CONFIG_COMPLETA, {
          subjectTokenSupplier: supplierFake,
          crearAuthClient: () => null,
        });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(RutaTokenError);
    assertSinSecretos((error as Error).message);
  });
});

describe("R12 — falta una pieza WIF -> RutaNoConfiguradoError sin construir el cliente", () => {
  it.each([
    ["GOOGLE_WIF_PROJECT_NUMBER"],
    ["GOOGLE_WIF_POOL_ID"],
    ["GOOGLE_WIF_PROVIDER_ID"],
    ["GOOGLE_ROUTE_OPT_SA_EMAIL"],
  ] as const)("falta %s", (pieza) => {
    const crearAuthClient = vi.fn();
    expect(() =>
      construirTokenProviderWif(
        { ...CONFIG_COMPLETA, [pieza]: null },
        { subjectTokenSupplier: supplierFake, crearAuthClient },
      ),
    ).toThrow(RutaNoConfiguradoError);
    expect(crearAuthClient).not.toHaveBeenCalled();
  });

  it("el mensaje cita el NOMBRE de la variable que falta", () => {
    const error = (() => {
      try {
        construirTokenProviderWif(
          { ...CONFIG_COMPLETA, GOOGLE_WIF_POOL_ID: null },
          { subjectTokenSupplier: supplierFake },
        );
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect((error as Error).message).toContain("GOOGLE_WIF_POOL_ID");
  });
});
