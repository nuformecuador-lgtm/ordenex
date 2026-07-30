import { describe, it, expect, vi } from "vitest";
import {
  aprobarIncidente,
  listarIncidentes,
  rechazarIncidente,
  reportarIncidente,
  retractarIncidente,
  verIncidente,
} from "@/lib/actions/incidentes";
import type { IIncidenteAdminService } from "@/lib/interfaces/services/IIncidenteAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 158 (T1.31, camino del ADMIN) — tests de integracion de las Server Actions (patron
// `cierres-admin-action.test.ts`). Cubre los CINCO verbos: `unauthenticated` sin sesion,
// `validation_error` de zod en el borde, y la delegacion en el service con deps inyectadas.

const INCIDENTE_ID = "11111111-1111-4111-8111-111111111111";
const ORDEN_ID = "22222222-2222-4222-8222-222222222222";
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const noActor = async () => null;
const actorMaestro = async () => MAESTRO;

function fakeService(overrides: Partial<IIncidenteAdminService> = {}): IIncidenteAdminService {
  return {
    listarIncidentes: vi.fn(async () => ({
      status: "ok",
      pendientes: [],
      historico: [],
      sinZona: false,
    })),
    verIncidente: vi.fn(async () => ({ status: "no_encontrada" })),
    reportar: vi.fn(async () => ({ status: "ok", incidenteId: INCIDENTE_ID })),
    aprobar: vi.fn(async () => ({ status: "ok", incidenteId: INCIDENTE_ID, estado: "aprobado" })),
    rechazar: vi.fn(async () => ({ status: "ok", incidenteId: INCIDENTE_ID, estado: "rechazado" })),
    retractar: vi.fn(async () => ({
      status: "ok",
      incidenteId: INCIDENTE_ID,
      estado: "rechazado",
    })),
    ...overrides,
  } as IIncidenteAdminService;
}

/** `FormData` del reporte, con N fotos como File-like (lo que manda el modal). */
function formDataReporte(over: { causa?: string; motivo?: string; fotos?: number } = {}): FormData {
  const fd = new FormData();
  fd.set("ordenId", ORDEN_ID);
  fd.set("causa", over.causa ?? "danado");
  fd.set("motivo", over.motivo ?? "caja aplastada");
  for (let i = 0; i < (over.fotos ?? 1); i++) {
    fd.append("evidencia", new File([new Uint8Array([1, 2, 3])], `f${i}.jpg`, { type: "image/jpeg" }));
  }
  return fd;
}

describe("incidentes actions — unauthenticated en el borde", () => {
  it.each([
    ["listarIncidentes", async (s: IIncidenteAdminService) => listarIncidentes({ service: s, getActor: noActor })],
    ["verIncidente", async (s: IIncidenteAdminService) => verIncidente({ incidenteId: INCIDENTE_ID }, { service: s, getActor: noActor })],
    ["aprobarIncidente", async (s: IIncidenteAdminService) => aprobarIncidente({ incidenteId: INCIDENTE_ID, monto: "10.00" }, { service: s, getActor: noActor })],
    ["rechazarIncidente", async (s: IIncidenteAdminService) => rechazarIncidente({ incidenteId: INCIDENTE_ID, motivo: "no" }, { service: s, getActor: noActor })],
    ["retractarIncidente", async (s: IIncidenteAdminService) => retractarIncidente({ incidenteId: INCIDENTE_ID }, { service: s, getActor: noActor })],
  ])("%s sin sesion -> unauthenticated, sin tocar el service", async (_n, invocar) => {
    const service = fakeService();
    const r = await invocar(service);
    expect(r.status).toBe("unauthenticated");
    expect(service.listarIncidentes).not.toHaveBeenCalled();
    expect(service.verIncidente).not.toHaveBeenCalled();
    expect(service.aprobar).not.toHaveBeenCalled();
    expect(service.rechazar).not.toHaveBeenCalled();
    expect(service.retractar).not.toHaveBeenCalled();
  });

  it("reportarIncidente sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await reportarIncidente(formDataReporte(), { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.reportar).not.toHaveBeenCalled();
  });
});

describe("R41/R45/R46 — reportar: el borde arma el input y REVALIDA en servidor", () => {
  it("un FormData valido llega al service con la causa, el motivo y las N fotos leidas", async () => {
    const service = fakeService();

    const r = await reportarIncidente(formDataReporte({ fotos: 2 }), {
      service,
      getActor: actorMaestro,
    });

    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID });
    expect(service.reportar).toHaveBeenCalledTimes(1);
    const [input, actor] = (service.reportar as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.ordenId).toBe(ORDEN_ID);
    expect(input.causa).toBe("danado");
    expect(input.motivo).toBe("caja aplastada");
    expect(input.evidencias).toHaveLength(2);
    expect(input.evidencias[0].contentType).toBe("image/jpeg");
    expect(input.evidencias[0].bytes).toBeInstanceOf(Uint8Array);
    expect(actor).toEqual(MAESTRO);
  });

  it.each([
    ["sin ninguna foto (Q-B: obligatoria SIEMPRE)", { fotos: 0 }],
    ["con la causa fuera de la lista cerrada", { causa: "otro" }],
    ["con el motivo vacio", { motivo: "   " }],
  ])("%s -> validation_error en el borde, sin tocar el service", async (_caso, over) => {
    const service = fakeService();
    const r = await reportarIncidente(formDataReporte(over), { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.reportar).not.toHaveBeenCalled();
  });

  it("un archivo con MIME no permitido se rechaza EN EL SERVIDOR (no basta el cliente)", async () => {
    const fd = new FormData();
    fd.set("ordenId", ORDEN_ID);
    fd.set("causa", "robado");
    fd.set("motivo", "asalto");
    fd.append("evidencia", new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }));
    const service = fakeService();

    const r = await reportarIncidente(fd, { service, getActor: actorMaestro });

    expect(r.status).toBe("validation_error");
    expect(service.reportar).not.toHaveBeenCalled();
  });

  it("el conflicto de dominio (orden no reportable / duplicado) viaja TAL CUAL", async () => {
    const service = fakeService({
      reportar: vi.fn(async () => ({ status: "conflict" as const, motivo: "ya tiene un incidente" })),
    });
    const r = await reportarIncidente(formDataReporte(), { service, getActor: actorMaestro });
    expect(r).toEqual({ status: "conflict", motivo: "ya tiene un incidente" });
  });
});

describe("R50/R55 — aprobar: el monto viaja STRING y el borde lo valida", () => {
  it("delega con el monto TAL CUAL (sin coercion a number)", async () => {
    const service = fakeService();

    const r = await aprobarIncidente(
      { incidenteId: INCIDENTE_ID, monto: "2500.00" },
      { service, getActor: actorMaestro },
    );

    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID, estado: "aprobado" });
    expect(service.aprobar).toHaveBeenCalledWith(INCIDENTE_ID, "2500.00", MAESTRO);
    const monto = (service.aprobar as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(typeof monto).toBe("string");
  });

  it.each([
    ["vacio", ""],
    ["cero", "0"],
    ["negativo", "-1.00"],
    ["con tres decimales", "1.005"],
    ["con coma", "1,00"],
    ["number", 2500.0],
    ["por encima del tope de DECIMAL(12,2)", "10000000000.00"],
  ])("un monto %s -> validation_error, sin tocar el service", async (_caso, monto) => {
    const service = fakeService();
    const r = await aprobarIncidente(
      { incidenteId: INCIDENTE_ID, monto },
      { service, getActor: actorMaestro },
    );
    expect(r.status).toBe("validation_error");
    expect(service.aprobar).not.toHaveBeenCalled();
  });

  it("R51: el conflicto de «quien reporta no aprueba» llega al cliente con su mensaje", async () => {
    const service = fakeService({
      aprobar: vi.fn(async () => ({
        status: "conflict" as const,
        motivo: "no puedes resolver un incidente que reportaste tu",
      })),
    });
    const r = await aprobarIncidente(
      { incidenteId: INCIDENTE_ID, monto: "10.00" },
      { service, getActor: actorMaestro },
    );
    expect(r).toMatchObject({ status: "conflict" });
    expect(JSON.stringify(r)).toContain("reportaste");
  });
});

describe("R54/R59 — rechazar y retractar", () => {
  it("rechazar delega con el motivo recortado", async () => {
    const service = fakeService();
    const r = await rechazarIncidente(
      { incidenteId: INCIDENTE_ID, motivo: "  no procede  " },
      { service, getActor: actorMaestro },
    );
    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID, estado: "rechazado" });
    expect(service.rechazar).toHaveBeenCalledWith(INCIDENTE_ID, "no procede", MAESTRO);
  });

  it.each([
    ["vacio", ""],
    ["solo espacios", "   "],
  ])("rechazar con motivo %s -> validation_error, sin tocar el service", async (_c, motivo) => {
    const service = fakeService();
    const r = await rechazarIncidente(
      { incidenteId: INCIDENTE_ID, motivo },
      { service, getActor: actorMaestro },
    );
    expect(r.status).toBe("validation_error");
    expect(service.rechazar).not.toHaveBeenCalled();
  });

  it("retractar NO manda motivo (no hay aprobador que justifique nada)", async () => {
    const service = fakeService();
    const r = await retractarIncidente(
      { incidenteId: INCIDENTE_ID },
      { service, getActor: actorMaestro },
    );
    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID, estado: "rechazado" });
    expect(service.retractar).toHaveBeenCalledWith(INCIDENTE_ID, MAESTRO);
    expect((service.retractar as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);
  });

  it.each([
    ["aprobarIncidente", (s: IIncidenteAdminService) => aprobarIncidente({ incidenteId: "abc", monto: "1.00" }, { service: s, getActor: actorMaestro })],
    ["rechazarIncidente", (s: IIncidenteAdminService) => rechazarIncidente({ incidenteId: "abc", motivo: "x" }, { service: s, getActor: actorMaestro })],
    ["retractarIncidente", (s: IIncidenteAdminService) => retractarIncidente({ incidenteId: "abc" }, { service: s, getActor: actorMaestro })],
    ["verIncidente", (s: IIncidenteAdminService) => verIncidente({ incidenteId: "abc" }, { service: s, getActor: actorMaestro })],
  ])("%s con un id que no es uuid -> validation_error", async (_n, invocar) => {
    const service = fakeService();
    const r = await invocar(service);
    expect(r.status).toBe("validation_error");
  });
});

describe("R48/R49 — lecturas", () => {
  it("listarIncidentes delega con el actor y devuelve las dos colas", async () => {
    const service = fakeService({
      listarIncidentes: vi.fn(async () => ({
        status: "ok" as const,
        pendientes: [],
        historico: [],
        sinZona: true,
      })),
    });
    const r = await listarIncidentes({ service, getActor: actorMaestro });
    expect(r).toMatchObject({ status: "ok", sinZona: true });
    expect(service.listarIncidentes).toHaveBeenCalledWith(MAESTRO);
  });

  it("verIncidente propaga `no_encontrada` sin revelar nada", async () => {
    const service = fakeService();
    const r = await verIncidente(
      { incidenteId: INCIDENTE_ID },
      { service, getActor: actorMaestro },
    );
    expect(r).toEqual({ status: "no_encontrada" });
  });

  it("un rol no autorizado recibe `forbidden` del service, no una excepcion", async () => {
    const service = fakeService({
      listarIncidentes: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarIncidentes({ service, getActor: actorMaestro });
    expect(r).toEqual({ status: "forbidden" });
  });
});
