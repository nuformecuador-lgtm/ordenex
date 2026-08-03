// Feature 177 — T15: tests de integracion del handler de
// `POST /api/ordenes/api-key/carga/{cargaId}/generate` (sin DB: `deps` inyectados).
// Cubre R28, R29, R30, R31, R33, R34, R42 y R44.
import { describe, it, expect, vi } from "vitest";
import {
  handleCargaGenerateApi,
  type CargaGenerateApiDeps,
} from "@/app/api/ordenes/api-key/carga/[cargaId]/generate/route";
import * as cargaGenerateModule from "@/app/api/ordenes/api-key/carga/[cargaId]/generate/route";
import * as cargaModule88 from "@/app/api/ordenes/api-key/carga/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type {
  IApiPdfEtiquetaService,
  PdfEtiquetaResult,
} from "@/lib/interfaces/services/IApiPdfEtiquetaService";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const SECRETO = "ordx_secretovivo1234567890";
const CARGA_PROPIA = "11111111-1111-4111-8111-111111111111";
const CARGA_AJENA = "22222222-2222-4222-8222-222222222222";
const CARGA_INEXISTENTE = "33333333-3333-4333-8333-333333333333";

function fakePdfService(result: PdfEtiquetaResult): IApiPdfEtiquetaService {
  return { porOrden: vi.fn(), porCarga: vi.fn().mockResolvedValue(result) };
}

function deps(auth: ApiKeyAuthResult, service: IApiPdfEtiquetaService): CargaGenerateApiDeps {
  return { autenticar: async () => auth, pdfService: service };
}

const AUTH_OK: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };

function req(bearer?: string, cargaId = CARGA_PROPIA): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(`http://localhost/api/ordenes/api-key/carga/${cargaId}/generate`, {
    method: "POST",
    headers,
  });
}

function reqConHeader(authorization: string): Request {
  return new Request(`http://localhost/api/ordenes/api-key/carga/${CARGA_PROPIA}/generate`, {
    method: "POST",
    headers: { Authorization: authorization },
  });
}

describe("POST /api/ordenes/api-key/carga/[cargaId]/generate — exito (R28/R30/R31)", () => {
  it("R28/R30: 200 con url, expiraEnSegundos y generado:true cuando se genera el consolidado", async () => {
    const service = fakePdfService({
      status: "ok",
      url: "https://proyecto.supabase.co/storage/v1/object/sign/etiquetas-guia/lote.pdf",
      expiraEnSegundos: 300,
      generado: true,
    });
    const res = await handleCargaGenerateApi(req(SECRETO), CARGA_PROPIA, deps(AUTH_OK, service));

    expect(res.status).toBe(200);
    const json = await res.json();
    // R28: la forma es EXACTAMENTE la del endpoint por orden: 3 claves, ni una mas.
    expect(Object.keys(json).sort()).toEqual(["expiraEnSegundos", "generado", "url"]);
    expect(json).toEqual({
      url: "https://proyecto.supabase.co/storage/v1/object/sign/etiquetas-guia/lote.pdf",
      expiraEnSegundos: 300,
      generado: true,
    });
    // R29/R4: el owner sale del actor autenticado, nunca de la peticion.
    expect(service.porCarga).toHaveBeenCalledWith(ACTOR, CARGA_PROPIA);
  });

  it("R28/R31: 200 con generado:false cuando el consolidado ya existia y solo se re-firma", async () => {
    const service = fakePdfService({
      status: "ok",
      url: "https://proyecto.supabase.co/storage/v1/object/sign/etiquetas-guia/lote.pdf?v=2",
      expiraEnSegundos: 300,
      generado: false,
    });
    const res = await handleCargaGenerateApi(req(SECRETO), CARGA_PROPIA, deps(AUTH_OK, service));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["expiraEnSegundos", "generado", "url"]);
    expect(json.generado).toBe(false);
    expect(json.expiraEnSegundos).toBe(300);
    expect(json.url).toContain("sign/");
  });
});

describe("POST /api/ordenes/api-key/carga/[cargaId]/generate — 404 (R29)", () => {
  it("R29: 404 cuando la carga es de otro owner", async () => {
    const service = fakePdfService({ status: "not_found" });
    const res = await handleCargaGenerateApi(
      req(SECRETO, CARGA_AJENA),
      CARGA_AJENA,
      deps(AUTH_OK, service),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe("NOT_FOUND");
  });

  it("R29: 404 de carga inexistente con cuerpo BYTE-IDENTICO al de la carga ajena", async () => {
    const ajena = await handleCargaGenerateApi(
      req(SECRETO, CARGA_AJENA),
      CARGA_AJENA,
      deps(AUTH_OK, fakePdfService({ status: "not_found" })),
    );
    const inexistente = await handleCargaGenerateApi(
      req(SECRETO, CARGA_INEXISTENTE),
      CARGA_INEXISTENTE,
      deps(AUTH_OK, fakePdfService({ status: "not_found" })),
    );

    expect(inexistente.status).toBe(ajena.status);
    const cuerpoAjena = await ajena.text();
    const cuerpoInexistente = await inexistente.text();
    // Ni un byte de diferencia: no se filtra la existencia de lotes ajenos.
    expect(cuerpoInexistente).toBe(cuerpoAjena);
    expect(cuerpoInexistente).not.toMatch(new RegExp(CARGA_INEXISTENTE));
  });
});

describe("POST /api/ordenes/api-key/carga/[cargaId]/generate — 409 (R33/R34/R42)", () => {
  it("R33: 409 CONFLICT cuando el lote no tiene ninguna etiqueta imprimible", async () => {
    const service = fakePdfService({ status: "sin_etiqueta" });
    const res = await handleCargaGenerateApi(req(SECRETO), CARGA_PROPIA, deps(AUTH_OK, service));
    expect(res.status).toBe(409);
    const json = await res.json();
    // R42: shape uniforme del manejador global (status/code/message) con codigos EXISTENTES.
    expect(json.status).toBe("error");
    expect(json.code).toBe("CONFLICT");
    expect(typeof json.message).toBe("string");
  });

  it("R34: 409 CONFLICT cuando el lote excede el tope de etiquetas por PDF", async () => {
    const service = fakePdfService({ status: "excede_tope" });
    const res = await handleCargaGenerateApi(req(SECRETO), CARGA_PROPIA, deps(AUTH_OK, service));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("CONFLICT");
  });
});

describe("POST /api/ordenes/api-key/carga/[cargaId]/generate — 422 (R42)", () => {
  it("R42: 422 VALIDATION_ERROR con un cargaId que no es uuid, sin invocar el service", async () => {
    const service = fakePdfService({
      status: "ok",
      url: "https://x",
      expiraEnSegundos: 300,
      generado: true,
    });
    const res = await handleCargaGenerateApi(
      req(SECRETO, "no-es-uuid"),
      "no-es-uuid",
      deps(AUTH_OK, service),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(service.porCarga).not.toHaveBeenCalled();
  });

  it("R42: 422 con el name del lote (identificador plausible pero no uuid), sin invocar el service", async () => {
    const service = fakePdfService({
      status: "ok",
      url: "https://x",
      expiraEnSegundos: 300,
      generado: true,
    });
    // "LOTE-2026-07-22" es el `name` de la carga: identificador plausible para un integrador
    // despistado, pero NO es el uuid publicado como `cargaId`. Debe cortarse en el borde.
    const res = await handleCargaGenerateApi(
      req(SECRETO, "LOTE-2026-07-22"),
      "LOTE-2026-07-22",
      deps(AUTH_OK, service),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
    expect(service.porCarga).toHaveBeenCalledTimes(0);
  });
});

describe("POST /api/ordenes/api-key/carga/[cargaId]/generate — auth (R42)", () => {
  it("R42: 401 sin header Authorization, sin invocar el service", async () => {
    const service = fakePdfService({ status: "not_found" });
    const res = await handleCargaGenerateApi(
      req(),
      CARGA_PROPIA,
      deps({ status: "unauthenticated" }, service),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
    expect(service.porCarga).not.toHaveBeenCalled();
  });

  it("R42: 401 con esquema distinto de Bearer y con token vacio", async () => {
    const service = fakePdfService({ status: "not_found" });
    const capturadas: (string | null)[] = [];
    const auth = async (rawKey: string | null): Promise<ApiKeyAuthResult> => {
      capturadas.push(rawKey);
      return { status: "unauthenticated" };
    };

    const basic = await handleCargaGenerateApi(reqConHeader(`Basic ${SECRETO}`), CARGA_PROPIA, {
      autenticar: auth,
      pdfService: service,
    });
    const vacio = await handleCargaGenerateApi(reqConHeader("Bearer    "), CARGA_PROPIA, {
      autenticar: auth,
      pdfService: service,
    });

    expect(basic.status).toBe(401);
    expect(vacio.status).toBe(401);
    // El esquema no-Bearer y el token vacio llegan al autenticador como "sin key".
    expect(capturadas).toEqual([null, null]);
    expect(service.porCarga).not.toHaveBeenCalled();
  });

  it("R42: 403 cuando el usuario o la key no estan activos, sin invocar el service", async () => {
    const service = fakePdfService({ status: "not_found" });
    const res = await handleCargaGenerateApi(
      req(SECRETO),
      CARGA_PROPIA,
      deps({ status: "forbidden" }, service),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(service.porCarga).not.toHaveBeenCalled();
  });
});

describe("POST /api/ordenes/api-key/carga/[cargaId]/generate — solo POST (R44)", () => {
  it("R44: el modulo de ruta no exporta GET", () => {
    expect(typeof (cargaGenerateModule as Record<string, unknown>).GET).toBe("undefined");
  });

  it("R44: POST es el UNICO verbo HTTP exportado por el modulo", () => {
    const VERBOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    const exportados = VERBOS.filter(
      (v) => typeof (cargaGenerateModule as Record<string, unknown>)[v] !== "undefined",
    );
    expect(exportados).toEqual(["POST"]);
    expect(typeof cargaGenerateModule.POST).toBe("function");
  });
});

describe("no-regresion feature 88 — POST /api/ordenes/api-key/carga", () => {
  it("R44/88: el modulo de la carga por API key sigue exportando solo POST y su handler", () => {
    const VERBOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    const exportados = VERBOS.filter(
      (v) => typeof (cargaModule88 as Record<string, unknown>)[v] !== "undefined",
    );
    expect(exportados).toEqual(["POST"]);
    expect(typeof cargaModule88.handleCargaApi).toBe("function");
  });
});
