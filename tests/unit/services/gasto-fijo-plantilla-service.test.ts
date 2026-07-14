import { describe, it, expect, vi } from "vitest";
import { GastoFijoPlantillaService } from "@/lib/services/GastoFijoPlantillaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoPlantillaRepository } from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R17/R24/R25/R26) — tests unit del GastoFijoPlantillaService. Guardia de rol
// maestro en TODOS los metodos; crear/editar/activar/desactivar/listar; not_found cuando el id
// no existe; SIN metodo de borrado (R25 — la desactivacion es el mecanismo). Montos STRING.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-1",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

function buildRepo(overrides: Partial<IGastoFijoPlantillaRepository> = {}): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn().mockResolvedValue(plantilla()),
    actualizar: vi.fn().mockResolvedValue(plantilla({ concepto: "Alquiler oficina" })),
    setActiva: vi.fn().mockResolvedValue(plantilla({ activa: false })),
    listar: vi.fn().mockResolvedValue([plantilla(), plantilla({ id: "p-2", activa: false })]),
    listarActivas: vi.fn().mockResolvedValue([plantilla()]),
    obtenerPorId: vi.fn().mockResolvedValue(plantilla()),
    ...overrides,
  };
}

describe("GastoFijoPlantillaService.crearPlantilla (R17/R24)", () => {
  it("R17: rol no autorizado -> forbidden, sin crear", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00" }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("R24: maestro -> crea la plantilla; monto STRING", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00" }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantilla.monto).toBe("string");
    expect(repo.crear).toHaveBeenCalledWith({ concepto: "Alquiler", monto: "80000.00" });
  });
});

describe("GastoFijoPlantillaService.actualizarPlantilla (R17/R25)", () => {
  it("R17: rol no autorizado -> forbidden", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla({ id: "p-1", concepto: "x", monto: "10.00" }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("not_found: el id no existe -> not_found, sin actualizar", async () => {
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla({ id: "no", concepto: "x", monto: "10.00" }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("R25: maestro -> edita concepto/monto", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla(
      { id: "p-1", concepto: "Alquiler oficina", monto: "85000.00" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(repo.actualizar).toHaveBeenCalledWith("p-1", { concepto: "Alquiler oficina", monto: "85000.00" });
  });
});

describe("GastoFijoPlantillaService.setActivaPlantilla (R17/R25)", () => {
  it("R17: rol no autorizado -> forbidden", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.setActivaPlantilla({ id: "p-1", activa: false }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.setActiva).not.toHaveBeenCalled();
  });

  it("R25: desactivar (activa=false) -> ok (sin borrado)", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.setActivaPlantilla({ id: "p-1", activa: false }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.plantilla.activa).toBe(false);
    expect(repo.setActiva).toHaveBeenCalledWith("p-1", false);
  });

  it("not_found: id inexistente", async () => {
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.setActivaPlantilla({ id: "no", activa: true }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
  });
});

describe("GastoFijoPlantillaService.listarPlantillas (R17/R26)", () => {
  it("R17: rol no autorizado -> forbidden, sin listar", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.listarPlantillas(OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it("R26: maestro -> lista activas e inactivas", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.listarPlantillas(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.plantillas).toHaveLength(2);
    expect(r.plantillas.some((p) => p.activa)).toBe(true);
    expect(r.plantillas.some((p) => !p.activa)).toBe(true);
  });
});

describe("GastoFijoPlantillaService — sin borrado (R25)", () => {
  it("R25: el service NO expone metodo de borrado", () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    expect((svc as unknown as Record<string, unknown>).borrar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).eliminar).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).delete).toBeUndefined();
    // R25: el repo tampoco expone delete de plantillas.
    expect((repo as unknown as Record<string, unknown>).borrar).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
