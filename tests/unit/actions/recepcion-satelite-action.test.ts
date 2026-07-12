import { describe, it, expect, vi } from "vitest";
import { listarRecepcionSatelite, recibirPorQr } from "@/lib/actions/recepcion-satelite";
import type { IRecepcionSateliteService } from "@/lib/interfaces/services/IRecepcionSateliteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const ADMIN: Actor = { usuarioId: "as1", rol: "adminSatelite" };

function buildService(overrides: Partial<IRecepcionSateliteService> = {}): IRecepcionSateliteService {
  return {
    listar: vi.fn(async () => ({
      status: "ok" as const,
      porRecibir: [],
      recibidas: [],
      zonaNombre: "Limon",
      sinZona: false,
    })),
    recibir: vi.fn(async () => ({
      status: "ok" as const,
      ordenId: "o1",
      estado: "en_bodega_satelite" as const,
    })),
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
    const r = await recibirPorQr({ ordenId: "o1" }, { service, getActor: noActor });
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
  it("R16: ordenId vacio -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await recibirPorQr({ ordenId: "" }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: ordenId solo espacios (ilegible) -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await recibirPorQr({ ordenId: "   " }, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R16: input sin ordenId (forma invalida) -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await recibirPorQr({}, { service, getActor: actorAdmin });
    expect(r.status).toBe("validation_error");
    expect(service.recibir).not.toHaveBeenCalled();
  });

  it("R10: texto valido (orden.id) delega en el service con el ordenId (trim) y el actor", async () => {
    const service = buildService();
    const r = await recibirPorQr({ ordenId: "  o1  " }, { service, getActor: actorAdmin });
    expect(r.status).toBe("ok");
    expect(service.recibir).toHaveBeenCalledWith("o1", ADMIN);
  });

  it("resultados de dominio del service pasan tal cual (zona_ajena)", async () => {
    const service = buildService({ recibir: vi.fn(async () => ({ status: "zona_ajena" as const })) });
    const r = await recibirPorQr({ ordenId: "o1" }, { service, getActor: actorAdmin });
    expect(r.status).toBe("zona_ajena");
  });

  it("ya_recibida del service pasa tal cual (idempotente, R14)", async () => {
    const service = buildService({ recibir: vi.fn(async () => ({ status: "ya_recibida" as const })) });
    const r = await recibirPorQr({ ordenId: "o1" }, { service, getActor: actorAdmin });
    expect(r.status).toBe("ya_recibida");
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
    await expect(recibirPorQr({ ordenId: "o1" }, { service, getActor: actorAdmin })).rejects.toThrow(
      /AppErrorCode inesperado/,
    );
    await expect(recibirPorQr({ ordenId: "o1" }, { service, getActor: actorAdmin })).rejects.not.toThrow(
      /^db down$/,
    );
  });
});
