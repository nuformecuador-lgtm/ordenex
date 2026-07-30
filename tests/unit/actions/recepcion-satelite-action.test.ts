import { describe, it, expect, vi } from "vitest";
import { listarRecepcionSatelite, recibirPorQr, recibirLote } from "@/lib/actions/recepcion-satelite";
import type { IRecepcionSateliteService } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };

function buildService(overrides: Partial<IRecepcionSateliteService> = {}): IRecepcionSateliteService {
  return {
    listar: vi.fn(async () => ({
      status: "ok" as const,
      porRecibir: [],
      recibidas: [],
      porDevolver: [],
      enTransitoACentral: [], // Feature 139/R21: grupo informativo `devolviendo_a_bodega_central`
      devueltas: [], // Feature 100/T4.1: grupo `devuelta` por recuperar a bodega
      asignadas: [], // Feature 149/T6.3: grupo `por_recoger` de la zona (deshacer asignacion)
      zonaNombre: "Limon",
      sinZona: false,
    })),
    recibir: vi.fn(async () => ({
      status: "ok" as const,
      ordenId: "o1",
      estado: "en_bodega_satelite" as const,
    })),
    recibirLote: vi.fn(async () => ({ status: "ok" as const, recibidas: 0 })),
    ...overrides,
  };
}

const noActor = async () => null;
const actorAdmin = async () => ADMIN;

// --- unauthenticated en el borde (R3) ---

describe("R3: unauthenticated antes de tocar el service", () => {
  it("listar sin actor -> unauthenticated", async () => {
    const service = buildService();
    const r = await listarRecepcionSatelite({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("recibir sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.recibir).not.toHaveBeenCalled();
  });
});

// --- listar delega (R3/R4) ---

describe("listar delega en el service", () => {
  it("adminSatelite -> ok con las listas del service", async () => {
    const service = buildService();
    const r = await listarRecepcionSatelite({ service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    expect(service.listar).toHaveBeenCalledWith(ADMIN);
  });

  it("forbidden del service pasa como resultado de dominio", async () => {
    const service = buildService({ listar: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarRecepcionSatelite({ service, getActor: actorAdmin });
    expect(r.status).toBe("forbidden");
  });
});

// --- recibir: zod de borde (R16) + delegacion (R10) ---

describe("recibirPorQr — validacion de borde (R16) y delegacion (R10)", () => {
  it("R16: numGuia como texto (no numero) -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirPorQr({ numGuia: "10" }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: numGuia no entero positivo (0 / negativo / decimal) -> validation_error, sin service", async () => {
    const service = buildService();
    for (const numGuia of [0, -1, 1.5]) {
      const r = await recibirPorQr({ numGuia }, { service, getActor: actorAdmin });
      expect(r.status).toBe("validation_error");
    }
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: input sin numGuia (forma invalida, QR ilegible) -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await recibirPorQr({}, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: UUID escaneado (etiqueta antigua) -> validation_error, sin service (corte limpio)", async () => {
    const service = buildService();
    const r = await recibirPorQr(
      { numGuia: "3f1c7c2e-9a1a-4f0e-9d4a-2b6a1c9e5d33" },
      { service, getActor: actorAdmin },
    );
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R10: num_guia valido delega en el service con el numGuia y el actor", async () => {
    const service = buildService();
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    expect(service.recibir).toHaveBeenCalledWith(10, ADMIN);
  });

  it("resultados de dominio del service pasan tal cual (zona_ajena)", async () => {
    const service = buildService({ recibir: vi.fn(async () => ({ status: "zona_ajena" as const })) });
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin });
    expect(r.status).toBe("zona_ajena");
  });

  it("ya_recibida del service pasa tal cual (idempotente, R14)", async () => {
    const service = buildService({ recibir: vi.fn(async () => ({ status: "ya_recibida" as const })) });
    const r = await recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin });
    expect(r.status).toBe("ya_recibida");
  });
});

// --- recibirLote: borde (unauthenticated + zod) + delegacion (feature 63) ---

describe("recibirLote — borde y delegacion (feature 63)", () => {
  it("sin actor -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirLote({ ordenIds: ["o1"] }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.recibirLote).not.toHaveBeenCalled();
  });

  it("lote vacio (min 1) -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirLote({ ordenIds: [] }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibirLote).not.toHaveBeenCalled();
  });

  it("id vacio en el lote -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirLote({ ordenIds: ["o1", ""] }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibirLote).not.toHaveBeenCalled();
  });

  it("lote valido delega en el service con ordenIds y actor", async () => {
    const service = buildService({
      recibirLote: vi.fn(async () => ({ status: "ok" as const, recibidas: 2 })),
    });
    const r = await recibirLote({ ordenIds: ["o1", "o2"] }, { service, getActor: actorAdmin });
    expect(r).toEqual({ status: "ok", recibidas: 2 });
    expect(service.recibirLote).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] }, ADMIN);
  });

  it("resultados de dominio del service pasan tal cual (forbidden / sin_zona)", async () => {
    for (const dominio of ["forbidden", "sin_zona"] as const) {
      const service = buildService({ recibirLote: vi.fn(async () => ({ status: dominio })) });
      const r = await recibirLote({ ordenIds: ["o1"] }, { service, getActor: actorAdmin });
      expect(r.status).toBe(dominio);
    }
  });
});

// --- errores EXCEPCIONALES pasan por withErrorHandler ---

describe("withErrorHandler envuelve los cuerpos de las actions", () => {
  it("un error EXCEPCIONAL del service NO se propaga crudo", async () => {
    const service = buildService({
      recibir: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin })).rejects.toThrow(
      /AppErrorCode inesperado/,
    );
    await expect(recibirPorQr({ numGuia: 10 }, { service, getActor: actorAdmin })).rejects.not.toThrow(
      /^db down$/,
    );
  });
});
