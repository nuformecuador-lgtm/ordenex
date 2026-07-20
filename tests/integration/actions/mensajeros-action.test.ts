import { describe, it, expect, vi } from "vitest";
import { listarMensajeros, resumenCargaMasiva, asignarMensajeroSugerido } from "@/lib/actions/mensajeros";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAsignacionMensajeroService } from "@/lib/interfaces/services/IAsignacionMensajeroService";

const ACTOR: Actor = { usuarioId: "store1", rol: "adminTienda" };
const getActor = async (): Promise<Actor | null> => ACTOR;
const noActor = async (): Promise<Actor | null> => null;

function fakeService(overrides: Partial<IAsignacionMensajeroService> = {}): IAsignacionMensajeroService {
  return {
    listarMensajeros: vi.fn().mockResolvedValue({
      status: "ok",
      mensajeros: [{ id: "msg-1", nombre: "Ana", zonaId: "z1", zonaNombre: "Norte" }],
    }),
    resumenCargaMasiva: vi.fn().mockResolvedValue({ status: "ok", ordenes: [] }),
    asignarMensajeroSugerido: vi.fn().mockResolvedValue({ status: "ok", asignadas: 0 }),
    ...overrides,
  };
}

describe("R4/R17: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("listarMensajeros", async () => {
    const service = fakeService();
    const r = await listarMensajeros({ asignacionService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarMensajeros).not.toHaveBeenCalled();
  });

  it("resumenCargaMasiva", async () => {
    const service = fakeService();
    const r = await resumenCargaMasiva(
      { numRemisiones: ["REM-1"] },
      { asignacionService: service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.resumenCargaMasiva).not.toHaveBeenCalled();
  });

  it("asignarMensajeroSugerido", async () => {
    const service = fakeService();
    const r = await asignarMensajeroSugerido(
      { asignaciones: [] },
      { asignacionService: service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.asignarMensajeroSugerido).not.toHaveBeenCalled();
  });
});

describe("rol no autorizado -> forbidden propagado del service (R5/R11)", () => {
  it("listarMensajeros forbidden", async () => {
    const service = fakeService({
      listarMensajeros: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await listarMensajeros({ asignacionService: service, getActor });
    expect(r.status).toBe("forbidden");
  });

  it("resumenCargaMasiva forbidden", async () => {
    const service = fakeService({
      resumenCargaMasiva: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await resumenCargaMasiva(
      { numRemisiones: ["REM-1"] },
      { asignacionService: service, getActor },
    );
    expect(r.status).toBe("forbidden");
  });

  it("asignarMensajeroSugerido forbidden", async () => {
    const service = fakeService({
      asignarMensajeroSugerido: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const r = await asignarMensajeroSugerido(
      { asignaciones: [{ ordenId: "ord-1", mensajeroId: "msg-1" }] },
      { asignacionService: service, getActor },
    );
    expect(r.status).toBe("forbidden");
  });
});

describe("R19: input invalido -> validation_error sin llamar al service", () => {
  it("resumenCargaMasiva con numRemisiones vacio", async () => {
    const service = fakeService();
    const r = await resumenCargaMasiva({ numRemisiones: [] }, { asignacionService: service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.resumenCargaMasiva).not.toHaveBeenCalled();
  });

  it("asignarMensajeroSugerido con ordenId vacio en una asignacion", async () => {
    const service = fakeService();
    const r = await asignarMensajeroSugerido(
      { asignaciones: [{ ordenId: "", mensajeroId: "msg-1" }] },
      { asignacionService: service, getActor },
    );
    expect(r.status).toBe("validation_error");
    expect(service.asignarMensajeroSugerido).not.toHaveBeenCalled();
  });

  it("asignarMensajeroSugerido con lista vacia es valida (R18, no dispara validation_error)", async () => {
    const service = fakeService();
    const r = await asignarMensajeroSugerido({ asignaciones: [] }, { asignacionService: service, getActor });
    expect(r.status).toBe("ok");
    expect(service.asignarMensajeroSugerido).toHaveBeenCalledWith({ asignaciones: [] }, ACTOR);
  });
});

describe("exito: propaga el resultado del service sin filtrar internals", () => {
  it("listarMensajeros ok", async () => {
    const service = fakeService();
    const r = await listarMensajeros({ asignacionService: service, getActor });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.mensajeros).toEqual([{ id: "msg-1", nombre: "Ana", zonaId: "z1", zonaNombre: "Norte" }]);
    }
  });

  it("resumenCargaMasiva ok", async () => {
    const service = fakeService({
      resumenCargaMasiva: vi.fn().mockResolvedValue({
        status: "ok",
        ordenes: [
          {
            id: "ord-1",
            numGuia: 1,
            numRemision: "REM-1",
            destinatario: "Ana",
            telefonoDest: "099",
            producto: "Caja",
            montoCobrar: null,
            direccion: null,
            mensajeroSugeridoId: null,
            mensajeroSugeridoNombre: null,
          },
        ],
      }),
    });
    const r = await resumenCargaMasiva(
      { numRemisiones: ["REM-1"] },
      { asignacionService: service, getActor },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.ordenes).toHaveLength(1);
      expect(r.ordenes[0]).not.toHaveProperty("deletedAt");
    }
    expect(service.resumenCargaMasiva).toHaveBeenCalledWith({ numRemisiones: ["REM-1"] }, ACTOR);
  });

  it("asignarMensajeroSugerido ok", async () => {
    const service = fakeService({
      asignarMensajeroSugerido: vi.fn().mockResolvedValue({ status: "ok", asignadas: 2 }),
    });
    const r = await asignarMensajeroSugerido(
      { asignaciones: [{ ordenId: "ord-1", mensajeroId: "msg-1" }] },
      { asignacionService: service, getActor },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.asignadas).toBe(2);
  });
});

describe("R13: validation_error propagado del service con fieldErrors", () => {
  it("asignarMensajeroSugerido con mensajeroId invalido", async () => {
    const service = fakeService({
      asignarMensajeroSugerido: vi.fn().mockResolvedValue({
        status: "validation_error",
        fieldErrors: { mensajeroId: ["mensajeroId no valido"] },
      }),
    });
    const r = await asignarMensajeroSugerido(
      { asignaciones: [{ ordenId: "ord-1", mensajeroId: "no-mensajero" }] },
      { asignacionService: service, getActor },
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("mensajeroId");
    }
  });
});
