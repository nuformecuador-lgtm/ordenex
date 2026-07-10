import { describe, it, expect, vi } from "vitest";
import { listarVehiculos, obtenerVehiculo } from "@/lib/actions/vehiculos";
import type { Actor, IVehiculoService } from "@/lib/interfaces/services/IVehiculoService";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

// T10 (borde): la Server Action resuelve el actor y traduce sin sesion ->
// unauthenticated ANTES de tocar el service. La autz por rol la cubre
// vehiculo-service.test.ts. Deps inyectadas para no depender de next/headers.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const getActor = (actor: Actor) => async (): Promise<Actor | null> => actor;
const noActor = async (): Promise<Actor | null> => null;

const SEED: VehiculoDTO[] = [
  { id: "veh-1", name: "camion" },
  { id: "veh-2", name: "carro" },
  { id: "veh-3", name: "moto" },
];

function fakeService(overrides: Partial<IVehiculoService> = {}): IVehiculoService {
  return {
    listar: vi.fn().mockResolvedValue({ status: "ok", items: SEED }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", vehiculo: SEED[0] }),
    ...overrides,
  };
}

describe("R10: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("listarVehiculos", async () => {
    const service = fakeService();
    const r = await listarVehiculos({ vehiculoService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("obtenerVehiculo", async () => {
    const service = fakeService();
    const r = await obtenerVehiculo("veh-1", { vehiculoService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.obtener).not.toHaveBeenCalled();
  });
});

describe("R9/R11: maestro autenticado -> delega en el service y devuelve ok", () => {
  it("listarVehiculos devuelve las 3 filas", async () => {
    const service = fakeService();
    const r = await listarVehiculos({ vehiculoService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toHaveLength(3);
    expect(service.listar).toHaveBeenCalledWith(MAESTRO);
  });

  it("obtenerVehiculo delega el id parseado", async () => {
    const service = fakeService();
    const r = await obtenerVehiculo("veh-1", {
      vehiculoService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    expect(service.obtener).toHaveBeenCalledWith("veh-1", MAESTRO);
  });

  it("obtenerVehiculo con id vacio -> not_found sin tocar el service", async () => {
    const service = fakeService();
    const r = await obtenerVehiculo("", { vehiculoService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("not_found");
    expect(service.obtener).not.toHaveBeenCalled();
  });
});
