import { describe, it, expect, vi } from "vitest";
import { listarProvincias, listarCantones, listarDistritos } from "@/lib/actions/geo";
import type { Actor, IGeoService } from "@/lib/interfaces/services/IGeoService";
import type {
  CantonLightDTO,
  DistritoCatalogoDTO,
  ProvinciaLightDTO,
} from "@/lib/types/zona";

// Feature 55/R1/R10: Server Actions del catalogo geografico. Patron de inyeccion de
// zonas-action.test.ts (getActor + geoService fakes, sin DB).

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const getActor = (a: Actor) => async (): Promise<Actor | null> => a;
const noActor = async (): Promise<Actor | null> => null;

const PROVINCIAS: ProvinciaLightDTO[] = [{ id: "p1", nombre: "San Jose" }];
const CANTONES: CantonLightDTO[] = [{ id: "c1", nombre: "Central" }];
const DISTRITOS: DistritoCatalogoDTO[] = [
  { id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null },
  { id: "d2", nombre: "Merced", zonaId: "zOtra", zonaNombre: "Zona Norte" },
];

function fakeService(over: Partial<IGeoService> = {}): IGeoService {
  return {
    listarProvincias: vi.fn().mockResolvedValue({ status: "ok", items: PROVINCIAS }),
    listarCantones: vi.fn().mockResolvedValue({ status: "ok", items: CANTONES }),
    listarDistritos: vi.fn().mockResolvedValue({ status: "ok", items: DISTRITOS }),
    ...over,
  };
}

describe("sin sesion -> unauthenticated sin tocar el service (R1)", () => {
  it("las tres acciones rechazan sin sesion", async () => {
    const geoService = fakeService();
    const deps = { geoService, getActor: noActor };
    expect((await listarProvincias(deps)).status).toBe("unauthenticated");
    expect((await listarCantones("p1", deps)).status).toBe("unauthenticated");
    expect((await listarDistritos("c1", deps)).status).toBe("unauthenticated");
    expect(geoService.listarProvincias).not.toHaveBeenCalled();
    expect(geoService.listarCantones).not.toHaveBeenCalled();
    expect(geoService.listarDistritos).not.toHaveBeenCalled();
  });
});

describe("no-maestro -> forbidden (R1)", () => {
  it("el service devuelve forbidden y la accion lo propaga", async () => {
    const geoService = fakeService({
      listarProvincias: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await listarProvincias({ geoService, getActor: getActor(ADMIN) });
    expect(r.status).toBe("forbidden");
  });
});

describe("maestro -> ok con items (R10)", () => {
  it("listarProvincias devuelve items", async () => {
    const geoService = fakeService();
    const r = await listarProvincias({ geoService, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toEqual(PROVINCIAS);
  });

  it("listarCantones pasa el provinciaId validado y devuelve items", async () => {
    const geoService = fakeService();
    const r = await listarCantones("p1", { geoService, getActor: getActor(MAESTRO) });
    expect(geoService.listarCantones).toHaveBeenCalledWith("p1", MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toEqual(CANTONES);
  });

  it("listarDistritos expone zonaId/zonaNombre de otra zona (deshabilitable en UI)", async () => {
    const geoService = fakeService();
    const r = await listarDistritos("c1", { geoService, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items.find((d) => d.id === "d2")?.zonaNombre).toBe("Zona Norte");
    }
  });
});

describe("validacion zod del borde (R2)", () => {
  it("provinciaId invalido -> validation_error sin tocar el service", async () => {
    const geoService = fakeService();
    const r = await listarCantones("", { geoService, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("provinciaId");
    expect(geoService.listarCantones).not.toHaveBeenCalled();
  });

  it("cantonId invalido (no string) -> validation_error", async () => {
    const geoService = fakeService();
    const r = await listarDistritos(123, { geoService, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("cantonId");
    expect(geoService.listarDistritos).not.toHaveBeenCalled();
  });
});
