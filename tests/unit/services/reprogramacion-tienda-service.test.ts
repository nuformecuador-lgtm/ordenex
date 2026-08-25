import { describe, it, expect, vi } from "vitest";
import { ReprogramacionTiendaService } from "@/lib/services/ReprogramacionTiendaService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import { MSG_TOPE_INTENTOS_ASIGNACION } from "@/lib/services/mensajes-bloqueo";
import { reintentosConfig } from "@/lib/config/reintentos";
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
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

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
    const service = new ReprogramacionTiendaService(buildOrdenRepo(), gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.reprogramar("o1", FECHA, null, OTRA_TIENDA);

    expect(r.status).toBe("forbidden");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("R6: roles no-adminTienda (maestro/mensajero/adminSatelite) -> forbidden, sin escribir", async () => {
    for (const actor of [MAESTRO, MENSAJERO, SATELITE]) {
      const gestionRepo = buildGestionRepo();
      const service = new ReprogramacionTiendaService(buildOrdenRepo(), gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);
      const r = await service.reprogramar("o1", FECHA, null, actor);
      expect(r.status).toBe("forbidden");
      expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
    }
  });

  it("no revela el estado a un no-dueño: forbidden aunque la orden NO este en devuelta", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "en_reparto" })),
    });
    const service = new ReprogramacionTiendaService(ordenRepo, buildGestionRepo(), fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);
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
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toContain("devuelta");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("R7: carrera con el cron SLA (repo count 0 -> false) -> conflict idempotente", async () => {
    const gestionRepo = buildGestionRepo({ reprogramarDesdeDevuelta: vi.fn(async () => false) });
    const service = new ReprogramacionTiendaService(buildOrdenRepo(), gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("conflict");
    expect(gestionRepo.reprogramarDesdeDevuelta).toHaveBeenCalledTimes(1);
  });
});

describe("ReprogramacionTiendaService · bordes de dominio", () => {
  it("orden inexistente o borrada -> not_found, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => null) });
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.reprogramar("x", FECHA, null, TIENDA);

    expect(r.status).toBe("not_found");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("catalogo sin `reprogramada` -> config_error, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({
      findEstatusIdByValue: vi.fn(async (v: string) => (v === "devuelta" ? "os-devuelta" : null)),
    });
    const gestionRepo = buildGestionRepo();
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("config_error");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* FEATURE 276 · Q2 (FIRMADA el 2026-08-24) — la TERCERA via hacia la          */
/* circulacion tambien se bloquea, y con el motivo unico de R20.               */
/* -------------------------------------------------------------------------- */

describe("276/Q2 — la tienda no reprograma una orden que ya agoto sus intentos", () => {
  const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

  /** Monta el servicio con el conteo de intentos que se le quiera dar a `o1`. */
  function montar(intentos: number) {
    const ordenRepo = buildOrdenRepo();
    const gestionRepo = buildGestionRepo();
    const historial = fakeIntentosEnLote({ o1: intentos });
    const service = new ReprogramacionTiendaService(ordenRepo, gestionRepo, historial);
    return { service, ordenRepo, gestionRepo, historial };
  }

  it("con `intentos = umbral` -> conflict con el MISMO motivo que la asignacion (R20)", async () => {
    const { service, gestionRepo } = montar(UMBRAL);

    const r = await service.reprogramar("o1", FECHA, "insistir", TIENDA);

    // El motivo sale del SIMBOLO compartido: es literalmente el mismo que emiten las dos bodegas
    // al negar la asignacion. Sin esta guarda, la orden acabaria en bodega y R18 le negaria la
    // asignacion tres pasos despues, con el paquete ya movido y la tienda sin enterarse.
    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_ASIGNACION });
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("POR ENCIMA del umbral tambien se bloquea (`>=`, no `===`)", async () => {
    const { service, gestionRepo } = montar(UMBRAL + 2);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("conflict");
    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
  });

  it("con `intentos = umbral - 1` la tienda SIGUE pudiendo reprogramar", async () => {
    // La puerta de esta via es `>= umbral`, no `>= umbral - 1`: aqui no se registra ningun intento
    // nuevo (la gestion sintetica de la 100 NO es visita real), asi que la pregunta es la misma que
    // la de la asignacion. Si alguien copiara `alcanzaElTope` aqui, este caso cae.
    const { service, gestionRepo } = montar(UMBRAL - 1);

    const r = await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(r.status).toBe("ok");
    expect(gestionRepo.reprogramarDesdeDevuelta).toHaveBeenCalledTimes(1);
  });

  it("el rechazo NO deja efectos: ni gestion sintetica ni resolucion de catalogo", async () => {
    const { service, ordenRepo, gestionRepo } = montar(UMBRAL);

    await service.reprogramar("o1", FECHA, null, TIENDA);

    expect(gestionRepo.reprogramarDesdeDevuelta).not.toHaveBeenCalled();
    // La guarda va ANTES del paso 4 (catalogo): que no se resuelva ningun estatus demuestra el
    // ORDEN, no solo el resultado.
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("las guardas previas siguen ganando: una tienda ajena se lleva `forbidden`, no el tope", async () => {
    const { service, historial } = montar(UMBRAL + 5);

    const r = await service.reprogramar("o1", FECHA, null, OTRA_TIENDA);

    expect(r.status).toBe("forbidden");
    // Y ni siquiera se pregunto por el contador: la autz corto antes.
    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });
});
