// Feature 177 — T20 (R5): la API key es un SECRETO. Ni el secreto en claro ni su hash SHA-256
// pueden aparecer en el cuerpo de una respuesta de error, ni en sus headers, ni en ningun
// `console.*`, en NINGUNO de los tres endpoints nuevos.
//
// Se fuerza el error por vias legitimas y sin plantar el secreto en el error: lo unico que lleva
// la key es el header `Authorization`, y ningun canal de nuestro codigo debe re-emitirla.
//   - key desconocida            -> 401 (el autenticador inyectado responde `unauthenticated`)
//   - usuario o key no activos   -> 403 (el autenticador inyectado responde `forbidden`)
//   - fallo interno inesperado   -> 500 (el service inyectado LANZA; entra el logger por defecto,
//                                        que hace `console.error` con el stack)
//
// El hash se calcula con el MISMO `hashApiKey` que usa `ApiKeyAuthService` (SHA-256 hex,
// `lib/utils/api-key-hash.ts`), no con una derivacion supuesta.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { NextResponse } from "next/server";
import { handleConsultaOrdenApi } from "@/app/api/ordenes/api-key/orden/[id]/route";
import { handleGenerarPdfOrdenApi } from "@/app/api/ordenes/api-key/orden/[id]/generate/route";
import { handleCargaGenerateApi } from "@/app/api/ordenes/api-key/carga/[cargaId]/generate/route";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { IApiOrdenResolucionService } from "@/lib/interfaces/services/IApiOrdenResolucionService";
import type { IApiPdfEtiquetaService } from "@/lib/interfaces/services/IApiPdfEtiquetaService";

/** Secreto de prueba deliberadamente raro: no puede colisionar por casualidad con nada. */
const SECRETO = "ordx_CLAVE_SECRETA_DE_PRUEBA_9f3a1c";
const HASH = hashApiKey(SECRETO);

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const DESCONOCIDA: ApiKeyAuthResult = { status: "unauthenticated" };
const INACTIVA: ApiKeyAuthResult = { status: "forbidden" };
const OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

const ID_ORDEN = "100234";
const ID_CARGA = "3f2b7c1e-8a4d-4f6b-9c2e-0a1b2c3d4e5f";

/** Mensaje GENERICO: el fallo interno no transporta el secreto, para no falsear el test. */
const BOOM = () => new Error("fallo interno de base de datos");

function req(url: string, method: string): Request {
  return new Request(url, { method, headers: { Authorization: `Bearer ${SECRETO}` } });
}

function resolucionQueRevienta(): IApiOrdenResolucionService {
  return { resolver: vi.fn().mockRejectedValue(BOOM()) };
}
function pdfQueRevienta(): IApiPdfEtiquetaService {
  return {
    porOrden: vi.fn().mockRejectedValue(BOOM()),
    porCarga: vi.fn().mockRejectedValue(BOOM()),
  };
}

type ConsoleSpies = ReturnType<typeof espiarConsola>;

function espiarConsola() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };
}

/** Serializa cualquier argumento, incluidos los `Error` (que JSON.stringify aplanaria a `{}`). */
function serializar(valor: unknown): string {
  return (
    JSON.stringify(valor, (_clave, v: unknown) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
    ) ?? ""
  );
}

/**
 * Afirma el status esperado y que NI la key NI su hash aparecen en: (1) el cuerpo leido como
 * TEXTO CRUDO, (2) los headers de la respuesta, (3) los argumentos de CUALQUIER llamada a los
 * cinco `console.*`.
 */
async function afirmarSinFuga(res: NextResponse, status: number, spies: ConsoleSpies) {
  expect(res.status).toBe(status);

  const cuerpo = await res.text();
  expect(cuerpo).not.toContain(SECRETO);
  expect(cuerpo).not.toContain(HASH);

  const headers = serializar([...res.headers.entries()]);
  expect(headers).not.toContain(SECRETO);
  expect(headers).not.toContain(HASH);

  for (const [canal, spy] of Object.entries(spies)) {
    const registrado = serializar(spy.mock.calls);
    expect(`${canal}:${registrado}`).not.toContain(SECRETO);
    expect(`${canal}:${registrado}`).not.toContain(HASH);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("Feature 177 R5 — GET /api/ordenes/api-key/orden/{id} no filtra la key", () => {
  const url = `http://localhost/api/ordenes/api-key/orden/${ID_ORDEN}`;

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando la key es desconocida (401)", async () => {
    const spies = espiarConsola();
    const res = await handleConsultaOrdenApi(req(url, "GET"), ID_ORDEN, {
      autenticar: async () => DESCONOCIDA,
      resolucionService: resolucionQueRevienta(),
      detallePorOrdenId: vi.fn().mockRejectedValue(BOOM()),
    });
    await afirmarSinFuga(res, 401, spies);
  });

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando el usuario o la key estan inactivos (403)", async () => {
    const spies = espiarConsola();
    const res = await handleConsultaOrdenApi(req(url, "GET"), ID_ORDEN, {
      autenticar: async () => INACTIVA,
      resolucionService: resolucionQueRevienta(),
      detallePorOrdenId: vi.fn().mockRejectedValue(BOOM()),
    });
    await afirmarSinFuga(res, 403, spies);
  });

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando el service lanza un error interno inesperado (500)", async () => {
    const spies = espiarConsola();
    const res = await handleConsultaOrdenApi(req(url, "GET"), ID_ORDEN, {
      autenticar: async () => OK,
      resolucionService: resolucionQueRevienta(),
      detallePorOrdenId: vi.fn().mockRejectedValue(BOOM()),
    });
    await afirmarSinFuga(res, 500, spies);
    // El 500 SI paso por el logger por defecto: el test es significativo, no vacio.
    expect(spies.error).toHaveBeenCalled();
  });
});

describe("Feature 177 R5 — POST /api/ordenes/api-key/orden/{id}/generate no filtra la key", () => {
  const url = `http://localhost/api/ordenes/api-key/orden/${ID_ORDEN}/generate`;

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando la key es desconocida (401)", async () => {
    const spies = espiarConsola();
    const res = await handleGenerarPdfOrdenApi(req(url, "POST"), ID_ORDEN, {
      autenticar: async () => DESCONOCIDA,
      resolucionService: resolucionQueRevienta(),
      pdfService: pdfQueRevienta(),
    });
    await afirmarSinFuga(res, 401, spies);
  });

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando el usuario o la key estan inactivos (403)", async () => {
    const spies = espiarConsola();
    const res = await handleGenerarPdfOrdenApi(req(url, "POST"), ID_ORDEN, {
      autenticar: async () => INACTIVA,
      resolucionService: resolucionQueRevienta(),
      pdfService: pdfQueRevienta(),
    });
    await afirmarSinFuga(res, 403, spies);
  });

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando el service lanza un error interno inesperado (500)", async () => {
    const spies = espiarConsola();
    const res = await handleGenerarPdfOrdenApi(req(url, "POST"), ID_ORDEN, {
      autenticar: async () => OK,
      resolucionService: {
        resolver: vi.fn(async () => ({
          status: "ok" as const,
          orden: { id: "orden-A", numGuia: 100234 },
          via: "num_guia" as const,
        })),
      },
      pdfService: pdfQueRevienta(),
    });
    await afirmarSinFuga(res, 500, spies);
    expect(spies.error).toHaveBeenCalled();
  });
});

describe("Feature 177 R5 — POST /api/ordenes/api-key/carga/{cargaId}/generate no filtra la key", () => {
  const url = `http://localhost/api/ordenes/api-key/carga/${ID_CARGA}/generate`;

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando la key es desconocida (401)", async () => {
    const spies = espiarConsola();
    const res = await handleCargaGenerateApi(req(url, "POST"), ID_CARGA, {
      autenticar: async () => DESCONOCIDA,
      pdfService: pdfQueRevienta(),
    });
    await afirmarSinFuga(res, 401, spies);
  });

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando el usuario o la key estan inactivos (403)", async () => {
    const spies = espiarConsola();
    const res = await handleCargaGenerateApi(req(url, "POST"), ID_CARGA, {
      autenticar: async () => INACTIVA,
      pdfService: pdfQueRevienta(),
    });
    await afirmarSinFuga(res, 403, spies);
  });

  it("no escribe la key ni su hash en cuerpo, headers ni console.* cuando el service lanza un error interno inesperado (500)", async () => {
    const spies = espiarConsola();
    const res = await handleCargaGenerateApi(req(url, "POST"), ID_CARGA, {
      autenticar: async () => OK,
      pdfService: pdfQueRevienta(),
    });
    await afirmarSinFuga(res, 500, spies);
    expect(spies.error).toHaveBeenCalled();
  });
});
