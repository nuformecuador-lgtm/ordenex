import { describe, it, expect, vi } from "vitest";
import { DevolucionOrigenService } from "@/lib/services/DevolucionOrigenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

// Feature 48 — regla del RETORNO a la tienda de origen (T2/T3). Cubre R1/R2 (elegibilidad
// por estado, agnostica del camino), R4 (transicion), R5 (guardia de estado + idempotencia),
// R6 (tienda de origen es orden.tienda_id, no se toca), R10/R11 (autz por bodega responsable).

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msj-1", rol: "mensajero" };
const SATELITE_ZONA: Actor = { usuarioId: "sat-z1", rol: "adminSatelite" }; // zona = z1
const SATELITE_OTRA: Actor = { usuarioId: "sat-z2", rol: "adminSatelite" }; // zona = z2

// OrdenDTO de una orden `rechazada` (conserva tienda_id/num_guia/mensajero_asignado_id,
// R2). zonaId = z1.
function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: "os-rechazada",
    estatusValue: "rechazada",
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
    mensajeroAsignadoId: "msj-9", // conservado en rechazada (R2)
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

type OrdenRepoDoble = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findUsuarioZonaId" | "update"
>;
type ZonaRepoDoble = Pick<IZonaRepository, "findCentralZonaId">;

function buildOrdenRepo(overrides: Partial<OrdenRepoDoble> = {}): OrdenRepoDoble {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findEstatusIdByValue: vi.fn(async () => "os-devuelta-origen"),
    findUsuarioZonaId: vi.fn(async (usuarioId: string) =>
      usuarioId === "sat-z1" ? "z1" : usuarioId === "sat-z2" ? "z2" : null,
    ),
    update: vi.fn(async () =>
      ordenDTO({ estatusId: "os-devuelta-origen", estatusValue: "devuelta_origen" }),
    ),
    ...overrides,
  };
}

function buildZonaRepo(overrides: Partial<ZonaRepoDoble> = {}): ZonaRepoDoble {
  return {
    // por defecto la zona de la orden (z1) NO es la central -> bodega satelite.
    findCentralZonaId: vi.fn(async () => "z-central"),
    ...overrides,
  };
}

describe("DevolucionOrigenService · transicion (R4)", () => {
  it("transiciona una orden rechazada a devuelta_origen (zona central, maestro)", async () => {
    // zona de la orden = central -> bodega central -> maestro autorizado.
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => ordenDTO({ zonaId: "z-central" })) });
    const zonaRepo = buildZonaRepo({ findCentralZonaId: vi.fn(async () => "z-central") });
    const service = new DevolucionOrigenService(ordenRepo, zonaRepo);

    const r = await service.devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("ok");
    // R4/R7/R8: persiste via el choke point #11 (ajuste_estado) con el actor y el destino.
    expect(ordenRepo.update).toHaveBeenCalledTimes(1);
    const [id, data, historial] = (ordenRepo.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("ord-1");
    expect(data).toEqual({ estatusId: "os-devuelta-origen" });
    expect(historial).toEqual({ actorUsuarioId: "m1", origenTipo: "ajuste_estado" });
  });

  // R1/R2: la elegibilidad es por ESTADO (`rechazada`), agnostica del camino que la trajo
  // (rechazo directo 36 o escalado 47). Ambas ordenes son entradas identicas al service
  // (misma zona central, mismo estado) y ambas retornan ok sin exigir dato extra.
  it("orden rechazada por rechazo directo Y por escalado son ambas retornables (R1/R2)", async () => {
    const zonaRepo = buildZonaRepo({ findCentralZonaId: vi.fn(async () => "z-central") });

    // "rechazo directo" (36): conserva mensajero_asignado_id.
    const repoDirecto = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central", mensajeroAsignadoId: "msj-directo" })),
    });
    const rDirecto = await new DevolucionOrigenService(repoDirecto, zonaRepo).devolverATienda(
      "ord-1",
      MAESTRO,
    );

    // "escalado" (47): tambien rechazada, tambien conserva mensajero_asignado_id.
    const repoEscalado = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central", mensajeroAsignadoId: "msj-escalado" })),
    });
    const rEscalado = await new DevolucionOrigenService(repoEscalado, zonaRepo).devolverATienda(
      "ord-1",
      MAESTRO,
    );

    expect(rDirecto.status).toBe("ok");
    expect(rEscalado.status).toBe("ok");
    expect(repoDirecto.update).toHaveBeenCalledTimes(1);
    expect(repoEscalado.update).toHaveBeenCalledTimes(1);
  });

  it("orden inexistente o borrada -> not_found, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => null) });
    const service = new DevolucionOrigenService(ordenRepo, buildZonaRepo());

    const r = await service.devolverATienda("x", MAESTRO);

    expect(r.status).toBe("not_found");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });

  it("carrera: la orden se borra entre lectura y escritura (update null) -> not_found", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central" })),
      update: vi.fn(async () => null),
    });
    const zonaRepo = buildZonaRepo({ findCentralZonaId: vi.fn(async () => "z-central") });
    const service = new DevolucionOrigenService(ordenRepo, zonaRepo);

    const r = await service.devolverATienda("ord-1", MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("DevolucionOrigenService · guardia de estado (R5)", () => {
  it("estado != rechazada devuelve conflict, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central", estatusValue: "en_reparto" })),
    });
    const service = new DevolucionOrigenService(ordenRepo, buildZonaRepo());

    const r = await service.devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toContain("rechazada");
    expect(ordenRepo.update).not.toHaveBeenCalled();
    // No re-resuelve destino ni autz: la guardia corta antes.
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("devuelta_origen es idempotente: ok sin re-transicionar (no llama update ni historial)", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "devuelta_origen", estatusId: "os-devuelta-origen" })),
    });
    const service = new DevolucionOrigenService(ordenRepo, buildZonaRepo());

    const r = await service.devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(ordenRepo.update).not.toHaveBeenCalled();
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });
});

describe("DevolucionOrigenService · autz bodega central (R10)", () => {
  // zona de la orden = central -> permite maestro/admin, niega el resto.
  function centralSetup(findByIdOverride?: () => Promise<OrdenDTO>) {
    const ordenRepo = buildOrdenRepo({
      findById: findByIdOverride ?? (async () => ordenDTO({ zonaId: "z-central" })),
    });
    const zonaRepo = buildZonaRepo({ findCentralZonaId: vi.fn(async () => "z-central") });
    return { ordenRepo, zonaRepo };
  }

  it("permite maestro y admin", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { ordenRepo, zonaRepo } = centralSetup();
      const r = await new DevolucionOrigenService(ordenRepo, zonaRepo).devolverATienda("ord-1", actor);
      expect(r.status).toBe("ok");
      expect(ordenRepo.update).toHaveBeenCalledTimes(1);
    }
  });

  it("niega adminSatelite, adminTienda y mensajero (forbidden sin efectos)", async () => {
    for (const actor of [SATELITE_ZONA, TIENDA, MENSAJERO]) {
      const { ordenRepo, zonaRepo } = centralSetup();
      const r = await new DevolucionOrigenService(ordenRepo, zonaRepo).devolverATienda("ord-1", actor);
      expect(r.status).toBe("forbidden");
      expect(ordenRepo.update).not.toHaveBeenCalled();
    }
  });
});

describe("DevolucionOrigenService · autz bodega satelite (R10/R11)", () => {
  // zona de la orden = z1 (no central) -> bodega satelite de z1.
  it("permite el adminSatelite de la zona de la orden", async () => {
    const ordenRepo = buildOrdenRepo(); // findById -> zona z1; central = z-central
    const r = await new DevolucionOrigenService(ordenRepo, buildZonaRepo()).devolverATienda(
      "ord-1",
      SATELITE_ZONA,
    );
    expect(r.status).toBe("ok");
    expect(ordenRepo.update).toHaveBeenCalledTimes(1);
  });

  it("niega al adminSatelite de OTRA zona (forbidden sin efectos)", async () => {
    const ordenRepo = buildOrdenRepo();
    const r = await new DevolucionOrigenService(ordenRepo, buildZonaRepo()).devolverATienda(
      "ord-1",
      SATELITE_OTRA,
    );
    expect(r.status).toBe("forbidden");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });

  it("niega a maestro/admin/adminTienda/mensajero cuando la bodega responsable es satelite", async () => {
    for (const actor of [MAESTRO, ADMIN, TIENDA, MENSAJERO]) {
      const ordenRepo = buildOrdenRepo();
      const r = await new DevolucionOrigenService(ordenRepo, buildZonaRepo()).devolverATienda(
        "ord-1",
        actor,
      );
      expect(r.status).toBe("forbidden");
      expect(ordenRepo.update).not.toHaveBeenCalled();
    }
  });

  it("centralZonaId null cae a satelite (fallback): niega maestro, permite el adminSatelite de la zona", async () => {
    const zonaRepo = buildZonaRepo({ findCentralZonaId: vi.fn(async () => null) });

    const repoMaestro = buildOrdenRepo();
    const rMaestro = await new DevolucionOrigenService(repoMaestro, zonaRepo).devolverATienda(
      "ord-1",
      MAESTRO,
    );
    expect(rMaestro.status).toBe("forbidden");
    expect(repoMaestro.update).not.toHaveBeenCalled();

    const repoSat = buildOrdenRepo();
    const rSat = await new DevolucionOrigenService(repoSat, zonaRepo).devolverATienda(
      "ord-1",
      SATELITE_ZONA,
    );
    expect(rSat.status).toBe("ok");
    expect(repoSat.update).toHaveBeenCalledTimes(1);
  });
});

describe("DevolucionOrigenService · catalogo (R4)", () => {
  it("catalogo sin devuelta_origen -> config_error, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central" })),
      findEstatusIdByValue: vi.fn(async () => null),
    });
    const zonaRepo = buildZonaRepo({ findCentralZonaId: vi.fn(async () => "z-central") });
    const service = new DevolucionOrigenService(ordenRepo, zonaRepo);

    const r = await service.devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("config_error");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });
});
