import { describe, it, expect, vi } from "vitest";
import { handleCargaApi, type CargaApiDeps } from "@/app/api/ordenes/api-key/carga/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  CargaViaApiResult,
  CargaViaApiSummary,
  IBulkOrdenService,
} from "@/lib/interfaces/services/IBulkOrdenService";

const KEY_ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okSummary(overrides: Partial<CargaViaApiSummary> = {}): CargaViaApiSummary {
  return {
    total: 1,
    creadas: 1,
    duplicadas: 0,
    conError: 0,
    filas: [{ fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "en_ruta_bodega_central", numGuia: 1042 }],
    ordenes: [
      { id: "ord-1", numRemision: "REM-1", numGuia: 1042, estado: "en_ruta_bodega_central", costoEnvio: "3.92" },
    ],
    ...overrides,
  };
}

function fakeService(overrides: Partial<IBulkOrdenService> = {}): IBulkOrdenService {
  return {
    cargarMasiva: vi.fn(),
    cargarViaApi: vi
      .fn()
      .mockResolvedValue({ status: "ok", summary: okSummary() } satisfies CargaViaApiResult),
    ...overrides,
  };
}

function deps(
  auth: ApiKeyAuthResult,
  service: IBulkOrdenService,
  spyAuth?: CargaApiDeps["autenticar"],
): CargaApiDeps {
  const autenticar: CargaApiDeps["autenticar"] = spyAuth ?? (async () => auth);
  return { autenticar, bulkService: service };
}

function reqConBearer(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request("http://localhost/api/ordenes/api-key/carga", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const BODY = { ordenes: [{ num_remision: "REM-1", destinatario: "Ana", telefono: "099" }] };

describe("carga API: autenticacion (R1/R2/R4/R5)", () => {
  it("R2: sin header Authorization -> 401 y autenticar recibe null (extraccion del header)", async () => {
    const spyAuth = vi.fn(async () => ({ status: "unauthenticated" }) as ApiKeyAuthResult);
    const service = fakeService();
    const res = await handleCargaApi(reqConBearer(BODY), deps({ status: "unauthenticated" }, service, spyAuth));
    expect(res.status).toBe(401);
    expect(spyAuth).toHaveBeenCalledWith(null); // R1: header ausente -> secreto null
    expect(service.cargarViaApi).not.toHaveBeenCalled();
  });

  it("R4: autenticar unauthenticated (hash no coincide) -> 401, sin crear ordenes", async () => {
    const service = fakeService();
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), deps({ status: "unauthenticated" }, service));
    expect(res.status).toBe(401);
    expect(service.cargarViaApi).not.toHaveBeenCalled();
  });

  it("R5: autenticar forbidden (usuario no activo) -> 403, sin crear ordenes", async () => {
    const service = fakeService();
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), deps({ status: "forbidden" }, service));
    expect(res.status).toBe(403);
    expect(service.cargarViaApi).not.toHaveBeenCalled();
  });

  it("extrae el secreto del esquema Bearer y lo pasa a autenticar", async () => {
    const spyAuth = vi.fn(async () => ({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }) as ApiKeyAuthResult);
    const service = fakeService();
    await handleCargaApi(reqConBearer(BODY, SECRETO), deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service, spyAuth));
    expect(spyAuth).toHaveBeenCalledWith(SECRETO);
  });
});

describe("carga API: cuerpo (R7)", () => {
  it("JSON invalido -> 422, sin crear ordenes", async () => {
    const service = fakeService();
    const req = new Request("http://localhost/api/ordenes/api-key/carga", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETO}` },
      body: "{ no-json",
    });
    const res = await handleCargaApi(req, deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service));
    expect(res.status).toBe(422);
    expect(service.cargarViaApi).not.toHaveBeenCalled();
  });

  it("lote vacio -> 422", async () => {
    const service = fakeService();
    const res = await handleCargaApi(
      reqConBearer({ ordenes: [] }, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(422);
    expect(service.cargarViaApi).not.toHaveBeenCalled();
  });
});

describe("carga API: happy path (R10)", () => {
  it("200 con las ordenes creadas llevando su num_guia", async () => {
    const service = fakeService();
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ordenes[0]).toMatchObject({ numRemision: "REM-1", numGuia: 1042, estado: "en_ruta_bodega_central" });
    expect(json.filas[0].numGuia).toBe(1042);
    // El service recibe el actor del usuario dedicado de la key.
    expect(service.cargarViaApi).toHaveBeenCalledWith(BODY.ordenes, KEY_ACTOR);
  });

  // Feature 98 (T10) — la respuesta incluye costoEnvio (flete + IVA) por orden creada (R5).
  it("R5: cada orden creada del bloque `ordenes` lleva su costoEnvio", async () => {
    const service = fakeService();
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    const json = await res.json();
    expect(json.ordenes[0].costoEnvio).toBe("3.92");
    expect(typeof json.ordenes[0].costoEnvio).toBe("string");
  });

  // Feature 98 (T10) — la forma de las filas error/duplicada NO cambia: no ganan costoEnvio (R6).
  it("R6: filas error/duplicada conservan su shape (sin costoEnvio)", async () => {
    const summary = okSummary({
      total: 2,
      creadas: 0,
      duplicadas: 1,
      conError: 1,
      filas: [
        { fila: 1, numRemision: "REM-D", resultado: "duplicada", estatus: "entregada" },
        { fila: 2, numRemision: "REM-E", resultado: "error", errores: { provincia: ["no encontrada"] } },
      ],
      ordenes: [],
    });
    const service = fakeService({
      cargarViaApi: vi.fn().mockResolvedValue({ status: "ok", summary } satisfies CargaViaApiResult),
    });
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );
    const json = await res.json();
    expect(json.filas[0]).not.toHaveProperty("costoEnvio");
    expect(json.filas[1]).not.toHaveProperty("costoEnvio");
    expect(json.filas[1].errores).toHaveProperty("provincia");
    expect(json.ordenes).toEqual([]);
  });
});

describe("carga API: seguridad (R6)", () => {
  it("el secreto NUNCA aparece en el cuerpo de una respuesta de error", async () => {
    const service = fakeService();
    // forbidden: la respuesta de error no debe filtrar el header/secreto.
    const res = await handleCargaApi(reqConBearer(BODY, SECRETO), deps({ status: "forbidden" }, service));
    const texto = await res.text();
    expect(texto).not.toContain(SECRETO);
  });
});

// Feature 159 (R9) — mitad de BORDE del contrato publico: una fila que trae la clave
// retirada `mensajero_sugerido_id` no cambia el codigo HTTP ni la respuesta, y la
// clave LLEGA al service (el borde no la rechaza ni la filtra). La otra mitad —que
// el service produzca el mismo `RowResult` con y sin ella— vive en
// `tests/unit/services/bulk-orden-service.carga-api.test.ts`.
describe("carga API: mensajero sugerido retirado (159/R9)", () => {
  const BODY_CON_CLAVE = {
    ordenes: [
      { num_remision: "REM-1", destinatario: "Ana", telefono: "099", mensajero_sugerido_id: "u-1" },
    ],
  };

  it("la clave retirada no rompe la validacion del cuerpo: mismo 200 y mismo JSON", async () => {
    const conClave = await handleCargaApi(
      reqConBearer(BODY_CON_CLAVE, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, fakeService()),
    );
    const sinClave = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, fakeService()),
    );

    expect(conClave.status).toBe(200);
    expect(conClave.status).toBe(sinClave.status);
    expect(await conClave.json()).toEqual(await sinClave.json());
  });

  it("la clave viaja intacta al service: la descarta el schema de fila, no el borde", async () => {
    const service = fakeService();
    await handleCargaApi(
      reqConBearer(BODY_CON_CLAVE, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service),
    );

    const [filas] = (service.cargarViaApi as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filas[0]).toHaveProperty("mensajero_sugerido_id", "u-1");
  });
});
