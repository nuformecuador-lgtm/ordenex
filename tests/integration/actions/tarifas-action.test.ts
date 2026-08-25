import { describe, it, expect, vi } from "vitest";
import { ConflictError } from "@/lib/errors";
import {
  crearTarifa,
  obtenerTarifa,
  listarTarifas,
  actualizarTarifa,
  borrarTarifa,
} from "@/lib/actions/tarifas";
import type { Actor, ITarifaService } from "@/lib/interfaces/services/ITarifaService";
import type { TarifaDTO } from "@/lib/types/tarifa";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };

const getActor = (actor: Actor) => async (): Promise<Actor | null> => actor;
const noActor = async (): Promise<Actor | null> => null;

function dto(overrides: Partial<TarifaDTO> = {}): TarifaDTO {
  return {
    id: "cob-1",
    tiendaId: "tienda-1",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    zonaId: null,
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function fakeService(overrides: Partial<ITarifaService> = {}): ITarifaService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", tarifa: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", tarifa: dto() }),
    listar: vi.fn().mockResolvedValue({
      status: "ok",
      items: [dto()],
      page: 1,
      pageSize: 20,
      total: 1,
    }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", tarifa: dto() }),
    borrar: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides,
  };
}

const validCrear = {
  tiendaId: "tienda-1",
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
  it("crearTarifa", async () => {
    const service = fakeService();
    const r = await crearTarifa(validCrear, { tarifaService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("obtener/listar/actualizar/borrar tambien rechazan sin sesion", async () => {
    const service = fakeService();
    const deps = { tarifaService: service, getActor: noActor };
    expect((await obtenerTarifa("cob-1", deps)).status).toBe("unauthenticated");
    expect((await listarTarifas({}, deps)).status).toBe("unauthenticated");
    expect((await actualizarTarifa("cob-1", {}, deps)).status).toBe("unauthenticated");
    expect((await borrarTarifa("cob-1", deps)).status).toBe("unauthenticated");
    expect(service.obtener).not.toHaveBeenCalled();
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.actualizar).not.toHaveBeenCalled();
    expect(service.borrar).not.toHaveBeenCalled();
  });
});

describe("R15/R23: validation_error con fieldErrors sin llamar al service", () => {
  it("crear con tiendaId vacio", async () => {
    const service = fakeService();
    const r = await crearTarifa(
      { ...validCrear, tiendaId: "" },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("tiendaId");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con campo numerico ausente", async () => {
    const service = fakeService();
    const { valorFlete, ...rest } = validCrear;
    void valorFlete;
    const r = await crearTarifa(rest, { tarifaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("valorFlete");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con monto negativo", async () => {
    const service = fakeService();
    const r = await crearTarifa(
      { ...validCrear, fulfillment: -1 },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("fulfillment");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("crear con porcentaje > 100", async () => {
    const service = fakeService();
    const r = await crearTarifa(
      { ...validCrear, ivaFlete: 150 },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("ivaFlete");
    }
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("actualizar con campo desconocido (strict) -> validation_error", async () => {
    const service = fakeService();
    const r = await actualizarTarifa(
      "cob-1",
      { idHackeado: "x" },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.actualizar).not.toHaveBeenCalled();
  });
});

// La columna `tarifas.status` se retiro en la 274 y con ella la idea de tarifa
// "inactiva". El borde no necesito una regla nueva: `actualizarTarifaSchema` es
// `.strict()`, asi que `status` entra por la misma puerta que cualquier campo
// desconocido y el service ni se entera.
describe("274/R11: `status` en una actualizacion -> validation_error sin tocar el service", () => {
  for (const valor of ["activo", "inactivo"]) {
    it(`actualizarTarifa con { status: "${valor}" }`, async () => {
      const service = fakeService();
      const r = await actualizarTarifa(
        "cob-1",
        { status: valor },
        { tarifaService: service, getActor: getActor(MAESTRO) },
      );
      expect(r.status).toBe("validation_error");
      expect(service.actualizar).not.toHaveBeenCalled();
    });
  }

  it("crearTarifa con `status` tambien se rechaza en el borde", async () => {
    const service = fakeService();
    const r = await crearTarifa(
      { ...validCrear, status: "activo" },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });
});

// R14/R15 se deciden en el service (el par efectivo de un `actualizar` depende de
// la fila existente). Lo que la accion debe garantizar es que ese `validation_error`
// llega intacto al llamador, con sus dos claves y sin envolverlo en un 500.
describe("274/R14-R15: la accion propaga el validation_error de alcance del service", () => {
  const SIN_ALCANCE = {
    status: "validation_error" as const,
    fieldErrors: {
      tiendaId: ["una tarifa debe acotarse por tienda, por zona o por ambas"],
      zonaId: ["una tarifa debe acotarse por tienda, por zona o por ambas"],
    },
  };

  it("crear sin tienda y sin zona", async () => {
    const service = fakeService({ crear: vi.fn().mockResolvedValue(SIN_ALCANCE) });
    const { tiendaId, ...sinTienda } = validCrear;
    void tiendaId;

    const r = await crearTarifa(sinTienda, {
      tarifaService: service,
      getActor: getActor(MAESTRO),
    });

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors).sort()).toEqual(["tiendaId", "zonaId"]);
    }
  });

  it("actualizar dejando el par en (null, null)", async () => {
    const service = fakeService({ actualizar: vi.fn().mockResolvedValue(SIN_ALCANCE) });

    const r = await actualizarTarifa(
      "cob-1",
      { zonaId: null },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    // el schema dejo pasar el input (es valido a nivel de forma); la decision fue
    // del service, que si conoce la fila existente.
    expect(service.actualizar).toHaveBeenCalledWith("cob-1", { zonaId: null }, MAESTRO);
  });
});

describe("R16: crear valido (maestro) -> ok con TarifaDTO", () => {
  it("devuelve la tarifa con tiendaId, sin deletedAt y sin status (274/R12)", async () => {
    const service = fakeService();
    const r = await crearTarifa(validCrear, {
      tarifaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.tarifa.tiendaId).toBe("tienda-1");
      expect(r.tarifa).not.toHaveProperty("deletedAt");
      // 274/R12: ausencia de CLAVE, no de valor.
      expect(Object.keys(r.tarifa)).not.toContain("status");
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
    const deps = { tarifaService: service, getActor: getActor(ADMIN) };

    expect((await obtenerTarifa("cob-1", deps)).status).toBe("ok");
    expect((await listarTarifas({}, deps)).status).toBe("ok");
    expect((await crearTarifa(validCrear, deps)).status).toBe("forbidden");
    expect((await actualizarTarifa("cob-1", { tiendaId: "tienda-2" }, deps)).status).toBe("forbidden");
    expect((await borrarTarifa("cob-1", deps)).status).toBe("forbidden");
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
      const deps = { tarifaService: service, getActor: getActor(actor) };
      expect((await obtenerTarifa("cob-1", deps)).status).toBe("forbidden");
      expect((await listarTarifas({}, deps)).status).toBe("forbidden");
      expect((await crearTarifa(validCrear, deps)).status).toBe("forbidden");
      expect((await actualizarTarifa("cob-1", { tiendaId: "tienda-2" }, deps)).status).toBe("forbidden");
      expect((await borrarTarifa("cob-1", deps)).status).toBe("forbidden");
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
    const deps = { tarifaService: service, getActor: getActor(MAESTRO) };
    expect((await obtenerTarifa("x", deps)).status).toBe("not_found");
    expect((await actualizarTarifa("x", { tiendaId: "tienda-2" }, deps)).status).toBe("not_found");
    expect((await borrarTarifa("x", deps)).status).toBe("not_found");
  });
});

describe("R18/R19: listar", () => {
  it("devuelve items/page/pageSize/total y acota pageSize sin borrados", async () => {
    const service = fakeService();
    const r = await listarTarifas(
      { page: 1, pageSize: 100000 },
      { tarifaService: service, getActor: getActor(MAESTRO) },
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

describe("borrar (FISICO) -> ok", () => {
  it("propaga ok", async () => {
    const service = fakeService();
    const r = await borrarTarifa("cob-1", { tarifaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("ok");
    expect(service.borrar).toHaveBeenCalledWith("cob-1", MAESTRO);
  });

  // ANTES esta accion LANZABA ante un `conflict` ("el dominio de tarifas nunca produce
  // un conflicto de unicidad"), lo que hoy seria un 500 en la cara del maestro: con el
  // unico (zona_id, tienda_id) y la FK RESTRICT de `cierre_detail`, el conflicto es un
  // resultado legitimo. El test fija que SALE como estado, no como excepcion.
  it("propaga conflict en vez de lanzar", async () => {
    const service = fakeService({ borrar: vi.fn().mockResolvedValue({ status: "conflict" }) });
    const r = await borrarTarifa("cob-1", { tarifaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("conflict");
  });

  it("crear traduce el ConflictError del repositorio a status conflict", async () => {
    const service = fakeService({
      crear: vi.fn().mockRejectedValue(new ConflictError("par duplicado")),
    });
    const r = await crearTarifa(validCrear, {
      tarifaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("conflict");
  });
});

describe("R26/R27: resultado tipado sin filtrar internals", () => {
  it("crear ok expone solo status/tarifa", async () => {
    const service = fakeService();
    const r = await crearTarifa(validCrear, {
      tarifaService: service,
      getActor: getActor(MAESTRO),
    });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Object.keys(r)).toEqual(["status", "tarifa"]);
    }
  });

  it("validation_error expone solo status/fieldErrors", async () => {
    const service = fakeService();
    const r = await crearTarifa(
      { ...validCrear, tiendaId: "" },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r)).toEqual(["status", "fieldErrors"]);
    }
  });
});

describe("R9: conserva la clave id en fieldErrors", () => {
  it("obtenerTarifa con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await obtenerTarifa("", { tarifaService: service, getActor: getActor(MAESTRO) });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.id).toBeDefined();
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.obtener).not.toHaveBeenCalled();
  });

  it("actualizarTarifa con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await actualizarTarifa(
      "",
      { tiendaId: "tienda-2" },
      { tarifaService: service, getActor: getActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["id"]);
    }
    expect(service.actualizar).not.toHaveBeenCalled();
  });

  it("borrarTarifa con id vacio -> validation_error con solo la clave id", async () => {
    const service = fakeService();
    const r = await borrarTarifa("", { tarifaService: service, getActor: getActor(MAESTRO) });
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
      crearTarifa(validCrear, { tarifaService: service, getActor: getActor(MAESTRO) }),
    ).rejects.toThrow();
  });
});
