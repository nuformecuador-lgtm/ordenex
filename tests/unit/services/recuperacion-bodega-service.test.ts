import { describe, it, expect, vi } from "vitest";
import { RecuperacionBodegaService } from "@/lib/services/RecuperacionBodegaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IRecuperacionBodegaRepository } from "@/lib/interfaces/repositories/IRecuperacionBodegaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

// Feature 100 (T2.3) — regla de la RECUPERACION a bodega (calcada de DevolucionOrigenService).
// Cubre R13 (destino por zona: central -> en_bodega_central; satelite -> en_bodega_satelite), R15 (autz por
// bodega responsable, matriz rol×zona), R16 (fuera de `devuelta` -> conflict; carrera -> conflict),
// config_error, not_found.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msj-1", rol: "mensajero" };
const SATELITE_ZONA: Actor = { usuarioId: "sat-z1", rol: "adminSatelite" }; // zona = z1
const SATELITE_OTRA: Actor = { usuarioId: "sat-z2", rol: "adminSatelite" }; // zona = z2

// OrdenDTO de una orden `devuelta`. zonaId = z1 por defecto (no central).
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

type OrdenRepoDoble = Pick<
  IOrdenRepository,
  "findById" | "findEstatusIdByValue" | "findUsuarioZonaId"
>;
type ZonaRepoDoble = Pick<IZonaRepository, "findCentralZonaId">;

const ESTATUS: Record<string, string> = {
  devuelta: "os-devuelta",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
};

function buildOrdenRepo(overrides: Partial<OrdenRepoDoble> = {}): OrdenRepoDoble {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    findUsuarioZonaId: vi.fn(async (usuarioId: string) =>
      usuarioId === "sat-z1" ? "z1" : usuarioId === "sat-z2" ? "z2" : null,
    ),
    ...overrides,
  };
}

function buildZonaRepo(centralId: string | null = "z-central"): ZonaRepoDoble {
  return { findCentralZonaId: vi.fn(async () => centralId) };
}

function buildRecuperacionRepo(
  overrides: Partial<IRecuperacionBodegaRepository> = {},
): IRecuperacionBodegaRepository {
  return {
    recuperarABodega: vi.fn(async () => true),
    ...overrides,
  };
}

describe("RecuperacionBodegaService · bodega central (R13/R15)", () => {
  // zona de la orden = central -> permite maestro/admin, niega el resto; destino en_bodega_central.
  function centralSetup() {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central" })),
    });
    return { ordenRepo, zonaRepo: buildZonaRepo("z-central") };
  }

  it("R13/R15: maestro y admin recuperan a `en_bodega_central`", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const { ordenRepo, zonaRepo } = centralSetup();
      const recuperacionRepo = buildRecuperacionRepo();
      const r = await new RecuperacionBodegaService(ordenRepo, zonaRepo, recuperacionRepo).recuperar(
        "o1",
        actor,
      );
      expect(r.status).toBe("ok");
      expect(recuperacionRepo.recuperarABodega).toHaveBeenCalledWith({
        ordenId: "o1",
        destinoEstatusId: "os-en-bodega", // R13: destino central
        estatusDevueltaId: "os-devuelta",
        actorUsuarioId: actor.usuarioId, // R17
      });
    }
  });

  it("R15: adminSatelite / adminTienda / mensajero -> forbidden (bodega central), sin escribir", async () => {
    for (const actor of [SATELITE_ZONA, TIENDA, MENSAJERO]) {
      const { ordenRepo, zonaRepo } = centralSetup();
      const recuperacionRepo = buildRecuperacionRepo();
      const r = await new RecuperacionBodegaService(ordenRepo, zonaRepo, recuperacionRepo).recuperar(
        "o1",
        actor,
      );
      expect(r.status).toBe("forbidden");
      expect(recuperacionRepo.recuperarABodega).not.toHaveBeenCalled();
    }
  });
});

describe("RecuperacionBodegaService · bodega satelite (R13/R15)", () => {
  // zona de la orden = z1 (no central) -> bodega satelite de z1; destino en_bodega_satelite.
  it("R13/R15: el adminSatelite de la zona de la orden recupera a `en_bodega_satelite`", async () => {
    const ordenRepo = buildOrdenRepo();
    const recuperacionRepo = buildRecuperacionRepo();
    const r = await new RecuperacionBodegaService(
      ordenRepo,
      buildZonaRepo(),
      recuperacionRepo,
    ).recuperar("o1", SATELITE_ZONA);

    expect(r.status).toBe("ok");
    expect(recuperacionRepo.recuperarABodega).toHaveBeenCalledWith({
      ordenId: "o1",
      destinoEstatusId: "os-en-bodega-satelite", // R13: destino satelite
      estatusDevueltaId: "os-devuelta",
      actorUsuarioId: "sat-z1",
    });
  });

  it("R15: el adminSatelite de OTRA zona -> forbidden, sin escribir", async () => {
    const recuperacionRepo = buildRecuperacionRepo();
    const r = await new RecuperacionBodegaService(
      buildOrdenRepo(),
      buildZonaRepo(),
      recuperacionRepo,
    ).recuperar("o1", SATELITE_OTRA);

    expect(r.status).toBe("forbidden");
    expect(recuperacionRepo.recuperarABodega).not.toHaveBeenCalled();
  });

  it("R15: maestro/admin/adminTienda/mensajero -> forbidden cuando la bodega responsable es satelite", async () => {
    for (const actor of [MAESTRO, ADMIN, TIENDA, MENSAJERO]) {
      const recuperacionRepo = buildRecuperacionRepo();
      const r = await new RecuperacionBodegaService(
        buildOrdenRepo(),
        buildZonaRepo(),
        recuperacionRepo,
      ).recuperar("o1", actor);
      expect(r.status).toBe("forbidden");
      expect(recuperacionRepo.recuperarABodega).not.toHaveBeenCalled();
    }
  });

  it("centralZonaId null cae a satelite (fallback): niega maestro, permite el adminSatelite de la zona", async () => {
    const zonaRepo = buildZonaRepo(null);

    const repoMaestro = buildRecuperacionRepo();
    const rMaestro = await new RecuperacionBodegaService(
      buildOrdenRepo(),
      zonaRepo,
      repoMaestro,
    ).recuperar("o1", MAESTRO);
    expect(rMaestro.status).toBe("forbidden");
    expect(repoMaestro.recuperarABodega).not.toHaveBeenCalled();

    const repoSat = buildRecuperacionRepo();
    const rSat = await new RecuperacionBodegaService(buildOrdenRepo(), zonaRepo, repoSat).recuperar(
      "o1",
      SATELITE_ZONA,
    );
    expect(rSat.status).toBe("ok");
    expect(repoSat.recuperarABodega).toHaveBeenCalledTimes(1);
  });
});

describe("RecuperacionBodegaService · guardia de estado y bordes (R16)", () => {
  it("R16: orden fuera de `devuelta` -> conflict, sin autz ni escritura", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "en_bodega_central" })),
    });
    const recuperacionRepo = buildRecuperacionRepo();
    const r = await new RecuperacionBodegaService(
      ordenRepo,
      buildZonaRepo(),
      recuperacionRepo,
    ).recuperar("o1", MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toContain("devuelta");
    expect(recuperacionRepo.recuperarABodega).not.toHaveBeenCalled();
    // La guardia corta antes de resolver zona/destino.
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("R16: carrera con el cron SLA (repo count 0 -> false) -> conflict idempotente", async () => {
    const recuperacionRepo = buildRecuperacionRepo({ recuperarABodega: vi.fn(async () => false) });
    const r = await new RecuperacionBodegaService(
      buildOrdenRepo({ findById: vi.fn(async () => ordenDTO({ zonaId: "z-central" })) }),
      buildZonaRepo("z-central"),
      recuperacionRepo,
    ).recuperar("o1", MAESTRO);

    expect(r.status).toBe("conflict");
    expect(recuperacionRepo.recuperarABodega).toHaveBeenCalledTimes(1);
  });

  it("orden inexistente o borrada -> not_found, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => null) });
    const recuperacionRepo = buildRecuperacionRepo();
    const r = await new RecuperacionBodegaService(
      ordenRepo,
      buildZonaRepo(),
      recuperacionRepo,
    ).recuperar("x", MAESTRO);

    expect(r.status).toBe("not_found");
    expect(recuperacionRepo.recuperarABodega).not.toHaveBeenCalled();
  });

  it("catalogo sin el destino de bodega -> config_error, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ zonaId: "z-central" })),
      findEstatusIdByValue: vi.fn(async (v: string) => (v === "devuelta" ? "os-devuelta" : null)),
    });
    const recuperacionRepo = buildRecuperacionRepo();
    const r = await new RecuperacionBodegaService(
      ordenRepo,
      buildZonaRepo("z-central"),
      recuperacionRepo,
    ).recuperar("o1", MAESTRO);

    expect(r.status).toBe("config_error");
    expect(recuperacionRepo.recuperarABodega).not.toHaveBeenCalled();
  });
});
