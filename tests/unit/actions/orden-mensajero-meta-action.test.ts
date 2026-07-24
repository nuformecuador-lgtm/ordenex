import { describe, it, expect, vi } from "vitest";
import { marcarGestionarLuego } from "@/lib/actions/orden-mensajero-meta";
import { marcarLuegoSchema } from "@/lib/types/orden-mensajero-meta";
import type { IOrdenMensajeroMetaService } from "@/lib/interfaces/services/IOrdenMensajeroMetaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MarcarLuegoResult } from "@/lib/types/orden-mensajero-meta";

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const noActor = async () => null;
const actorMensajero = async () => MENSAJERO;

function buildService(result: MarcarLuegoResult = { status: "ok", ordenId: "o1", marcarLuego: true }): IOrdenMensajeroMetaService {
  return { marcarGestionarLuego: vi.fn(async () => result) };
}

// --- T2: schema zod (R9) ---

describe("T2/R9 — marcarLuegoSchema", () => {
  it("acepta ordenId no vacio + marcarLuego booleano", () => {
    expect(marcarLuegoSchema.safeParse({ ordenId: "o1", marcarLuego: true }).success).toBe(true);
    expect(marcarLuegoSchema.safeParse({ ordenId: "o1", marcarLuego: false }).success).toBe(true);
  });

  it("R9: rechaza ordenId vacio", () => {
    expect(marcarLuegoSchema.safeParse({ ordenId: "", marcarLuego: true }).success).toBe(false);
  });

  it("R9: rechaza marcarLuego no booleano", () => {
    expect(marcarLuegoSchema.safeParse({ ordenId: "o1", marcarLuego: "true" }).success).toBe(false);
    expect(marcarLuegoSchema.safeParse({ ordenId: "o1" }).success).toBe(false);
  });
});

// --- T5: borde de la Server Action ---

describe("T5/R10 — unauthenticated antes de tocar el service", () => {
  it("sin actor -> unauthenticated, sin llamar al service ni parsear negocio", async () => {
    const service = buildService();
    const r = await marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.marcarGestionarLuego).not.toHaveBeenCalled();
  });
});

describe("T5/R9 — validation_error via zod", () => {
  it("R9: ordenId vacio -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await marcarGestionarLuego({ ordenId: "", marcarLuego: true }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.marcarGestionarLuego).not.toHaveBeenCalled();
  });

  it("R9: marcarLuego no booleano -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await marcarGestionarLuego({ ordenId: "o1", marcarLuego: 1 }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.marcarGestionarLuego).not.toHaveBeenCalled();
  });
});

describe("T5 — happy path delega en el service con el actor y el input parseado", () => {
  it("marca valida -> ok y delega con (data, actor)", async () => {
    const service = buildService({ status: "ok", ordenId: "o1", marcarLuego: true });
    const r = await marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, { service, getActor: actorMensajero });
    expect(r).toEqual({ status: "ok", ordenId: "o1", marcarLuego: true });
    expect(service.marcarGestionarLuego).toHaveBeenCalledWith({ ordenId: "o1", marcarLuego: true }, MENSAJERO);
  });
});

describe("T5/R11/R13/R14 — propaga los resultados de dominio del service", () => {
  it("R11: propaga forbidden (rol no mensajero)", async () => {
    const service = buildService({ status: "forbidden" });
    const r = await marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, { service, getActor: actorMensajero });
    expect(r.status).toBe("forbidden");
  });

  it("R13: propaga forbidden (orden ajena)", async () => {
    const service = buildService({ status: "forbidden" });
    const r = await marcarGestionarLuego({ ordenId: "o1", marcarLuego: false }, { service, getActor: actorMensajero });
    expect(r.status).toBe("forbidden");
  });

  it("R14: propaga not_found (orden inexistente/borrada)", async () => {
    const service = buildService({ status: "not_found" });
    const r = await marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, { service, getActor: actorMensajero });
    expect(r.status).toBe("not_found");
  });
});

describe("T5/menor — withErrorHandler envuelve el cuerpo de la action", () => {
  it("un error EXCEPCIONAL del service NO se propaga crudo (pasa por el manejador)", async () => {
    const service: IOrdenMensajeroMetaService = {
      marcarGestionarLuego: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    // El manejador normaliza a INTERNAL; el traductor re-lanza como AppErrorCode inesperado.
    // Lo relevante: el "db down" crudo NO escapa sin pasar por withErrorHandler.
    await expect(
      marcarGestionarLuego({ ordenId: "o1", marcarLuego: true }, { service, getActor: actorMensajero }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});
