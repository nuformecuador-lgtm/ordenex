import { describe, it, expect, vi } from "vitest";
import { DevolucionOrigenService } from "@/lib/services/DevolucionOrigenService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

// Feature 48 REPURPOSADA por la 139 — ENVIO central -> tienda. El ORIGEN paso de `rechazada` a
// `por_devolver_a_tienda` (R9: la unica salida de `rechazada` es ahora la aprobacion del cierre) y la
// autz paso de bodega-responsable-por-zona a maestro/admin CENTRAL DIRECTO (R16). Cubre R15
// (transicion + idempotencia), R16 (autz central), R9 (rechazada ya no es elegible aqui -> conflict),
// R22 (guardia de estado), config/not_found.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msj-1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "sat-z1", rol: "adminSatelite" };

// OrdenDTO por defecto en `por_devolver_a_tienda` (nuevo origen elegible). zonaId da igual: la autz
// ya NO es por zona (por_devolver_a_tienda esta siempre fisicamente en la central).
function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 10,
    numRemision: "REM-1",
    estatusId: "os-por-devolver-a-tienda",
    estatusValue: "por_devolver_a_tienda",
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

type OrdenRepoDoble = Pick<IOrdenRepository, "findById" | "findEstatusIdByValue" | "update">;

function buildOrdenRepo(overrides: Partial<OrdenRepoDoble> = {}): OrdenRepoDoble {
  return {
    findById: vi.fn(async () => ordenDTO()),
    findEstatusIdByValue: vi.fn(async () => "os-devolviendo-a-tienda"),
    update: vi.fn(async () =>
      ordenDTO({ estatusId: "os-devolviendo-a-tienda", estatusValue: "devolviendo_a_tienda" }),
    ),
    ...overrides,
  };
}

describe("DevolucionOrigenService · transicion (R15)", () => {
  it("transiciona una orden por_devolver_a_tienda a devolviendo_a_tienda (maestro)", async () => {
    const ordenRepo = buildOrdenRepo();
    const service = new DevolucionOrigenService(ordenRepo);

    const r = await service.devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("ok");
    // R15/R23: persiste via el choke point #11 (ajuste_estado) con el actor y el destino.
    expect(ordenRepo.update).toHaveBeenCalledTimes(1);
    const [id, data, historial] = (ordenRepo.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe("ord-1");
    expect(data).toEqual({ estatusId: "os-devolviendo-a-tienda" });
    expect(historial).toEqual({ actorUsuarioId: "m1", origenTipo: "ajuste_estado" });
  });

  it("orden inexistente o borrada -> not_found, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findById: vi.fn(async () => null) });
    const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("x", MAESTRO);
    expect(r.status).toBe("not_found");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });

  it("carrera: la orden se borra entre lectura y escritura (update null) -> not_found", async () => {
    const ordenRepo = buildOrdenRepo({ update: vi.fn(async () => null) });
    const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("DevolucionOrigenService · guardia de estado (R22/R9)", () => {
  it("estado != por_devolver_a_tienda devuelve conflict, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "en_ruta" })),
    });
    const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") expect(r.motivo).toContain("por_devolver_a_tienda");
    expect(ordenRepo.update).not.toHaveBeenCalled();
    // No re-resuelve destino ni autz: la guardia corta antes.
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("R9: una orden `rechazada` YA NO es elegible aqui -> conflict (su unica salida es el cierre)", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () => ordenDTO({ estatusValue: "rechazada", estatusId: "os-rechazada" })),
    });
    const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", MAESTRO);
    expect(r.status).toBe("conflict");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });

  it("devolviendo_a_tienda es idempotente: ok sin re-transicionar (no llama update ni historial)", async () => {
    const ordenRepo = buildOrdenRepo({
      findById: vi.fn(async () =>
        ordenDTO({ estatusValue: "devolviendo_a_tienda", estatusId: "os-devolviendo-a-tienda" }),
      ),
    });
    const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", MAESTRO);

    expect(r.status).toBe("ok");
    expect(ordenRepo.update).not.toHaveBeenCalled();
    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });
});

describe("DevolucionOrigenService · autz central directa (R16)", () => {
  it("permite maestro y admin (bodega central)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const ordenRepo = buildOrdenRepo();
      const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", actor);
      expect(r.status).toBe("ok");
      expect(ordenRepo.update).toHaveBeenCalledTimes(1);
    }
  });

  it("niega adminSatelite, adminTienda y mensajero (forbidden sin efectos), sin importar la zona", async () => {
    for (const actor of [SATELITE, TIENDA, MENSAJERO]) {
      const ordenRepo = buildOrdenRepo();
      const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", actor);
      expect(r.status).toBe("forbidden");
      expect(ordenRepo.update).not.toHaveBeenCalled();
    }
  });

  it("la autz NO consulta la zona (por_devolver_a_tienda esta siempre en la central)", async () => {
    // findUsuarioZonaId ya no forma parte del contrato del repo del service: si el service lo
    // invocara, el doble (que no lo tiene) lo delataria. Basta con que maestro pase y satelite no.
    const ordenRepo = buildOrdenRepo();
    expect((ordenRepo as Record<string, unknown>).findUsuarioZonaId).toBeUndefined();
    const rMaestro = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", MAESTRO);
    expect(rMaestro.status).toBe("ok");
  });
});

describe("DevolucionOrigenService · catalogo", () => {
  it("catalogo sin devolviendo_a_tienda -> config_error, sin escribir", async () => {
    const ordenRepo = buildOrdenRepo({ findEstatusIdByValue: vi.fn(async () => null) });
    const r = await new DevolucionOrigenService(ordenRepo).devolverATienda("ord-1", MAESTRO);
    expect(r.status).toBe("config_error");
    expect(ordenRepo.update).not.toHaveBeenCalled();
  });
});
