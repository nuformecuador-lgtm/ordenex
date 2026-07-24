import { describe, it, expect, vi } from "vitest";
import { guardarNotaPrivada, limpiarNotaPrivada } from "@/lib/actions/notas-privadas-mensajero";
import {
  guardarNotaSchema,
  limpiarNotaSchema,
  NOTA_MAX,
} from "@/lib/types/nota-privada-mensajero";
import type { INotaPrivadaMensajeroService } from "@/lib/interfaces/services/INotaPrivadaMensajeroService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GuardarNotaResult, LimpiarNotaResult } from "@/lib/types/nota-privada-mensajero";

// Feature 116 — D1: borde de las Server Actions (R10/R13). No se levanta sesion real: el actor
// se inyecta via `getActor` y el service via `service` (DI, patron de mis-asignaciones.ts).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const noActor = async () => null;
const actorMensajero = async () => MENSAJERO;

const ORDEN = "11111111-1111-4111-8111-111111111111";

function guardarService(result: GuardarNotaResult = { status: "ok", nota: "x" }): INotaPrivadaMensajeroService {
  return {
    guardar: vi.fn(async () => result),
    limpiar: vi.fn(async () => ({ status: "ok" }) as LimpiarNotaResult),
  };
}

function limpiarService(result: LimpiarNotaResult = { status: "ok" }): INotaPrivadaMensajeroService {
  return {
    guardar: vi.fn(async () => ({ status: "ok", nota: null }) as GuardarNotaResult),
    limpiar: vi.fn(async () => result),
  };
}

// --- A1/R13: schemas zod ---

describe("A1/R13 — guardarNotaSchema", () => {
  it("acepta ordenId uuid + nota dentro del maximo", () => {
    expect(guardarNotaSchema.safeParse({ ordenId: ORDEN, nota: "hola" }).success).toBe(true);
    expect(guardarNotaSchema.safeParse({ ordenId: ORDEN, nota: "" }).success).toBe(true); // vacia: la limpia el service
  });

  it("R13: rechaza ordenId ausente o mal formado", () => {
    expect(guardarNotaSchema.safeParse({ nota: "x" }).success).toBe(false);
    expect(guardarNotaSchema.safeParse({ ordenId: "no-uuid", nota: "x" }).success).toBe(false);
  });

  it("R13: rechaza nota que excede el maximo", () => {
    const larga = "a".repeat(NOTA_MAX + 1);
    expect(guardarNotaSchema.safeParse({ ordenId: ORDEN, nota: larga }).success).toBe(false);
    expect(guardarNotaSchema.safeParse({ ordenId: ORDEN, nota: "a".repeat(NOTA_MAX) }).success).toBe(true);
  });
});

describe("A1/R13 — limpiarNotaSchema", () => {
  it("acepta ordenId uuid; rechaza ausente/mal formado", () => {
    expect(limpiarNotaSchema.safeParse({ ordenId: ORDEN }).success).toBe(true);
    expect(limpiarNotaSchema.safeParse({ ordenId: "no-uuid" }).success).toBe(false);
    expect(limpiarNotaSchema.safeParse({}).success).toBe(false);
  });
});

// --- D1/R10: unauthenticated antes de tocar el service ---

describe("D1/R10 — sin sesion -> unauthenticated, sin tocar el service", () => {
  it("guardar sin actor -> unauthenticated", async () => {
    const service = guardarService();
    const r = await guardarNotaPrivada({ ordenId: ORDEN, nota: "x" }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("limpiar sin actor -> unauthenticated", async () => {
    const service = limpiarService();
    const r = await limpiarNotaPrivada({ ordenId: ORDEN }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.limpiar).not.toHaveBeenCalled();
  });
});

// --- D1/R13: validation_error via zod, sin efectos ---

describe("D1/R13 — validation_error via zod, sin tocar el service", () => {
  it("guardar con ordenId mal formado -> validation_error", async () => {
    const service = guardarService();
    const r = await guardarNotaPrivada({ ordenId: "no-uuid", nota: "x" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("guardar con nota sobre el maximo -> validation_error", async () => {
    const service = guardarService();
    const r = await guardarNotaPrivada(
      { ordenId: ORDEN, nota: "a".repeat(NOTA_MAX + 1) },
      { service, getActor: actorMensajero },
    );
    expect(r.status).toBe("validation_error");
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("limpiar con ordenId mal formado -> validation_error", async () => {
    const service = limpiarService();
    const r = await limpiarNotaPrivada({ ordenId: "no-uuid" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.limpiar).not.toHaveBeenCalled();
  });
});

// --- D1: happy path y propagacion de resultados de dominio ---

describe("D1 — happy path delega en el service con (ordenId, nota, actor)", () => {
  it("guardar valido -> ok y delega con el input parseado", async () => {
    const service = guardarService({ status: "ok", nota: "hola" });
    const r = await guardarNotaPrivada({ ordenId: ORDEN, nota: "hola" }, { service, getActor: actorMensajero });
    expect(r).toEqual({ status: "ok", nota: "hola" });
    expect(service.guardar).toHaveBeenCalledWith(ORDEN, "hola", MENSAJERO);
  });

  it("limpiar valido -> ok y delega con (ordenId, actor)", async () => {
    const service = limpiarService({ status: "ok" });
    const r = await limpiarNotaPrivada({ ordenId: ORDEN }, { service, getActor: actorMensajero });
    expect(r).toEqual({ status: "ok" });
    expect(service.limpiar).toHaveBeenCalledWith(ORDEN, MENSAJERO);
  });
});

describe("D1/R10/R16 — propaga los resultados de dominio del service", () => {
  it("R10: propaga forbidden del service (rol no mensajero)", async () => {
    const service = guardarService({ status: "forbidden" });
    const r = await guardarNotaPrivada({ ordenId: ORDEN, nota: "x" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("forbidden");
  });

  it("R16: propaga forbidden del service (orden inexistente por la FK)", async () => {
    const service = guardarService({ status: "forbidden" });
    const r = await guardarNotaPrivada({ ordenId: ORDEN, nota: "x" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("forbidden");
  });
});

describe("D1/menor — withErrorHandler envuelve el cuerpo de la action", () => {
  it("un error EXCEPCIONAL del service NO se propaga crudo (pasa por el manejador)", async () => {
    const service: INotaPrivadaMensajeroService = {
      guardar: vi.fn(async () => {
        throw new Error("db down");
      }),
      limpiar: vi.fn(async (): Promise<LimpiarNotaResult> => ({ status: "ok" })),
    };
    await expect(
      guardarNotaPrivada({ ordenId: ORDEN, nota: "x" }, { service, getActor: actorMensajero }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});
