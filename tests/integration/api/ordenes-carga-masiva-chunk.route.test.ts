import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import {
  handleCargaMasivaChunk,
  type CargaMasivaChunkDeps,
} from "@/app/api/ordenes/carga-masiva/chunk/route";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IBulkOrdenService, BulkOrdenResult } from "@/lib/interfaces/services/IBulkOrdenService";
import type { BulkSummary } from "@/lib/types/carga-masiva";
import {
  CargaLoteAjenoError,
  CargaNombreDuplicadoError,
} from "@/lib/interfaces/repositories/IOrdenRepository";

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function okSummary(overrides: Partial<BulkSummary> = {}): BulkSummary {
  return {
    total: 1,
    creadas: 1,
    duplicadas: 0,
    conError: 0,
    filas: [{ fila: 1, numRemision: "REM-1", resultado: "creada", estatus: "en_preparacion" }],
    cargaId: "11111111-1111-4111-8111-111111111111", // feature 141/R27
    ...overrides,
  };
}

function fakeService(overrides: Partial<IBulkOrdenService> = {}): IBulkOrdenService {
  return {
    cargarMasiva: vi
      .fn()
      .mockResolvedValue({ status: "ok", summary: okSummary() } satisfies BulkOrdenResult),
    // Feature 88: exigido por IBulkOrdenService; no ejercitado por la vía sesión.
    cargarViaApi: vi.fn(),
    ...overrides,
  };
}

function deps(actor: Actor | null, service: IBulkOrdenService): CargaMasivaChunkDeps {
  return { getActor: async () => actor, bulkService: service };
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/ordenes/carga-masiva/chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROW = { num_remision: "REM-1", destinatario: "Ana", telefono: "099" };

describe("chunk: sin sesión -> 401", () => {
  it("no llama al service", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(jsonReq({ rows: [ROW] }), deps(null, service));
    expect(res.status).toBe(401);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("chunk: rol distinto de adminTienda -> 403", () => {
  it.each([MAESTRO, MENSAJERO, DESCONOCIDO])("rol %o", async (actor) => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(jsonReq({ rows: [ROW] }), deps(actor, service));
    expect(res.status).toBe(403);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

describe("chunk: adminTienda -> delega en el service", () => {
  it("dryRun por defecto false", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(jsonReq({ rows: [ROW] }), deps(TIENDA, service));
    expect(res.status).toBe(200);
    expect(service.cargarMasiva).toHaveBeenCalledWith(
      [ROW],
      TIENDA,
      { dryRun: false },
    );
  });

  it("propaga dryRun=true", async () => {
    const service = fakeService();
    await handleCargaMasivaChunk(jsonReq({ rows: [ROW], dryRun: true }), deps(TIENDA, service));
    expect(service.cargarMasiva).toHaveBeenCalledWith([ROW], TIENDA, { dryRun: true });
  });

  it("devuelve el summary del service", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(jsonReq({ rows: [ROW] }), deps(TIENDA, service));
    const body = await res.json();
    expect(body).toEqual(okSummary());
  });
});

describe("chunk: validación del cuerpo -> 422", () => {
  it("lote vacío", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(jsonReq({ rows: [] }), deps(TIENDA, service));
    expect(res.status).toBe(422);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });

  it("lote que excede el máximo por request", async () => {
    const service = fakeService();
    const rows = Array.from({ length: 6000 }, () => ROW);
    const res = await handleCargaMasivaChunk(jsonReq({ rows }), deps(TIENDA, service));
    expect(res.status).toBe(422);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });

  it("JSON inválido", async () => {
    const service = fakeService();
    const req = new Request("http://localhost/api/ordenes/carga-masiva/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ no-json",
    });
    const res = await handleCargaMasivaChunk(req, deps(TIENDA, service));
    expect(res.status).toBe(422);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});

// --- Feature 141: lote de carga masiva (R18/R19/R20/R24/R38/R41/R46) ---

const TOKEN_LOTE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("chunk: lote de carga masiva (feature 141)", () => {
  it("R15/R16: el primer chunk sin cargaId llega al service con cargaId undefined", async () => {
    const service = fakeService();
    await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], totalFiles: 500 }),
      deps(TIENDA, service),
    );
    expect(service.cargarMasiva).toHaveBeenCalledWith([ROW], TIENDA, {
      dryRun: false,
      cargaId: undefined,
      name: undefined,
      totalFiles: 500,
    });
  });

  it("R18: cargaId que no es UUID -> 422 de validacion, sin tocar el service", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], cargaId: "no-es-uuid" }),
      deps(TIENDA, service),
    );
    expect(res.status).toBe(422);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });

  it("R17/R29: cargaId UUID y totalFiles se propagan al service", async () => {
    const service = fakeService();
    await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], cargaId: TOKEN_LOTE, totalFiles: 500 }),
      deps(TIENDA, service),
    );
    expect(service.cargarMasiva).toHaveBeenCalledWith([ROW], TIENDA, {
      dryRun: false,
      cargaId: TOKEN_LOTE,
      name: undefined,
      totalFiles: 500,
    });
  });

  it("R29: totalFiles negativo -> 422 (entero >= 0)", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], totalFiles: -1 }),
      deps(TIENDA, service),
    );
    expect(res.status).toBe(422);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });

  it("R19: token de lote DESCONOCIDO o de otro usuario -> 403", async () => {
    const service = fakeService({
      cargarMasiva: vi.fn().mockRejectedValue(new CargaLoteAjenoError(TOKEN_LOTE)),
    });
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], cargaId: TOKEN_LOTE, totalFiles: 1 }),
      deps(TIENDA, service),
    );
    expect(res.status).toBe(403);
  });

  it("R20: `name` opcional se propaga al service", async () => {
    const service = fakeService();
    await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], name: "  carga de enero  ", totalFiles: 1 }),
      deps(TIENDA, service),
    );
    expect(service.cargarMasiva).toHaveBeenCalledWith([ROW], TIENDA, {
      dryRun: false,
      cargaId: undefined,
      name: "carga de enero", // el schema hace trim
      totalFiles: 1,
    });
  });

  it("R22: sin `name` el service lo recibe como undefined (el lote nace con NULL)", async () => {
    const service = fakeService();
    await handleCargaMasivaChunk(jsonReq({ rows: [ROW] }), deps(TIENDA, service));
    const opciones = (service.cargarMasiva as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(opciones.name).toBeUndefined();
  });

  it("R20: `name` vacio o demasiado largo -> 422 sin tocar el service", async () => {
    for (const name of ["   ", "x".repeat(121)]) {
      const service = fakeService();
      const res = await handleCargaMasivaChunk(
        jsonReq({ rows: [ROW], name }),
        deps(TIENDA, service),
      );
      expect(res.status).toBe(422);
      expect(service.cargarMasiva).not.toHaveBeenCalled();
    }
  });

  it("R24: nombre repetido del actor -> 409 con el nombre en el mensaje", async () => {
    const service = fakeService({
      cargarMasiva: vi.fn().mockRejectedValue(new CargaNombreDuplicadoError("enero")),
    });
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], name: "enero" }),
      deps(TIENDA, service),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("enero");
  });

  it("R38: la respuesta incluye el cargaId del summary", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], totalFiles: 1 }),
      deps(TIENDA, service),
    );
    const body = await res.json();
    expect(body.cargaId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("R38: dry-run devuelve cargaId null (no se creo lote)", async () => {
    const service = fakeService({
      cargarMasiva: vi
        .fn()
        .mockResolvedValue({ status: "ok", summary: okSummary({ cargaId: null }) }),
    });
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], dryRun: true }),
      deps(TIENDA, service),
    );
    const body = await res.json();
    expect(body.cargaId).toBeNull();
  });

  it("R46: `download_type` NO es parametro de esta via: se ignora y no llega al service", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], download_type: "individual" }),
      deps(TIENDA, service),
    );
    expect(res.status).toBe(200);
    const opciones = (service.cargarMasiva as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(opciones).not.toHaveProperty("download_type");
    expect(opciones).not.toHaveProperty("downloadType");
  });

  it("R41: la autorizacion no cambia — un rol no adminTienda sigue en 403", async () => {
    const service = fakeService();
    const res = await handleCargaMasivaChunk(
      jsonReq({ rows: [ROW], cargaId: TOKEN_LOTE, name: "enero", totalFiles: 1 }),
      deps(MAESTRO, service),
    );
    expect(res.status).toBe(403);
    expect(service.cargarMasiva).not.toHaveBeenCalled();
  });
});
