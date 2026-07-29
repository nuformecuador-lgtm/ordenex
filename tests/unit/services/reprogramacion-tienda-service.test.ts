import { describe, it, expect, vi } from "vitest";
import { ReprogramacionTiendaService } from "@/lib/services/ReprogramacionTiendaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IGestionOrdenRepository } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

// Feature 100 (T1.3) — regla de la REPROGRAMACION por la tienda. Cubre R6 (autz por tienda dueña:
// otra tienda / rol no-adminTienda -> forbidden), R7 (fuera de `devuelta` -> conflict sin efectos;
// carrera con el cron -> conflict), config_error, not_found, y el camino `ok` que delega en el repo
// con la fecha/motivo/actor correctos (R2/R3/R11).

const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "store-2", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "msj-1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "sat-1", rol: "adminSatelite" };

const FECHA = "2026-07-25";

// OrdenDTO de una orden `devuelta` de la tienda store-1.
function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: "os-devuelta",
    estatusValue: "devuelta",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store-1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    mensajeroAsignadoId: "msj-9",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

type OrdenRepoDoble = Pick<IOrdenRepository, "findById" | "findEstatusIdByValue">;
type GestionRepoDoble = Pick<IGestionOrdenRepository, "reprogramarDesdeDevuelta">;

const ESTATUS: Record<string, string> = { devuelta: "os-devuelta", reprogramada: "os-reprogramada" };

function buildOrdenRepo(overrides: Partial<OrdenRepoDoble> = {}): OrdenRepoDoble {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    ...overrides,
  };
}

function buildGestionRepo(overrides: Partial<GestionRepoDoble> = {}): GestionRepoDoble {
  return {
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    ...overrides,
  };
}

describe("ReprogramacionTiendaService · autz por tienda (R6)", () => {
  it("delega en el repo y devuelve ok cuando el adminTienda es dueño de la orden", async () => {
    const ordenRepo = buildOrdenRepo();
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo);

    const r = await service.reprogramar("o1", FECHA, "motivo x", TIENDA);

    expect(r.status).toBe("ok");
    expect(gestionRepo.reprogramarDesdeDevuelta).toHaveBeenCalledTimes(1);
    // R2/R3/R11: pasa fecha, motivo, actor y los estatus resueltos.
    expect(gestionRepo.reprogramarDesdeDevuelta).toHaveBeenCalledWith({
      ordenId: "o1",
      estatusDevueltaId: "os-devuelta",
      estatusReprogramadaId: "os-reprogramada",
      fechaReprogramacion: FECHA,
      motivo: "motivo x",
      actorUsuarioId: "store-1",
    });
  });

  it("R6: adminTienda de OTRA tienda -> forbidden, sin escribir", async () => {
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(buildOrdenRepo(), gestionRepo);

    const r = await service.reprogramar("o1", FECHA, null, OTRA_TIENDA);

    expect(r.status).toBe("forbidden");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("R6: roles no-adminTienda (maestro/mensajero/adminSatelite) -> forbidden, sin escribir", async () => {
    for (const actor of [MAESTRO, MENSAJERO, SATELITE]) {
      const gestionRepo = buildGestionRepo();
      const service = new ReprogramacionTiendaService(buildOrdenRepo(), gestionRepo);
      const r = await service.reprogramar("o1", FECHA, null, actor);
      expect(r.status).toBe("forbidden");
      expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
    }
  });

  it("no revela el estado a un no-dueño: forbidden aunque la orden NO este en devuelta", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "en_reparto" })),
    });
    const service = new ReprogramacionTiendaService(ordenRepo, buildGestionRepo());
    const r = await service.reprogramar("o1", FECHA, null, OTRA_TIENDA);
    expect(r.status).toBe("forbidden");
  });
});

describe("ReprogramacionTiendaService · guardia de estado (R7)", () => {
  it("orden fuera de `devuelta` -> conflict, sin escribir ni resolver destino", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "en_reparto" })),
    });
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toContain("devuelta");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("R7: carrera con el cron SLA (repo count 0 -> false) -> conflict idempotente", async () => {
    const gestionRepo = buildGestionRepo({ reprogramarDesdeDevuelta: vi.fn(async () => false) });
    const service = new ReprogramacionTiendaService(buildOrdenRepo(), gestionRepo);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("conflict");
    expect(gestionRepo.reprogramarDesdeDevuelta).toHaveBeenCalledTimes(1);
  });
});

describe("ReprogramacionTiendaService · bordes de dominio", () => {
  it("orden inexistente o borrada -> not_found, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => null) });
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo);

    const r = await service.reprogramar("x", FECHA, null, TIENDA);

    expect(r.status).toBe("not_found");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("catalogo sin `reprogramada` -> config_error, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({
      findEstatusIdByValue: vi.fn(async (v: string) => (v === "devuelta" ? "os-devuelta" : null)),
    });
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("config_error");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });
});
