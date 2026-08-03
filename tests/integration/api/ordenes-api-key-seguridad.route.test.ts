import { describe, it, expect, vi, afterEach } from "vitest";
import { handleListadoApi } from "@/app/api/ordenes/api-key/route";
import { handleDetalleApi } from "@/app/api/ordenes/api-key/[numGuia]/route";
import { handleCancelarApi } from "@/app/api/ordenes/api-key/[numGuia]/cancelar/route";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenLecturaService } from "@/lib/interfaces/services/IApiOrdenLecturaService";
import type { IApiOrdenCancelacionService } from "@/lib/interfaces/services/IApiOrdenCancelacionService";

// Feature 106 (T13, R5) — la API key es un secreto: NUNCA aparece en el cuerpo de una respuesta
// de error ni en `console.*`. Se fuerza un error en cada endpoint por vias legitimas (auth
// forbidden -> 403 y error inesperado del service -> 500), sin inyectar el secreto en el error:
// lo unico que lleva el secreto es el header `Authorization`, y ningun canal de nuestro codigo
// debe re-emitirlo. Si alguien lo metiera en un mensaje de error o en un log, el test lo caza.

const SECRETO = "ordx_secretovivo1234567890";
const ACTOR = { usuarioId: "store-1", rol: "apiKey" as const };

function reqWithKey(url: string, method: string): Request {
  return new Request(url, { method, headers: { Authorization: `Bearer ${SECRETO}` } });
}

const FORBIDDEN: ApiKeyAuthResult = { status: "forbidden" };
const OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

// Service que revienta con un mensaje GENERICO (sin el secreto): fuerza el 500 -> logger.
function lecturaQueRevienta(): IApiOrdenLecturaService {
  return {
    listar: vi.fn().mockRejectedValue(new Error("fallo interno de base de datos")),
    detalle: vi.fn().mockRejectedValue(new Error("fallo interno de base de datos")),
    detallePorOrdenId: vi.fn().mockRejectedValue(new Error("fallo interno de base de datos")),
  };
}
function cancelacionQueRevienta(): IApiOrdenCancelacionService {
  return { cancelar: vi.fn().mockRejectedValue(new Error("fallo interno de base de datos")) };
}

function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };
}

function assertConsoleSinSecreto(spies: ReturnType<typeof spyConsole>) {
  for (const spy of Object.values(spies)) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRETO);
    }
  }
}

afterEach(() => vi.restoreAllMocks());

describe("canal integrador: la key nunca se filtra (R5)", () => {
  it("listado: forbidden (403) y error interno (500) -> body y console.* sin el secreto", async () => {
    const spies = spyConsole();
    const forb = await handleListadoApi(reqWithKey("http://localhost/api/ordenes/api-key", "GET"), {
      autenticar: async () => FORBIDDEN,
      lecturaService: lecturaQueRevienta(),
    });
    expect(await forb.text()).not.toContain(SECRETO);

    const boom = await handleListadoApi(reqWithKey("http://localhost/api/ordenes/api-key", "GET"), {
      autenticar: async () => OK,
      lecturaService: lecturaQueRevienta(),
    });
    expect(await boom.text()).not.toContain(SECRETO);
    assertConsoleSinSecreto(spies);
  });

  it("detalle: forbidden (403) y error interno (500) -> body y console.* sin el secreto", async () => {
    const spies = spyConsole();
    const url = "http://localhost/api/ordenes/api-key/10234";
    const forb = await handleDetalleApi(reqWithKey(url, "GET"), "10234", {
      autenticar: async () => FORBIDDEN,
      lecturaService: lecturaQueRevienta(),
    });
    expect(await forb.text()).not.toContain(SECRETO);

    const boom = await handleDetalleApi(reqWithKey(url, "GET"), "10234", {
      autenticar: async () => OK,
      lecturaService: lecturaQueRevienta(),
    });
    expect(await boom.text()).not.toContain(SECRETO);
    assertConsoleSinSecreto(spies);
  });

  it("cancelar: forbidden (403) y error interno (500) -> body y console.* sin el secreto", async () => {
    const spies = spyConsole();
    const url = "http://localhost/api/ordenes/api-key/10234/cancelar";
    const forb = await handleCancelarApi(reqWithKey(url, "PUT"), "10234", {
      autenticar: async () => FORBIDDEN,
      cancelacionService: cancelacionQueRevienta(),
    });
    expect(await forb.text()).not.toContain(SECRETO);

    const boom = await handleCancelarApi(reqWithKey(url, "PUT"), "10234", {
      autenticar: async () => OK,
      cancelacionService: cancelacionQueRevienta(),
    });
    expect(await boom.text()).not.toContain(SECRETO);
    assertConsoleSinSecreto(spies);
  });
});
