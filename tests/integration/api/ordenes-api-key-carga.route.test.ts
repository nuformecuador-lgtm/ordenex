import { describe, it, expect, vi } from "vitest";
import { handleCargaApi, type CargaApiDeps } from "@/app/api/ordenes/api-key/carga/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  CargaViaApiResult,
  CargaViaApiSummary,
  IBulkOrdenService,
} from "@/lib/interfaces/services/IBulkOrdenService";
import type { IManifiestoService } from "@/lib/interfaces/services/IManifiestoService";
import { resolverDestinoCreacion } from "@/lib/services/destino-creacion";

const KEY_ACTOR: Actor = { usuarioId: "key-user-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";

function okSummary(overrides: Partial<CargaViaApiSummary> = {}): CargaViaApiSummary {
  return {
    total: 1,
    creadas: 1,
    duplicadas: 0,
    conError: 0,
    filas: [{ fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "por_recolectar_en_tienda", numGuia: 1042 }],
    ordenes: [
      { id: "ord-1", numRemision: "REM-1", numGuia: 1042, estado: "por_recolectar_en_tienda", costoEnvio: "3.92" },
    ],
    ...overrides,
  };
}

function fakeService(overrides: Partial<IBulkOrdenService> = {}): IBulkOrdenService {
  return {
    cargarMasiva: vi.fn(),
    // Feature 155/R24: el resultado del service lleva ademas la bifurcacion resuelta del
    // lote. El default es la rama (b) —la unica alcanzable hoy por este canal—, que SI emite
    // manifiesto; los casos que necesitan la otra rama la pasan explicitamente.
    cargarViaApi: vi
      .fn()
      .mockResolvedValue({
        status: "ok",
        summary: okSummary(),
        destino: resolverDestinoCreacion(false),
      } satisfies CargaViaApiResult),
    ...overrides,
  };
}

// Feature 155/R24 — doble del SERVICIO UNICO de manifiesto. Se inyecta SIEMPRE por defecto:
// sin el, el borde construiria el service real (Prisma, DB) en un test sin base.
function fakeManifiesto(overrides: Partial<IManifiestoService> = {}): IManifiestoService {
  return {
    armar: vi.fn().mockResolvedValue({
      status: "ok",
      filas: [{ numRemision: "REM-1", origen: "Tienda Uno", destino: "Bodega central" }],
      omitidas: [],
    }),
    ...overrides,
  } as IManifiestoService;
}

function deps(
  auth: ApiKeyAuthResult,
  service: IBulkOrdenService,
  spyAuth?: CargaApiDeps["autenticar"],
  manifiestoService: IManifiestoService = fakeManifiesto(),
): CargaApiDeps {
  const autenticar: CargaApiDeps["autenticar"] = spyAuth ?? (async () => auth);
  return { autenticar, bulkService: service, manifiestoService };
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
    expect(json.ordenes[0]).toMatchObject({ numRemision: "REM-1", numGuia: 1042, estado: "por_recolectar_en_tienda" });
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
      cargarViaApi: vi
        .fn()
        .mockResolvedValue({
          status: "ok",
          summary,
          destino: resolverDestinoCreacion(false),
        } satisfies CargaViaApiResult),
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

// ---------------------------------------------------------------------------------------------
// Feature 155/R24/R25/R26 — manifiesto del lote por el canal de API key (opcion C de la puerta
// T0.1). Este borde existe porque la Server Action `obtenerManifiesto` resuelve el actor por
// COOKIE DE SESION y una API key no tiene cookie: no puede invocarla.
// ---------------------------------------------------------------------------------------------
describe("carga API: manifiesto del lote (155/R24/R25/R26)", () => {
  it("R24: la rama (b) expone el manifiesto del lote, armado por el SERVICIO UNICO", async () => {
    const manifiesto = fakeManifiesto();
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, fakeService(), undefined, manifiesto),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.manifiesto.filas).toHaveLength(1);
    expect(json.manifiesto.omitidas).toEqual([]);
    // R24: lo arma el service unico, con el flujo propio de la rama (b) y el actor de la key.
    expect(manifiesto.armar).toHaveBeenCalledWith(
      { flujo: "recoleccion_tienda", ordenIds: ["ord-1"] },
      KEY_ACTOR,
    );
  });

  it("R26: la rama (a) NO emite manifiesto (no hubo movimiento fisico)", async () => {
    const manifiesto = fakeManifiesto();
    const service = fakeService({
      cargarViaApi: vi.fn().mockResolvedValue({
        status: "ok",
        summary: okSummary(),
        destino: resolverDestinoCreacion(true),
      } satisfies CargaViaApiResult),
    });
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service, undefined, manifiesto),
    );
    const json = await res.json();

    expect(json.manifiesto).toBeNull();
    expect(manifiesto.armar).not.toHaveBeenCalled();
  });

  it("R26: sin ordenes creadas no hay manifiesto que emitir", async () => {
    const manifiesto = fakeManifiesto();
    const service = fakeService({
      cargarViaApi: vi.fn().mockResolvedValue({
        status: "ok",
        summary: okSummary({ total: 1, creadas: 0, conError: 1, filas: [], ordenes: [] }),
        destino: resolverDestinoCreacion(false),
      } satisfies CargaViaApiResult),
    });
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, service, undefined, manifiesto),
    );
    const json = await res.json();

    expect(json.manifiesto).toBeNull();
    expect(manifiesto.armar).not.toHaveBeenCalled();
  });

  it("R25: si el manifiesto LANZA, la carga NO se revierte: 200, ordenes intactas y error visible", async () => {
    const manifiesto = fakeManifiesto({
      armar: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, fakeService(), undefined, manifiesto),
    );
    const json = await res.json();
    errorSpy.mockRestore();

    expect(res.status).toBe(200);
    // R25: el estado, la guia y el resto del summary llegan igual.
    expect(json.creadas).toBe(1);
    expect(json.ordenes[0]).toMatchObject({ numGuia: 1042, estado: "por_recolectar_en_tienda" });
    // El fallo es VISIBLE, no se oculta con null.
    expect(json.manifiesto).toEqual({ error: expect.any(String) });
    expect(json.manifiesto.error).not.toContain("boom"); // sin mensajes crudos
  });

  it("R25: un `forbidden` del service de manifiesto degrada a error, sin tumbar la carga", async () => {
    const manifiesto = fakeManifiesto({
      armar: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, fakeService(), undefined, manifiesto),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.creadas).toBe(1);
    expect(json.manifiesto).toEqual({ error: expect.any(String) });
  });

  it("R23: el resto del contrato de respuesta queda intacto al sumar `manifiesto`", async () => {
    const res = await handleCargaApi(
      reqConBearer(BODY, SECRETO),
      deps({ status: "ok", actor: KEY_ACTOR, apiKeyId: "k1" }, fakeService()),
    );
    const json = await res.json();

    for (const clave of ["total", "creadas", "duplicadas", "conError", "filas", "ordenes"]) {
      expect(json, `falta la clave ${clave} del contrato 88`).toHaveProperty(clave);
    }
    expect(json).toHaveProperty("etiquetasPdf");
    expect(json).toHaveProperty("manifiesto");
    expect(json.ordenes[0]).toHaveProperty("costoEnvio");
  });
});
