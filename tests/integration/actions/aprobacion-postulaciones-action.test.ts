import { describe, it, expect, vi } from "vitest";
import {
  listarPostulacionesPendientes,
  aprobarPostulacion,
  rechazarPostulacion,
} from "@/lib/actions/aprobacion-postulaciones";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAprobacionPostulacionService } from "@/lib/interfaces/services/IAprobacionPostulacionService";

// Feature 22 — integration del borde (Server Actions). Cubre R1, R4, R20, R21.

const ACTOR: Actor = { usuarioId: "actor-1", rol: "maestro" };
const getActor = async (): Promise<Actor | null> => ACTOR;
const noActor = async (): Promise<Actor | null> => null;

function fakeService(overrides: Partial<IAprobacionPostulacionService> = {}): IAprobacionPostulacionService {
  return {
    listarPendientes: vi.fn().mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 20, total: 0 }),
    aprobar: vi.fn().mockResolvedValue({ status: "ok", usuarioId: "usr-1", estado: "activo" }),
    rechazar: vi.fn().mockResolvedValue({ status: "ok", usuarioId: "usr-1", estado: "inactivo" }),
    ...overrides,
  };
}

describe("R4: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("listarPostulacionesPendientes", async () => {
    const service = fakeService();
    const r = await listarPostulacionesPendientes({}, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarPendientes).not.toHaveBeenCalled();
  });

  it("aprobarPostulacion", async () => {
    const service = fakeService();
    const r = await aprobarPostulacion("usr-1", { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.aprobar).not.toHaveBeenCalled();
  });

  it("rechazarPostulacion", async () => {
    const service = fakeService();
    const r = await rechazarPostulacion("usr-1", { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.rechazar).not.toHaveBeenCalled();
  });
});

describe("R21: id invalido -> validation_error sin llamar al service", () => {
  it("aprobarPostulacion con id vacio", async () => {
    const service = fakeService();
    const r = await aprobarPostulacion("", { service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.aprobar).not.toHaveBeenCalled();
  });

  it("rechazarPostulacion con id no-string", async () => {
    const service = fakeService();
    const r = await rechazarPostulacion(123, { service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.rechazar).not.toHaveBeenCalled();
  });
});

describe("R20: mapea los status de dominio al resultado tipado", () => {
  it("forbidden (listar)", async () => {
    const service = fakeService({ listarPendientes: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await listarPostulacionesPendientes({}, { service, getActor });
    expect(r.status).toBe("forbidden");
  });

  it("not_found (aprobar)", async () => {
    const service = fakeService({ aprobar: vi.fn().mockResolvedValue({ status: "not_found" }) });
    const r = await aprobarPostulacion("usr-x", { service, getActor });
    expect(r.status).toBe("not_found");
  });

  it("conflict (aprobar)", async () => {
    const service = fakeService({ aprobar: vi.fn().mockResolvedValue({ status: "conflict" }) });
    const r = await aprobarPostulacion("usr-1", { service, getActor });
    expect(r.status).toBe("conflict");
  });

  it("conflict (rechazar)", async () => {
    const service = fakeService({ rechazar: vi.fn().mockResolvedValue({ status: "conflict" }) });
    const r = await rechazarPostulacion("usr-1", { service, getActor });
    expect(r.status).toBe("conflict");
  });

  it("ok aprobar propaga usuarioId y estado", async () => {
    const service = fakeService();
    const r = await aprobarPostulacion("usr-1", { service, getActor });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r).toMatchObject({ usuarioId: "usr-1", estado: "activo" });
    }
    expect(service.aprobar).toHaveBeenCalledWith("usr-1", ACTOR);
  });

  it("ok listar propaga items/total", async () => {
    const service = fakeService({
      listarPendientes: vi.fn().mockResolvedValue({
        status: "ok",
        items: [{ usuarioId: "usr-1" }],
        page: 2,
        pageSize: 20,
        total: 30,
      }),
    });
    const r = await listarPostulacionesPendientes({ page: 2 }, { service, getActor });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.total).toBe(30);
      expect(r.items).toHaveLength(1);
    }
  });
});
