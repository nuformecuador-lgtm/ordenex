import { describe, it, expect, vi, afterEach } from "vitest";
import { reprogramarNovedad, recuperarABodega } from "@/lib/actions/resolver-novedad";
import type { IReprogramacionTiendaService } from "@/lib/interfaces/services/IReprogramacionTiendaService";
import type { IRecuperacionBodegaService } from "@/lib/interfaces/services/IRecuperacionBodegaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 100 (T1.4/T2.4) — borde (Server Actions) de resolver la novedad. `unauthenticated` (sin
// sesion, R22) y `validation_error` (ordenId no-uuid / fecha no futura, R4/R23) se resuelven en el
// borde ANTES del service; el resto (ok/forbidden/not_found/conflict/config_error) los devuelve el
// service tal cual. R24: las acciones no registran PII (no reciben ni loguean telefono/destinatario).

const TIENDA: Actor = { usuarioId: "store-1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ORDEN_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
// Fechas independientes del reloj real: 2099 siempre es futura, 2020 siempre es pasada.
const FECHA_FUTURA = "2099-12-31";
const FECHA_PASADA = "2020-01-01";

const noActor = async () => null;
const actorTienda = async () => TIENDA;
const actorMaestro = async () => MAESTRO;

function reprogramarService(
  overrides: Partial<IReprogramacionTiendaService> = {},
): IReprogramacionTiendaService {
  return { reprogramar: vi.fn(async () => ({ status: "ok" as const })), ...overrides };
}

function recuperarService(
  overrides: Partial<IRecuperacionBodegaService> = {},
): IRecuperacionBodegaService {
  return { recuperar: vi.fn(async () => ({ status: "ok" as const })), ...overrides };
}

afterEach(() => vi.restoreAllMocks());

describe("reprogramarNovedad (Server Action)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service (R22)", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("ordenId no-uuid -> validation_error, sin tocar el service (R23)", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: "no-es-uuid", fechaReprogramacion: FECHA_FUTURA },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("fecha en el pasado -> validation_error, sin tocar el service (R4)", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_PASADA },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("fecha con formato invalido / inexistente -> validation_error (R4/R23)", async () => {
    const service = reprogramarService();
    for (const fecha of ["31-12-2099", "2099-13-40", "manana"]) {
      const r = await reprogramarNovedad(
        { ordenId: ORDEN_UUID, fechaReprogramacion: fecha },
        { service, getActor: actorTienda },
      );
      expect(r.status).toBe("validation_error");
    }
    expect(service.reprogramar).not.toHaveBeenCalled();
  });

  it("input valido delega en el service con actor; motivo opcional ausente -> null", async () => {
    const service = reprogramarService();
    const r = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("ok");
    expect(service.reprogramar).toHaveBeenCalledWith(ORDEN_UUID, FECHA_FUTURA, null, TIENDA);
  });

  it("motivo en blanco (solo espacios) se normaliza a null (Q1: opcional)", async () => {
    const service = reprogramarService();
    await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA, motivo: "   " },
      { service, getActor: actorTienda },
    );
    expect(service.reprogramar).toHaveBeenCalledWith(ORDEN_UUID, FECHA_FUTURA, null, TIENDA);
  });

  it("motivo presente se pasa (trim) al service", async () => {
    const service = reprogramarService();
    await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA, motivo: "  cliente pidio  " },
      { service, getActor: actorTienda },
    );
    expect(service.reprogramar).toHaveBeenCalledWith(ORDEN_UUID, FECHA_FUTURA, "cliente pidio", TIENDA);
  });

  it("forbidden/conflict del service pasan tal cual como resultado de dominio", async () => {
    const forbidden = reprogramarService({
      reprogramar: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const rF = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service: forbidden, getActor: actorTienda },
    );
    expect(rF.status).toBe("forbidden");

    const conflict = reprogramarService({
      reprogramar: vi.fn(async () => ({ status: "conflict" as const, motivo: "ya no esta en devuelta" })),
    });
    const rC = await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA },
      { service: conflict, getActor: actorTienda },
    );
    expect(rC.status).toBe("conflict");
  });

  it("R24: no registra PII ni nada en consola en el camino ok", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await reprogramarNovedad(
      { ordenId: ORDEN_UUID, fechaReprogramacion: FECHA_FUTURA, motivo: "x" },
      { service: reprogramarService(), getActor: actorTienda },
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("recuperarABodega (Server Action)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service (R22)", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.recuperar).not.toHaveBeenCalled();
  });

  it("ordenId no-uuid -> validation_error, sin tocar el service (R23)", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({ ordenId: "no-es-uuid" }, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.recuperar).not.toHaveBeenCalled();
  });

  it("input sin ordenId (forma invalida) -> validation_error, sin service", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({}, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.recuperar).not.toHaveBeenCalled();
  });

  it("uuid valido delega en el service con el actor y devuelve ok", async () => {
    const service = recuperarService();
    const r = await recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("ok");
    expect(service.recuperar).toHaveBeenCalledWith(ORDEN_UUID, MAESTRO);
  });

  it("forbidden del service (no responsable) pasa tal cual (R15)", async () => {
    const service = recuperarService({
      recuperar: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro });
    expect(r.status).toBe("forbidden");
  });

  it("un error EXCEPCIONAL del service NO se propaga crudo (withErrorHandler)", async () => {
    const service = recuperarService({
      recuperar: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      recuperarABodega({ ordenId: ORDEN_UUID }, { service, getActor: actorMaestro }),
    ).rejects.toThrow(/AppErrorCode inesperado/);
  });
});
