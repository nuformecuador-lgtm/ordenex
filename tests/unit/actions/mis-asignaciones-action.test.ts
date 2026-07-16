import { describe, it, expect, vi } from "vitest";
import {
  escogerParaGestion,
  gestionar,
  liberarGestion,
  listarMisAsignaciones,
  recogerAsignaciones,
} from "@/lib/actions/mis-asignaciones";
import type { IMisAsignacionesService } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

function imagenFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "ev.jpg", { type: "image/jpeg" });
}

function fechaFuturaISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

function buildService(overrides: Partial<IMisAsignacionesService> = {}): IMisAsignacionesService {
  return {
    listarMisAsignaciones: vi.fn(async () => ({
      status: "ok" as const,
      porRecoger: [],
      porGestionar: [],
      ordenEnGestionId: null,
      kpis: { pendientes: 0, entregadas: 0, porCobrar: 0, totalACobrar: 0 },
    })),
    recogerAsignaciones: vi.fn(async () => ({ status: "ok" as const, recogidas: ["o1"] })),
    escogerParaGestion: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1" })),
    gestionar: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1", estado: "entregada" })),
    liberarGestion: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

const noActor = async () => null;
const actorMensajero = async () => MENSAJERO;

// --- unauthenticated en el borde (R12) ---

describe("R12: unauthenticated antes de tocar el service", () => {
  it("listar sin actor -> unauthenticated", async () => {
    const service = buildService();
    const r = await listarMisAsignaciones({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarMisAsignaciones).not.toHaveBeenCalled();
  });

  it("recoger sin actor -> unauthenticated", async () => {
    const r = await recogerAsignaciones({ ordenIds: ["o1"] }, { service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });

  it("escoger sin actor -> unauthenticated", async () => {
    const r = await escogerParaGestion({ ordenId: "o1" }, { service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });

  it("gestionar sin actor -> unauthenticated", async () => {
    const fd = new FormData();
    const r = await gestionar(fd, { service: buildService(), getActor: noActor });
    expect(r.status).toBe("unauthenticated");
  });
});

// --- recoger / escoger delegan ---

describe("recoger / escoger", () => {
  it("recoger valido delega en el service con los ordenIds", async () => {
    const service = buildService();
    const r = await recogerAsignaciones({ ordenIds: ["o1", "o2"] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(service.recogerAsignaciones).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] }, MENSAJERO);
  });

  it("recoger con lista vacia -> validation_error (zod), sin service", async () => {
    const service = buildService();
    const r = await recogerAsignaciones({ ordenIds: [] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.recogerAsignaciones).not.toHaveBeenCalled();
  });

  it("escoger valido delega con el ordenId", async () => {
    const service = buildService();
    const r = await escogerParaGestion({ ordenId: "o1" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(service.escogerParaGestion).toHaveBeenCalledWith("o1", MENSAJERO);
  });
});

// --- gestionar: zod discriminado + lectura de binario ---

describe("gestionar — validacion de borde (R22/R24/R25/R27/R29)", () => {
  function fdEntrega(overrides: Record<string, string> = {}, withFile = true): FormData {
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "entregada");
    fd.set("montoRecibido", "100");
    fd.set("metodoPago", "efectivo");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    if (withFile) fd.set("evidencia", imagenFile());
    return fd;
  }

  it("R22: entrega valida delega con montoRecibido number, metodo y bytes de evidencia", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega(), { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.resultado).toBe("entregada");
    expect(input.montoRecibido).toBe(100);
    expect(input.metodoPago).toBe("efectivo");
    expect(input.evidencia.bytes).toBeInstanceOf(Uint8Array);
  });

  it("R22: entrega sin foto -> validation_error, sin service", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega({}, false), { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R22: entrega con monto <= 0 -> validation_error", async () => {
    const service = buildService();
    const r = await gestionar(fdEntrega({ montoRecibido: "0" }), { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
  });

  it("R25: reprogramar con fecha pasada -> validation_error", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "reprogramada");
    fd.set("fechaReprogramacion", "2000-01-01");
    fd.set("motivo", "x");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R25: reprogramar valido delega", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "reprogramada");
    fd.set("fechaReprogramacion", fechaFuturaISO());
    fd.set("motivo", "cliente no estaba");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.resultado).toBe("reprogramada");
  });

  it("R27: devolucion sin motivo -> validation_error", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "devuelta");
    fd.set("motivo", "");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
  });

  it("R29: rechazo sin foto -> validation_error", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R29: rechazo valido (foto + motivo) delega con bytes", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    fd.set("evidencia", imagenFile());
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const [input] = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.resultado).toBe("rechazada");
    expect(input.evidencia.bytes).toBeInstanceOf(Uint8Array);
  });
});

// --- menor-1: errores EXCEPCIONALES pasan por withErrorHandler ---

describe("menor-1: withErrorHandler envuelve los cuerpos de las actions", () => {
  it("un error EXCEPCIONAL del service NO se propaga crudo (pasa por el manejador)", async () => {
    // Con el patron de ordenes-guia.ts: withErrorHandler captura y normaliza a
    // INTERNAL; toMisAsignacionesActionError lo re-lanza como AppErrorCode
    // inesperado. Lo relevante: el error crudo "db down" NO escapa sin pasar por
    // el manejador (antes se propagaba tal cual).
    const service = buildService({
      gestionar: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "devuelta");
    // Feature 73/R6: sin causa este FormData ya no llegaria al service (moriria en el borde
    // como validation_error) y el test dejaria de probar lo suyo — que un error EXCEPCIONAL
    // del service pasa por withErrorHandler. Se añade la causa para que el input siga siendo
    // valido; lo que el test AFIRMA no cambia.
    fd.set("causaDevolucion", "not_found");
    fd.set("motivo", "cliente no estaba");
    // Pedido: la devolución ahora exige evidencia; sin ella el input moriría en el borde y
    // el test dejaría de probar lo suyo. Se añade una imagen válida para llegar al service.
    fd.set("evidencia", imagenFile());

    await expect(gestionar(fd, { service, getActor: actorMensajero })).rejects.toThrow(
      /AppErrorCode inesperado/,
    );
    // El mensaje crudo del service ya NO se propaga sin pasar por el manejador.
    await expect(gestionar(fd, { service, getActor: actorMensajero })).rejects.not.toThrow(
      /^db down$/,
    );
  });

  it("unauthenticated (actor ausente) sigue devolviendose a traves de withErrorHandler", async () => {
    const service = buildService({
      gestionar: vi.fn(async () => {
        throw new Error("no deberia llamarse");
      }),
    });
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "devuelta");
    fd.set("motivo", "x");
    const r = await gestionar(fd, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("validation_error (zod invalido) sigue devolviendose a traves de withErrorHandler", async () => {
    const service = buildService();
    // recoger con lista vacia: ZodError -> VALIDATION_ERROR normalizado.
    const r = await recogerAsignaciones({ ordenIds: [] }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.recogerAsignaciones).not.toHaveBeenCalled();
  });
});

// --- menor-3: liberarGestion (R35) ---

describe("menor-3: liberarGestion action (R35)", () => {
  it("actor ausente -> unauthenticated, sin tocar el service", async () => {
    const service = buildService();
    const r = await liberarGestion({ ordenId: "o1" }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.liberarGestion).not.toHaveBeenCalled();
  });

  it("zod invalido (ordenId vacio) -> validation_error, sin tocar el service", async () => {
    const service = buildService();
    const r = await liberarGestion({ ordenId: "" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    expect(service.liberarGestion).not.toHaveBeenCalled();
  });

  it("ok: delega en el service con el ordenId y el actor", async () => {
    const service = buildService();
    const r = await liberarGestion({ ordenId: "o1" }, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(service.liberarGestion).toHaveBeenCalledWith("o1", MENSAJERO);
  });
});
