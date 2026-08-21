import { describe, it, expect, vi } from "vitest";
import {
  listarCierresAdmin,
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
  forzarSolicitudVencido,
} from "@/lib/actions/cierres-admin";
import type { ICierresAdminService } from "@/lib/interfaces/services/ICierresAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 38 — tests de integracion de las Server Actions de "Cierres del dia" del
// admin (patron cierre-dia-action.test.ts). Cubre R1 (`unauthenticated` sin sesion),
// R11 (rechazar con motivo vacio -> validation_error en el borde por zod) y la
// delegacion en el service con deps inyectadas.

const CIERRE_ID = "11111111-1111-4111-8111-111111111111"; // uuid valido para el zod del borde
const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

const noActor = async () => null;
const actorMaestro = async () => MAESTRO;

function fakeService(overrides: Partial<ICierresAdminService> = {}): ICierresAdminService {
  return {
    listarCierresAdmin: vi.fn(async () => ({ status: "ok", pendientes: [], historico: [], sinZona: false })),
    verCierreDetalle: vi.fn(async () => ({ status: "no_encontrada" })),
    aprobarCierre: vi.fn(async () => ({ status: "ok", cierreId: CIERRE_ID, estado: "aprobado" })),
    rechazarCierre: vi.fn(async () => ({ status: "ok", cierreId: CIERRE_ID, estado: "rechazado" })),
    // Feature 111/R16: válvula de escape (default = ok/solicitado).
    forzarSolicitudVencido: vi.fn(async () => ({ status: "ok", cierreId: CIERRE_ID, estado: "solicitado" })),
    ...overrides,
  } as ICierresAdminService;
}

describe("cierres-admin actions — unauthenticated en el borde (R1)", () => {
  it("listarCierresAdmin sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarCierresAdmin({ service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listarCierresAdmin).not.toHaveBeenCalled();
  });

  it("verCierreDetalle sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verCierreDetalle({ cierreId: CIERRE_ID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.verCierreDetalle).not.toHaveBeenCalled();
  });

  it("aprobarCierre sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await aprobarCierre({ cierreId: CIERRE_ID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.aprobarCierre).not.toHaveBeenCalled();
  });

  it("rechazarCierre sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await rechazarCierre(
      { cierreId: CIERRE_ID, motivo: "cuadre" },
      { service, getActor: noActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.rechazarCierre).not.toHaveBeenCalled();
  });

  it("feature 111/R16: forzarSolicitudVencido sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await forzarSolicitudVencido({ cierreId: CIERRE_ID }, { service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.forzarSolicitudVencido).not.toHaveBeenCalled();
  });
});

describe("feature 111 · forzarSolicitudVencido action (R16)", () => {
  it("R16: cierreId no-uuid -> validation_error en el borde, sin tocar el service", async () => {
    const service = fakeService();
    const r = await forzarSolicitudVencido({ cierreId: "no-es-uuid" }, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.forzarSolicitudVencido).not.toHaveBeenCalled();
  });

  it("R16: con actor -> delega con el cierreId parseado + actor", async () => {
    const service = fakeService();
    const r = await forzarSolicitudVencido({ cierreId: CIERRE_ID }, { service, getActor: actorMaestro });
    expect(r).toMatchObject({ status: "ok", estado: "solicitado" });
    expect(service.forzarSolicitudVencido).toHaveBeenCalledWith(CIERRE_ID, MAESTRO);
  });
});

describe("cierres-admin actions — validacion de borde con zod (R11)", () => {
  it("R11: rechazarCierre con motivo vacio -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await rechazarCierre(
      { cierreId: CIERRE_ID, motivo: "   " },
      { service, getActor: actorMaestro },
    );
    expect(r.status).toBe("validation_error");
    expect(service.rechazarCierre).not.toHaveBeenCalled();
  });

  it("verCierreDetalle con cierreId no-uuid -> validation_error, sin tocar el service", async () => {
    const service = fakeService();
    const r = await verCierreDetalle({ cierreId: "no-es-uuid" }, { service, getActor: actorMaestro });
    expect(r.status).toBe("validation_error");
    expect(service.verCierreDetalle).not.toHaveBeenCalled();
  });
});

describe("cierres-admin actions — delegacion en el service", () => {
  it("listarCierresAdmin con actor -> delega y devuelve el resultado del service", async () => {
    const service = fakeService({
      listarCierresAdmin: vi.fn(async () => ({
        status: "ok" as const,
        pendientes: [],
        historico: [],
        sinZona: false,
      })),
    });
    const r = await listarCierresAdmin({ service, getActor: actorMaestro });
    expect(r.status).toBe("ok");
    expect(service.listarCierresAdmin).toHaveBeenCalledWith(MAESTRO);
  });

  it("aprobarCierre con actor -> delega con el cierreId parseado", async () => {
    const service = fakeService();
    const r = await aprobarCierre({ cierreId: CIERRE_ID }, { service, getActor: actorMaestro });
    expect(r).toMatchObject({ status: "ok", estado: "aprobado" });
    // Feature 158/R36: sin `indemnizaciones` en el request, el `.default([])` del schema hace
    // que llegue la lista VACIA — el contrato de la 38 sigue siendo valido tal cual.
    //
    // Feature 238/R15/R16 (2026-08-19): el literal GANA un cuarto argumento, y se AMPLIA en vez
    // de aflojarse a proposito. Este literal ES el contrato del borde: dice que la Server Action
    // pasa exactamente lo que el schema produjo, sin coercion y sin campos inventados. Un
    // `expect.anything()` en el cuarto hueco dejaria de vigilar justo lo que R15 fija: que «sin
    // el campo» llega como lista VACIA al servicio, y no como `undefined`.
    expect(service.aprobarCierre).toHaveBeenCalledWith(CIERRE_ID, MAESTRO, [], []);
  });

  it("238/R14/R15: la confirmacion fisica llega al servicio SIN transformar", async () => {
    const service = fakeService();
    const confirmacionFisica = [
      { gestionId: "22222222-2222-4222-8222-222222222222", numGuia: 9001 },
      { gestionId: "33333333-3333-4333-8333-333333333333", numGuia: 9002 },
    ];

    await aprobarCierre(
      { cierreId: CIERRE_ID, confirmacionFisica },
      { service, getActor: actorMaestro },
    );

    // Tal cual: mismos ids, mismos numeros, mismo orden. El borde valida la FORMA y nada mas;
    // quien decide si eso CUBRE el conjunto que vuelve es el servicio, contra las gestiones
    // reales del cierre (R14). Una coercion aqui seria una segunda regla que puede divergir.
    expect(service.aprobarCierre).toHaveBeenCalledWith(CIERRE_ID, MAESTRO, [], confirmacionFisica);
  });

  it("238/R12: una guia no entera o <= 0 muere en el BORDE, sin tocar el service", async () => {
    for (const numGuia of [0, -1, 12.5]) {
      const service = fakeService();
      const r = await aprobarCierre(
        {
          cierreId: CIERRE_ID,
          confirmacionFisica: [{ gestionId: "22222222-2222-4222-8222-222222222222", numGuia }],
        },
        { service, getActor: actorMaestro },
      );
      expect(r.status, `numGuia = ${numGuia}`).toBe("validation_error");
      expect(service.aprobarCierre).not.toHaveBeenCalled();
    }
  });

  it("rechazarCierre con motivo -> delega con cierreId + motivo (trim del zod) + actor", async () => {
    const service = fakeService();
    const r = await rechazarCierre(
      { cierreId: CIERRE_ID, motivo: "  cuadre no coincide  " },
      { service, getActor: actorMaestro },
    );
    expect(r).toMatchObject({ status: "ok", estado: "rechazado" });
    expect(service.rechazarCierre).toHaveBeenCalledWith(CIERRE_ID, "cuadre no coincide", MAESTRO);
  });
});
