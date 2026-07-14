import { describe, it, expect, vi } from "vitest";
import {
  crearPlantillaAction,
  actualizarPlantillaAction,
  setActivaPlantillaAction,
  listarPlantillasAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoPlantillaService } from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R17/R18/R24/R25/R26) — tests unit de las Server Actions de plantillas. Sin sesion
// -> unauthenticated (R18); rol no autorizado -> forbidden (lo decide el service, R17); zod en
// el borde -> validation_error (concepto vacio / monto <=0, R24). DTOs STRING (R12).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };
const UUID = "11111111-1111-4111-8111-111111111111";

function plantilla(): GastoFijoPlantillaDTO {
  return {
    id: UUID,
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
  };
}

function fakeService(overrides: Partial<IGastoFijoPlantillaService> = {}): IGastoFijoPlantillaService {
  return {
    crearPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    actualizarPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    setActivaPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: plantilla() })),
    listarPlantillas: vi.fn(async () => ({ status: "ok" as const, plantillas: [plantilla()] })),
    ...overrides,
  };
}

describe("crearPlantillaAction (R17/R18/R24)", () => {
  it("R18: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.crearPlantilla).not.toHaveBeenCalled();
  });

  it("R17: rol no autorizado -> forbidden (lo decide el service)", async () => {
    const service = fakeService({ crearPlantilla: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => OTRO },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R24: concepto vacio -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "   ", monto: "80000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crearPlantilla).not.toHaveBeenCalled();
  });

  it("R24: monto no positivo -> validation_error", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "0" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
  });

  it("R24: maestro con datos validos -> ok, plantilla con monto STRING", async () => {
    const service = fakeService();
    const r = await crearPlantillaAction(
      { concepto: "Alquiler", monto: "80000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantilla.monto).toBe("string");
  });
});

describe("actualizarPlantillaAction (R18/R25)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("id no-uuid -> validation_error", async () => {
    const service = fakeService();
    const r = await actualizarPlantillaAction(
      { id: "no-uuid", concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizarPlantilla).not.toHaveBeenCalled();
  });

  it("not_found se propaga desde el service", async () => {
    const service = fakeService({ actualizarPlantilla: vi.fn(async () => ({ status: "not_found" as const })) });
    const r = await actualizarPlantillaAction(
      { id: UUID, concepto: "Alquiler", monto: "85000.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "not_found" });
  });
});

describe("setActivaPlantillaAction (R18/R25)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await setActivaPlantillaAction(
      { id: UUID, activa: false },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("activa no booleana -> validation_error", async () => {
    const service = fakeService();
    const r = await setActivaPlantillaAction(
      { id: UUID, activa: "no" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.setActivaPlantilla).not.toHaveBeenCalled();
  });

  it("R25: desactivar -> ok", async () => {
    const service = fakeService();
    const r = await setActivaPlantillaAction(
      { id: UUID, activa: false },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
  });
});

describe("listarPlantillasAction (R17/R18/R26)", () => {
  it("R18: sin sesion -> unauthenticated", async () => {
    const service = fakeService();
    const r = await listarPlantillasAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("R17: rol no autorizado -> forbidden", async () => {
    const service = fakeService({ listarPlantillas: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await listarPlantillasAction({ service, getActor: async () => OTRO });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R26: maestro -> ok con plantillas (monto STRING)", async () => {
    const service = fakeService();
    const r = await listarPlantillasAction({ service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantillas[0].monto).toBe("string");
  });
});
