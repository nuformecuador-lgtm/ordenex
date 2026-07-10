import { describe, it, expect, vi } from "vitest";
import {
  crearCobro,
  obtenerCobro,
  listarCobros,
  actualizarCobro,
  borrarCobro,
} from "@/lib/actions/cobros";
import type { Actor, ICobroService } from "@/lib/interfaces/services/ICobroService";
import type { CobroDTO } from "@/lib/types/cobro";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };

const getActor = (actor: Actor) => async (): Promise<Actor | null> => actor;
const noActor = async (): Promise<Actor | null> => null;

function dto(overrides: Partial<CobroDTO> = {}): CobroDTO {
  return {
    id: "cob-1",
    nombre: "Tarifa GAM",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function fakeService(overrides: Partial<ICobroService> = {}): ICobroService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", cobro: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", cobro: dto() }),
    listar: vi.fn().mockResolvedValue({
      status: "ok",
      items: [dto()],
      page: 1,
      pageSize: 20,
      total: 1,
    }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", cobro: dto() }),
    borrar: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides,
  };
}

const validCrear = {
  nombre: "Tarifa GAM",
  valorFlete: 10,
  valorFleteDevuelto: 5,
  valorFleteGam: 8,
  valorFleteDevueltoGam: 4,
  fulfillment: 3,
  comisionCod: 2.5,
  ivaFlete: 15,
  ivaComisionCod: 15,
};

describe("R8: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("crearCobro", async () => {
    const service = fakeService();
    const r = await crearCobro(validCrear, { cobroService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("obtener/listar/actualizar/borrar tambien rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { cobroService: service, getActor: noActor };
    expect((await obtenerCobro("cob-1", deps)).status).toBe("unauthenticated");
    expect((await listarCobros({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarCobro("cob-1", {}, deps)).status).toBe("unauthenticated");
    expect((await borrarCobro("cob-1", deps)).status).toBe("unauthenticated");
    expect(service.obtener).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.actualizar).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("R15/R23: validation_error con fieldErrors sin llamar al service", () => {
  it("crear con nombre vacio", async () => {
    const service = fakeService();
    const r = await crearCobro(
      { ...validCrear, nombre: "" },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("nombre");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con campo numerico ausente", async () => {
    const service = fakeService();
    const { valorFlete, ...rest } = validCrear;
    void valorFlete;
    const r = await crearCobro(rest, { cobroService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("valorFlete");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con monto negativo", async () => {
    const service = fakeService();
    const r = await crearCobro(
      { ...validCrear, fulfillment: -1 },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("fulfillment");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con porcentaje > 100", async () => {
    const service = fakeService();
    const r = await crearCobro(
      { ...validCrear, ivaFlete: 150 },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("ivaFlete");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("actualizar con campo desconocido (strict) -> validation_error", async () => {
    const service = fakeService();
    const r = await actualizarCobro(
      "cob-1",
      { idHackeado: "x" },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizar).not.toHaveBeenCalled();
  });
});

describe("R16: crear valido (maestro) -> ok con CobroDTO", () => {
  it("devuelve el cobro con nombre y sin deletedAt", async () => {
    const service = fakeService();
    const r = await crearCobro(validCrear, {
      cobroService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.cobro.nombre).toBe("Tarifa GAM");
      expect(r.cobro).not.toHaveProperty("deletedAt");
    }
    expect(service.crear).toHaveBeenCalledWith(validCrear, MAESTRO);
  });
});

describe("R9-R13: autorizacion end-to-end propagada desde el service", () => {
  it("admin lee (obtener/listar) pero no escribe (crear/actualizar/borrar)", async () => {
    const service = fakeService({
      crear: vi.fn().mockResolvedValue({ status: "forbidden" }),
      actualizar: vi.fn().mockResolvedValue({ status: "forbidden" }),
      borrar: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const deps = { cobroService: service, getActor: getActor(ADMIN) };

    expect((await obtenerCobro("cob-1", deps)).status).toBe("ok");
    expect((await listarCobros({}, deps)).status).toBe("ok");
    expect((await crearCobro(validCrear, deps)).status).toBe("forbidden");
    expect((await actualizarCobro("cob-1", { nombre: "N" }, deps)).status).toBe("forbidden");
    expect((await borrarCobro("cob-1", deps)).status).toBe("forbidden");
  });

  it("adminTienda/mensajero -> forbidden en toda operacion", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const service = fakeService({
        obtener: vi.fn().mockResolvedValue({ status: "forbidden" }),
        listar: vi.fn().mockResolvedValue({ status: "forbidden" }),
        crear: vi.fn().mockResolvedValue({ status: "forbidden" }),
        actualizar: vi.fn().mockResolvedValue({ status: "forbidden" }),
        borrar: vi.fn().mockResolvedValue({ status: "forbidden" }),
      });
      const deps = { cobroService: service, getActor: getActor(actor) };
      expect((await obtenerCobro("cob-1", deps)).status).toBe("forbidden");
      expect((await listarCobros({}, deps)).status).toBe("forbidden");
      expect((await crearCobro(validCrear, deps)).status).toBe("forbidden");
      expect((await actualizarCobro("cob-1", { nombre: "N" }, deps)).status).toBe("forbidden");
      expect((await borrarCobro("cob-1", deps)).status).toBe("forbidden");
    }
  });
});

describe("R17/R21/R25: inexistente -> not_found", () => {
  it("obtener/actualizar/borrar propagan not_found", async () => {
    const service = fakeService({
      obtener: vi.fn().mockResolvedValue({ status: "not_found" }),
      actualizar: vi.fn().mockResolvedValue({ status: "not_found" }),
      borrar: vi.fn().mockResolvedValue({ status: "not_found" }),
    });
    const deps = { cobroService: service, getActor: getActor(MAESTRO) };
    expect((await obtenerCobro("x", deps)).status).toBe("not_found");
    expect((await actualizarCobro("x", { nombre: "N" }, deps)).status).toBe("not_found");
    expect((await borrarCobro("x", deps)).status).toBe("not_found");
  });
});

describe("R18/R19: listar", () => {
  it("devuelve items/page/pageSize/total y acota pageSize sin borrados", async () => {
    const service = fakeService();
    const r = await listarCobros(
      { page: 1, pageSize: 100000 },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toHaveLength(1);
      expect(r.total).toBe(1);
    }
    const arg = (service.listar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.pageSize).toBeLessThanOrEqual(100);
  });
});

describe("R24: borrar -> ok (soft)", () => {
  it("propaga ok", async () => {
    const service = fakeService();
    const r = await borrarCobro("cob-1", { cobroService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    expect(service.borrar).toHaveBeenCalledWith("cob-1", MAESTRO);
  });
});

describe("R26/R27: resultado tipado sin filtrar internals", () => {
  it("crear ok expone solo status/cobro", async () => {
    const service = fakeService();
    const r = await crearCobro(validCrear, {
      cobroService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Object.keys(r)).toEqual(["status", "cobro"]);
    }
  });

  it("validation_error expone solo status/fieldErrors", async () => {
    const service = fakeService();
    const r = await crearCobro(
      { ...validCrear, nombre: "" },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r)).toEqual(["status", "fieldErrors"]);
    }
  });
});

describe("R9: conserva la clave id en fieldErrors", () => {
  it("obtenerCobro con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await obtenerCobro("", { cobroService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.id).toBeDefined();
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.obtener).not.toHaveBeenCalled();
  });

  it("actualizarCobro con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await actualizarCobro(
      "",
      { nombre: "N" },
      { cobroService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.actualizar).not.toHaveBeenCalled();
  });

  it("borrarCobro con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await borrarCobro("", { cobroService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.borrar).not.toHaveBeenCalled();
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
      crearCobro(validCrear, { cobroService: service, getActor: getActor(MAESTRO) }),
    ).rejects.toThrow();
  });
});
