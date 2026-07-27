import { describe, it, expect, vi } from "vitest";
import { EnvioDevolucionCentralService } from "@/lib/services/EnvioDevolucionCentralService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

// Feature 139/T2.1 — ENVIO satelite -> bodega CENTRAL (`por_devolver -> devolviendo_a_bodega_central`).
// Molde de DevolucionOrigenService. Cubre R13 (transicion + idempotencia), R14 (autz: SOLO el
// adminSatelite cuya zona coincide con la de la orden), R22 (guardia de estado), R23 (ajuste_estado),
// config/not_found.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msj-1", rol: "mensajero" };
const SATELITE_ZONA: Actor = { usuarioId: "sat-z1", rol: "adminSatelite" }; // zona = z1
const SATELITE_OTRA: Actor = { usuarioId: "sat-z2", rol: "adminSatelite" }; // zona = z2

// OrdenDTO por defecto en `por_devolver`, zona z1.
function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: "os-por-devolver",
    estatusValue: "por_devolver",
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
    mensajeroAsignadoId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

type OrdenRepoDoble = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findUsuarioZonaId" | "update"
>;

function buildOrdenRepo(overrides: Partial<OrdenRepoDoble> = {}): OrdenRepoDoble {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findEstatusIdByValue: vi.fn(async () => "os-devolviendo-central"),
    // zona del actor: sat-z1 -> z1 (la de la orden); sat-z2 -> z2 (ajena); otros -> null.
    findUsuarioZonaId: vi.fn(async (usuarioId: string) =>
      usuarioId === "sat-z1" ? "z1" : usuarioId === "sat-z2" ? "z2" : null,
    ),
    update: vi.fn(async () =>
      ordenDTO({ estatusId: "os-devolviendo-central", estatusValue: "devolviendo_a_bodega_central" }),
    ),
    ...overrides,
  };
}

describe("EnvioDevolucionCentralService · transicion (R13)", () => {
  it("transiciona por_devolver -> devolviendo_a_bodega_central (adminSatelite de la zona)", async () => {
    const ordenRepo = buildOrdenRepo();
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);

    expect(r.status).toBe("ok");
    // R23: persiste via el choke point #11 (ajuste_estado) con el actor y el destino resuelto.
    expect(ordenRepo.update).toHaveBeenCalledTimes(1);
    const [id, data, historial] = (ordenRepo.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("ord-1");
    expect(data).toEqual({ estatusId: "os-devolviendo-central" });
    expect(historial).toEqual({ actorUsuarioId: "sat-z1", origenTipo: "ajuste_estado" });
  });

  it("orden inexistente o borrada -> not_found, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => null) });
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("x", SATELITE_ZONA);
    expect(r.status).toBe("not_found");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });

  it("carrera: la orden se borra entre lectura y escritura (update null) -> not_found", async () => {
    const ordenRepo = buildOrdenRepo({ update: vi.fn(async () => null) });
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);
    expect(r.status).toBe("not_found");
  });
});

describe("EnvioDevolucionCentralService · guardia de estado (R22)", () => {
  it("estado != por_devolver devuelve conflict, sin escribir ni resolver destino/autz", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "rechazada" })),
    });
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toContain("por_devolver");
    expect(ordenRepo.update).not.toHaveBeenCalled();
    // La guardia corta antes de resolver el destino o la zona del actor.
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
    expect(ordenRepo.findUsuarioZonaId).not.toHaveBeenCalled();
  });

  it("devolviendo_a_bodega_central es idempotente: ok sin re-transicionar (no update ni historial)", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () =>
        ordenDTO({ estatusValue: "devolviendo_a_bodega_central", estatusId: "os-devolviendo-central" }),
      ),
    });
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);

    expect(r.status).toBe("ok");
    expect(ordenRepo.update).not.toHaveBeenCalled();
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });
});

describe("EnvioDevolucionCentralService · autz por zona (R14)", () => {
  it("permite SOLO al adminSatelite cuya zona coincide con la de la orden", async () => {
    const ordenRepo = buildOrdenRepo();
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);
    expect(r.status).toBe("ok");
    expect(ordenRepo.update).toHaveBeenCalledTimes(1);
  });

  it("niega al adminSatelite de OTRA zona (forbidden sin efectos)", async () => {
    const ordenRepo = buildOrdenRepo();
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_OTRA);
    expect(r.status).toBe("forbidden");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });

  it("niega a maestro/admin/adminTienda/mensajero (forbidden sin efectos)", async () => {
    for (const actor of [MAESTRO, ADMIN, TIENDA, MENSAJERO]) {
      const ordenRepo = buildOrdenRepo();
      const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", actor);
      expect(r.status).toBe("forbidden");
      expect(ordenRepo.update).not.toHaveBeenCalled();
    }
  });

  it("adminSatelite sin zona resuelta -> forbidden (no puede coincidir con la de la orden)", async () => {
    const ordenRepo = buildOrdenRepo({ findUsuarioZonaId: vi.fn(async () => null) });
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);
    expect(r.status).toBe("forbidden");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });
});

describe("EnvioDevolucionCentralService · catalogo", () => {
  it("catalogo sin devolviendo_a_bodega_central -> config_error, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const r = await new EnvioDevolucionCentralService(ordenRepo).enviarACentral("ord-1", SATELITE_ZONA);
    expect(r.status).toBe("config_error");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });
});
