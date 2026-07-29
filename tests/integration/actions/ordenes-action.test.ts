import { describe, it, expect, vi } from "vitest";
import {
  crearOrden,
  obtenerOrden,
  listarOrdenes,
  actualizarOrden,
  borrarOrden,
} from "@/lib/actions/ordenes";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

const ACTOR: Actor = { usuarioId: "store1", rol: "adminTienda" };
const getActor = async (): Promise<Actor | null> => ACTOR;
const noActor = async (): Promise<Actor | null> => null;

function dto(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 42,
    numRemision: "REM-1",
    estatusId: "os-bodega",
    estatusValue: "en_bodega_central",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// Fixture de geografia (R14b): en un entorno real, crear una orden exige que
// existan zona/provincia/canton (FK NOT NULL contra tablas creadas vacias). Aqui
// el service esta inyectado como fake, de modo que la dependencia operativa se
// documenta y se ejercita via el caso "geografia inexistente -> validation_error".
function fakeService(overrides: Partial<IOrdenService> = {}): IOrdenService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", orden: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", orden: dto() }),
    listar: vi.fn().mockResolvedValue({
      status: "ok",
      items: [{ ...dto(), tiendaNombre: "Tienda Uno" }], // R25/R26: listado con nombre tienda
      page: 1,
      pageSize: 20,
      total: 1,
    }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", orden: dto() }),
    borrar: vi.fn().mockResolvedValue({ status: "ok" }),
    // Feature 151: modo sin paginacion (descarga). El doble lo satisface para cumplir
    // el contrato de IOrdenService; su comportamiento se prueba en
    // tests/unit/actions/ordenes-descarga-action.test.ts.
    listarCompleto: vi.fn().mockResolvedValue({
      status: "ok",
      items: [{ ...dto(), tiendaNombre: "Tienda Uno" }],
      total: 1,
    }),
    ...overrides,
  };
}

const validCrear = {
  numRemision: "REM-1",
  destinatario: "Ana",
  telefonoDest: "0991234567",
  producto: "Caja",
  peso: 1.5,
  zonaId: "z1",
  provinciaId: "p1",
  cantonId: "c1",
};

describe("R18: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("crearOrden", async () => {
    const service = fakeService();
    const r = await crearOrden(validCrear, { ordenService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("obtener/listar/actualizar/borrar tambien rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { ordenService: service, getActor: noActor };
    expect((await obtenerOrden("ord-1", deps)).status).toBe("unauthenticated");
    expect((await listarOrdenes({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarOrden("ord-1", {}, deps)).status).toBe("unauthenticated");
    expect((await borrarOrden("ord-1", deps)).status).toBe("unauthenticated");
    expect(service.obtener).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("R26/R32/R38: validation_error con fieldErrors sin llamar al service", () => {
  it("crear con input invalido (peso negativo, sin zona)", async () => {
    const service = fakeService();
    const r = await crearOrden(
      { numRemision: "R", destinatario: "A", telefonoDest: "1", producto: "P", peso: -1 },
      { ordenService: service, getActor },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("peso");
      expect(r.fieldErrors).toHaveProperty("zonaId");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("listar con sortBy fuera de lista blanca (R32)", async () => {
    const service = fakeService();
    const r = await listarOrdenes({ sortBy: "peso" }, { ordenService: service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("actualizar con campo inmutable (numGuia) -> validation_error", async () => {
    const service = fakeService();
    const r = await actualizarOrden(
      "ord-1",
      { numGuia: 9 },
      { ordenService: service, getActor },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizar).not.toHaveBeenCalled();
  });
});

describe("R27: crear valido -> ok con OrdenDTO y num_guia asignado", () => {
  it("devuelve la orden con numGuia crudo", async () => {
    const service = fakeService();
    const r = await crearOrden(validCrear, { ordenService: service, getActor });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.orden.numGuia).toBe(42);
      expect(r.orden).not.toHaveProperty("deletedAt"); // R42/N3
    }
    expect(service.crear).toHaveBeenCalledWith(expect.objectContaining(validCrear), ACTOR);
  });
});

describe("R19-R24/R41: autorizacion propagada desde el service", () => {
  it("forbidden se propaga tal cual (R22/R24)", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await crearOrden(validCrear, { ordenService: service, getActor });
    expect(r.status).toBe("forbidden");
  });

  it("mensajero: borrar propaga forbidden (R41)", async () => {
    const service = fakeService({ borrar: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await borrarOrden("ord-1", { ordenService: service, getActor });
    expect(r.status).toBe("forbidden");
  });
});

describe("R29: obtener ok / not_found", () => {
  it("ok con orden", async () => {
    const service = fakeService();
    const r = await obtenerOrden("ord-1", { ordenService: service, getActor });
    expect(r.status).toBe("ok");
  });

  it("not_found se propaga", async () => {
    const service = fakeService({ obtener: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await obtenerOrden("ord-9", { ordenService: service, getActor });
    expect(r.status).toBe("not_found");
  });
});

describe("R30/R31/R33/R34: listar", () => {
  it("devuelve items/page/pageSize/total y acota pageSize (R33)", async () => {
    const service = fakeService();
    const r = await listarOrdenes(
      { page: 1, pageSize: 100000, estatusId: "os-bodega", sortBy: "num_guia", sortDir: "asc" },
      { ordenService: service, getActor },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toHaveLength(1);
      expect(r.total).toBe(1);
    }
    // el schema acota pageSize antes de llamar al service (R33)
    const arg = (service.listar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.pageSize).toBeLessThanOrEqual(100);
    expect(arg.sortBy).toBe("num_guia");
  });
});

describe("R35/R36/R37: actualizar", () => {
  it("ok con orden actualizada", async () => {
    const service = fakeService();
    const r = await actualizarOrden(
      "ord-1",
      { estatusId: "os-entregada" },
      { ordenService: service, getActor },
    );
    expect(r.status).toBe("ok");
    expect(service.actualizar).toHaveBeenCalledWith(
      "ord-1",
      { estatusId: "os-entregada" },
      ACTOR,
    );
  });

  it("not_found se propaga (R36)", async () => {
    const service = fakeService({
      actualizar: vi.fn().mockResolvedValue({ status: "not_found" }),
    });
    const r = await actualizarOrden("x", { producto: "N" }, { ordenService: service, getActor });
    expect(r.status).toBe("not_found");
  });
});

describe("R39: borrar (soft) -> ok", () => {
  it("propaga ok", async () => {
    const service = fakeService();
    const r = await borrarOrden("ord-1", { ordenService: service, getActor });
    expect(r.status).toBe("ok");
    expect(service.borrar).toHaveBeenCalledWith("ord-1", ACTOR);
  });
});

describe("R28: num_remision duplicado -> conflict", () => {
  it("propaga conflict del service", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue({ status: "conflict" }) });
    const r = await crearOrden(validCrear, { ordenService: service, getActor });
    expect(r.status).toBe("conflict");
  });
});

describe("R14b/R42: dependencia de geografia y errores tipados sin PII", () => {
  it("geografia inexistente -> validation_error tipado (no crea)", async () => {
    // R14b: sin geografia poblada el service rechaza la creacion por FK NOT NULL.
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({
        status: "validation_error",
        fieldErrors: { zonaId: ["zonaId no existe"] },
      }),
    });
    const r = await crearOrden(validCrear, { ordenService: service, getActor });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.zonaId).toBeDefined();
      // R42: el resultado es un objeto discriminado, no una excepcion ni PII.
      expect(Object.keys(r)).toEqual(["status", "fieldErrors"]);
    }
  });
});

describe("R9: conserva la clave id en fieldErrors", () => {
  it("obtenerOrden con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await obtenerOrden("", { ordenService: service, getActor });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.id).toBeDefined();
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.obtener).not.toHaveBeenCalled();
  });

  it("actualizarOrden con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await actualizarOrden("", { producto: "N" }, { ordenService: service, getActor });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.id).toBeDefined();
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.actualizar).not.toHaveBeenCalled();
  });

  it("borrarOrden con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await borrarOrden("", { ordenService: service, getActor });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.id).toBeDefined();
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("R11: error de dominio por nombre -> conflict via handler", () => {
  it("crear con NumRemisionDuplicadoError -> conflict (no lanza, no 500)", async () => {
    class NumRemisionDuplicadoError extends Error {
      constructor() {
        super("dup");
        this.name = "NumRemisionDuplicadoError";
      }
    }
    const service = fakeService({
      crear: vi.fn().mockRejectedValue(new NumRemisionDuplicadoError()),
    });
    const r = await crearOrden(validCrear, { ordenService: service, getActor });
    expect(r.status).toBe("conflict");
  });
});

describe("INTERNAL: throw inesperado se re-lanza", () => {
  it("crear con error desconocido -> la accion rechaza (preserva 500)", async () => {
    const service = fakeService({
      crear: vi.fn().mockImplementation(() => {
        throw new Error("boom");
      }),
    });
    await expect(
      crearOrden(validCrear, { ordenService: service, getActor }),
    ).rejects.toThrow();
  });
});
