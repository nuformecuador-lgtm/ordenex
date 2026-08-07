import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { VehiculoService } from "@/lib/services/VehiculoService";
import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

// T10: autz del catalogo vehiculos (solo maestro). P1=A: solo lectura, sin R12
// (escritura omitida). La ausencia de sesion (unauthenticated) se cubre en el
// test de la Server Action (vehiculos-action.test.ts), no aqui.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const SATELITE: Actor = { usuarioId: "sat1", rol: "adminSatelite" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

const NO_MAESTRO = [ADMIN, MENSAJERO, TIENDA, SATELITE, DESCONOCIDO];

const SEED_ROWS: VehiculoDTO[] = [
  { id: "veh-1", name: "camion" },
  { id: "veh-2", name: "carro" },
  { id: "veh-3", name: "moto" },
];

function buildRepo(overrides: Partial<IVehiculoRepository> = {}): IVehiculoRepository {
  return {
    findMany: vi.fn().mockResolvedValue(SEED_ROWS),
    findById: vi.fn().mockResolvedValue(SEED_ROWS[0]),
    ...overrides,
  };
}

let repo: IVehiculoRepository;
let service: VehiculoService;

beforeEach(() => {
  repo = buildRepo();
  service = new VehiculoService(repo);
});

describe("listar — autz (R9, R10, R11)", () => {
  it("R9/R11: maestro recibe ok con las 3 filas sembradas", async () => {
    const r = await service.listar(MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toHaveLength(3);
      expect(r.items.map((v) => v.name).sort()).toEqual(["camion", "carro", "moto"]);
    }
    expect(repo.findMany).toHaveBeenCalledTimes(1);
  });

  it("R10: cualquier rol distinto de maestro -> forbidden, sin tocar el repo", async () => {
    for (const actor of NO_MAESTRO) {
      const r = await service.listar(actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.findMany).not.toHaveBeenCalled();
  });
});

// BORRADO 2026-08-07 (tanda 2): aqui vivia el bloque de `obtener`, retirado de
// `VehiculoService` al quedarse sin llamador. R9/R10 (solo maestro; cualquier otro rol ->
// forbidden sin tocar el repo) conserva su testigo en el bloque de `listar`, arriba.
