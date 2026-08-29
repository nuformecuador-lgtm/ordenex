import { describe, it, expect, vi } from "vitest";
import { GastoFijoPlantillaService } from "@/lib/services/GastoFijoPlantillaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarPlantillaInput,
  IGastoFijoPlantillaRepository,
} from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 45 (R17/R24/R25/R26) — tests unit del GastoFijoPlantillaService. Guardia de rol
// maestro en TODOS los metodos; crear/editar/activar/desactivar/listar; not_found cuando el id
// no existe; SIN metodo de borrado (R25 — la desactivacion es el mecanismo). Montos STRING.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" }; // feature 94: paridad con maestro
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function plantilla(overrides: Partial<GastoFijoPlantillaDTO> = {}): GastoFijoPlantillaDTO {
  return {
    id: "p-1",
    concepto: "Alquiler",
    monto: "80000.00",
    activa: true,
    periodicidadUnidad: "meses",
    periodicidadCantidad: 1,
    fechaCobro: "2026-07-13",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

// Feature 84: la periodicidad llega SIEMPRE resuelta desde el borde (el schema zod aplica los
// defaults), asi que el service la reenvia tal cual al repo.
const PERIODICIDAD = {
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-13",
} as const;

function buildRepo(overrides: Partial<IGastoFijoPlantillaRepository> = {}): IGastoFijoPlantillaRepository {
  return {
    crear: vi.fn().mockResolvedValue(plantilla()),
    actualizar: vi.fn().mockResolvedValue(plantilla({ concepto: "Alquiler oficina" })),
    setActiva: vi.fn().mockResolvedValue(plantilla({ activa: false })),
    listar: vi.fn().mockResolvedValue([plantilla(), plantilla({ id: "p-2", activa: false })]),
    listarActivas: vi.fn().mockResolvedValue([plantilla()]),
    // Feature 170 (T I.1): el listado paginado vive en su propia suite (*-paginado).
    listarPaginado: vi.fn().mockResolvedValue({ items: [plantilla()], total: 1 }),
    obtenerPorId: vi.fn().mockResolvedValue(plantilla()),
    ...overrides,
  };
}

describe("GastoFijoPlantillaService.crearPlantilla (R17/R24)", () => {
  it("R17: rol no autorizado -> forbidden, sin crear", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> crea la plantilla (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.crear).toHaveBeenCalled();
  });

  it("R24: maestro -> crea la plantilla; monto STRING", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.crearPlantilla({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.plantilla.monto).toBe("string");
    expect(repo.crear).toHaveBeenCalledWith({ concepto: "Alquiler", monto: "80000.00", ...PERIODICIDAD });
  });
});

describe("GastoFijoPlantillaService.actualizarPlantilla (R17/R25)", () => {
  it("R17: rol no autorizado -> forbidden", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla({ id: "p-1", concepto: "x", monto: "10.00", ...PERIODICIDAD }, OTRO);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("not_found: el id no existe -> not_found, sin actualizar", async () => {
    const repo = buildRepo({ obtenerPorId: vi.fn().mockResolvedValue(null) });
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla({ id: "no", concepto: "x", monto: "10.00", ...PERIODICIDAD }, MAESTRO);
    expect(r).toEqual({ status: "not_found" });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it("feature 94: admin -> edita la plantilla (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla(
      { id: "p-1", concepto: "Alquiler oficina", monto: "85000.00", ...PERIODICIDAD },
      ADMIN,
    );
    expect(r.status).toBe("ok");
    expect(repo.actualizar).toHaveBeenCalled();
  });

  it("R25: maestro -> edita concepto/monto", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.actualizarPlantilla(
      { id: "p-1", concepto: "Alquiler oficina", monto: "85000.00", ...PERIODICIDAD },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(repo.actualizar).toHaveBeenCalledWith("p-1", {
      concepto: "Alquiler oficina",
      monto: "85000.00",
      ...PERIODICIDAD,
    });
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

  it("feature 94: admin -> activa/desactiva la plantilla (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.setActivaPlantilla({ id: "p-1", activa: false }, ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.setActiva).toHaveBeenCalledWith("p-1", false);
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

  it("feature 94: admin -> lista plantillas (paridad con maestro)", async () => {
    const repo = buildRepo();
    const svc = new GastoFijoPlantillaService(repo);
    const r = await svc.listarPlantillas(ADMIN);
    expect(r.status).toBe("ok");
    expect(repo.listar).toHaveBeenCalled();
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

// ── Feature 85 (R2) — editar el monto NO mueve el ciclo ──
//
// El doble de repositorio de arriba solo recuerda CON QUE se le llamo. Este otro tiene ESTADO y
// escribe como escribe el repositorio real (`update` con los cinco campos, sin condicion), de
// modo que la fila que se inspecciona al final es la que habria quedado en la tabla.
//
// Los literales `semanas`/`2`/`2026-03-31` estan elegidos a proposito: ninguno coincide con los
// defaults del schema de crear (`meses`/`1`/hoy-CR), asi que este test NO puede estar verde por
// construccion —si algo reinventara el ciclo, la fila guardada no diria esto—.
describe("GastoFijoPlantillaService.actualizarPlantilla — persistencia del ciclo (R2, feature 85)", () => {
  function repoConEstado(semilla: GastoFijoPlantillaDTO) {
    const fila: GastoFijoPlantillaDTO = { ...semilla };
    const repo = buildRepo({
      obtenerPorId: vi.fn(async () => ({ ...fila })),
      actualizar: vi.fn(async (_id: string, input: ActualizarPlantillaInput) => {
        // Espejo de `GastoFijoPlantillaRepository.actualizar`: escribe los cinco campos.
        fila.concepto = input.concepto;
        fila.monto = input.monto;
        fila.periodicidadUnidad = input.periodicidadUnidad;
        fila.periodicidadCantidad = input.periodicidadCantidad;
        fila.fechaCobro = input.fechaCobro;
        return { ...fila };
      }),
    });
    return { repo, filaGuardada: () => ({ ...fila }) };
  }

  it("editar el monto no mueve el ciclo: el repositorio recibe semanas/2/2026-03-31", async () => {
    const { repo, filaGuardada } = repoConEstado(
      plantilla({
        id: "p-ciclo",
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
      }),
    );
    const svc = new GastoFijoPlantillaService(repo);

    const r = await svc.actualizarPlantilla(
      {
        id: "p-ciclo",
        concepto: "Alquiler",
        monto: "999.00",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");

    const fila = filaGuardada();
    expect(fila.monto).toBe("999.00"); // lo unico que cambio
    expect(fila.periodicidadUnidad).toBe("semanas");
    expect(fila.periodicidadCantidad).toBe(2);
    expect(fila.fechaCobro).toBe("2026-03-31");

    // Y lo mismo en el contrato con el repositorio, con literales: nada de `...PERIODICIDAD`.
    expect(repo.actualizar).toHaveBeenCalledWith("p-ciclo", {
      concepto: "Alquiler",
      monto: "999.00",
      periodicidadUnidad: "semanas",
      periodicidadCantidad: 2,
      fechaCobro: "2026-03-31",
    });
  });

  it("cambiar el ciclo A PROPOSITO si lo mueve (la ficha no congela el ciclo, cierra el reset mudo)", async () => {
    const { repo, filaGuardada } = repoConEstado(
      plantilla({
        id: "p-ciclo",
        periodicidadUnidad: "semanas",
        periodicidadCantidad: 2,
        fechaCobro: "2026-03-31",
      }),
    );
    const svc = new GastoFijoPlantillaService(repo);

    await svc.actualizarPlantilla(
      {
        id: "p-ciclo",
        concepto: "Alquiler",
        monto: "80000.00",
        periodicidadUnidad: "meses",
        periodicidadCantidad: 1,
        fechaCobro: "2026-04-01",
      },
      MAESTRO,
    );

    const fila = filaGuardada();
    expect(fila.periodicidadUnidad).toBe("meses");
    expect(fila.periodicidadCantidad).toBe(1);
    expect(fila.fechaCobro).toBe("2026-04-01");
  });
});
