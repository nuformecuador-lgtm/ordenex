import { describe, it, expect, vi } from "vitest";
import {
  crearZona,
  obtenerZona,
  listarZonas,
  actualizarZona,
  borrarZona,
} from "@/lib/actions/zonas";
import type { Actor, IZonaService } from "@/lib/interfaces/services/IZonaService";
import type { ZonaDTO } from "@/lib/types/zona";

// Feature 54 (reconciliacion PR #40): prueba las Server Actions VIGENTES de zonas
// contra el ZonaDTO nuevo { id, nombre, cobroVehiculo, distritosCount, esCentral,
// tarifas? } y el ZonaActionError (conflict SIN payload). Las actions/DTO viejos
// (marcarZonaGam, listarZonasLight, listarProvincias, pagoEntrega/esGam) ya no existen.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const getActor = (a: Actor) => async (): Promise<Actor | null> => a;
const noActor = async (): Promise<Actor | null> => null;

function dto(over: Partial<ZonaDTO> = {}): ZonaDTO {
  return {
    id: "z1",
    nombre: "Zona Sur",
    cobroVehiculo: false,
    distritosCount: 2,
    esCentral: false,
    ...over,
  };
}

function fakeService(over: Partial<IZonaService> = {}): IZonaService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    listar: vi.fn().mockResolvedValue({ status: "ok", items: [dto()], page: 1, pageSize: 25, total: 1 }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", zona: dto() }),
    borrar: vi.fn().mockResolvedValue({ status: "ok" }),
    arbol: vi.fn().mockResolvedValue({ status: "ok", arbol: {} }),
    ...over,
  };
}

const validCrear = {
  nombre: "Zona Sur",
  cobroVehiculo: false,
  esCentral: false,
  distritoIds: ["d1"],
  tarifas: [],
};

describe("sin sesion -> unauthenticated sin tocar el service", () => {
  it("todas las acciones rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { zonaService: service, getActor: noActor };
    expect((await crearZona(validCrear, deps)).status).toBe("unauthenticated");
    expect((await obtenerZona("z1", deps)).status).toBe("unauthenticated");
    expect((await listarZonas({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarZona("z1", validCrear, deps)).status).toBe("unauthenticated");
    expect((await borrarZona("z1", deps)).status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("validation_error del schema sin llamar al service", () => {
  it("crear con nombre vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await crearZona(
      { ...validCrear, nombre: "" },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con distritoIds vacio -> validation_error", async () => {
    const service = fakeService();
    const r = await crearZona(
      { ...validCrear, distritoIds: [] },
      { zonaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
  });
});

describe("contrato discriminado por status (pass-through del service)", () => {
  it("forbidden se propaga", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("forbidden");
  });

  it("conflict al borrar se propaga (sin payload)", async () => {
    const service = fakeService({ borrar: vi.fn().mockResolvedValue({ status: "conflict" }) });
    const r = await borrarZona("z1", { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("conflict");
    expect(Object.keys(r)).toEqual(["status"]);
  });

  it("not_found en actualizar se propaga", async () => {
    const service = fakeService({ actualizar: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await actualizarZona("zX", validCrear, {
      zonaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("not_found");
  });

  it("not_found en obtener se propaga", async () => {
    const service = fakeService({ obtener: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await obtenerZona("zX", { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("not_found");
  });
});

describe("DTO nuevo (esCentral, sin campos internos)", () => {
  it("crear ok expone solo status/zona con esCentral y sin deletedAt", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "ok", zona: dto({ esCentral: true }) }) });
    const r = await crearZona(validCrear, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Object.keys(r)).toEqual(["status", "zona"]);
      expect(r.zona.esCentral).toBe(true);
      expect(typeof r.zona.cobroVehiculo).toBe("boolean");
      expect(r.zona).not.toHaveProperty("deletedAt");
      expect(r.zona).not.toHaveProperty("pagoEntrega");
    }
  });

  it("listar ok devuelve items con distritosCount y esCentral", async () => {
    const service = fakeService();
    const r = await listarZonas({}, { zonaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items[0].distritosCount).toBe(2);
      expect(r.items[0].esCentral).toBe(false);
    }
  });
});
