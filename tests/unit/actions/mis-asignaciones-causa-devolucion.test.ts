import { describe, it, expect, vi } from "vitest";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { IMisAsignacionesService } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

// Feature 73 (R6/R9/R10) — la Server Action lee la causa del FormData y la REVALIDA con el
// MISMO schema que usa el cliente (R9): una peticion que evite la UI se rechaza igual, y el
// service NO se invoca (cero efectos: ni gestion, ni estado, ni transicion de la 47).

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const actorMensajero = async () => MENSAJERO;

function buildService(overrides: Partial<IMisAsignacionesService> = {}): IMisAsignacionesService {
  return {
    listarMisAsignaciones: vi.fn(async () => ({
      status: "ok" as const,
      porRecoger: [],
      porGestionar: [],
      ordenEnGestionId: null,
      kpis: { pendientes: 0, entregadas: 0, porCobrar: 0, totalACobrar: 0 },
    // Feature 92/R27/R30: bloque de estado de la ruta que acompana al listado.
    ruta: {
      estado: "vigente" as const,
      calculadaAt: null,
      origenFuente: null,
      paradasSinOptimizar: 0,
    },
    })),
    recogerAsignaciones: vi.fn(async () => ({ status: "ok" as const, recogidas: ["o1"] })),
    escogerParaGestion: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1" })),
    gestionar: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1", estado: "devuelta" })),
    liberarGestion: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

function evidenciaFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "ev.jpg", { type: "image/jpeg" });
}

// Feature 75: un `devuelta` valido incluye AHORA la foto (campo comun `evidencia`, igual que
// entrega/rechazo). El helper la adjunta por defecto para que los tests de causa/motivo sigan
// fallando por SU campo, no por la evidencia.
function fdDevuelta(campos: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("ordenId", "o1");
  fd.set("resultado", "devuelta");
  fd.set("causaDevolucion", "not_found");
  fd.set("motivo", "nadie contesto");
  fd.set("evidencia", evidenciaFile());
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

function inputRecibido(service: IMisAsignacionesService) {
  return (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe("Feature 73 · la action propaga la causa al service (R6/R9)", () => {
  it.each([...CAUSA_DEVOLUCION_SEED])("R9: FormData con causa `%s` -> llega al service", async (causa) => {
    const service = buildService();
    const r = await gestionar(fdDevuelta({ causaDevolucion: causa }), {
      service,
      getActor: actorMensajero,
    });
    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.resultado).toBe("devuelta");
    expect(input.causaDevolucion).toBe(causa);
    expect(input.motivo).toBe("nadie contesto");
  });
});

describe("Feature 75 · la action lee la foto del FormData y la propaga al service", () => {
  it("FormData con evidencia -> el input del service lleva la evidencia leida", async () => {
    const service = buildService();
    const r = await gestionar(fdDevuelta(), { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.resultado).toBe("devuelta");
    expect(input.evidencia).toBeDefined();
    expect(input.evidencia.contentType).toBe("image/jpeg");
  });

  it("FormData SIN evidencia -> validation_error con fieldErrors.evidencia y el service NO se invoca", async () => {
    const service = buildService();
    const fd = fdDevuelta();
    fd.delete("evidencia");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.evidencia).toBeDefined();
    }
    expect(service.gestionar).not.toHaveBeenCalled();
  });
});

describe("Feature 73 · la action rechaza en el borde, sin efectos (R6/R9)", () => {
  it("R6: FormData SIN causa -> validation_error con fieldErrors.causaDevolucion y el service NO se invoca", async () => {
    const service = buildService();
    const fd = fdDevuelta();
    fd.delete("causaDevolucion");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.causaDevolucion).toBeDefined();
    }
    // Cero efectos: ni gestion, ni cambio de estado, ni transicion de seguimiento de la 47.
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R9: causa FUERA del catalogo (peticion que evita la UI) -> validation_error, service NO invocado", async () => {
    const service = buildService();
    const r = await gestionar(fdDevuelta({ causaDevolucion: "otro" }), {
      service,
      getActor: actorMensajero,
    });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.causaDevolucion).toBeDefined();
    }
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R8: sin causa Y sin motivo -> AMBOS fieldErrors en la misma respuesta, sin efectos", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "devuelta");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.causaDevolucion).toBeDefined();
      expect(r.fieldErrors.motivo).toBeDefined();
    }
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R7: con causa pero SIN motivo -> validation_error (la causa no sustituye al motivo)", async () => {
    const service = buildService();
    const r = await gestionar(fdDevuelta({ motivo: "" }), { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors.motivo).toBeDefined();
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("pedido: devuelta SIN evidencia -> validation_error en `evidencia`, service NO invocado", async () => {
    const service = buildService();
    const fd = fdDevuelta();
    fd.delete("evidencia");
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.evidencia).toBeDefined();
    }
    expect(service.gestionar).not.toHaveBeenCalled();
  });
});

describe("Feature 73 · la causa no se cuela en las otras ramas (R10)", () => {
  it("R10: causa en un FormData de `rechazada` -> el input del service NO la lleva", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    fd.set("causaDevolucion", "wrong_address"); // intento de colarla
    fd.set("evidencia", new File([new Uint8Array([1, 2, 3, 4])], "ev.jpg", { type: "image/jpeg" }));
    const r = await gestionar(fd, { service, getActor: actorMensajero });
    expect(r.status).toBe("ok");
    expect(inputRecibido(service)).not.toHaveProperty("causaDevolucion");
  });
});
