import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";
import { IncidenteAdminService } from "@/lib/services/IncidenteAdminService";
import { MSG_MONTO_REQUERIDO } from "@/lib/services/mensajes-incidente-admin";
import type {
  IncidenteAdminRow,
  ResolverIncidenteRepoInput,
} from "@/lib/interfaces/repositories/IIncidenteAdminRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";

// Fix «tope de negocio de la indemnizacion» (2026-08-04) — EMISOR 2 de 2: la aprobacion del
// INCIDENTE reportado por un admin (`lib/actions/incidentes.ts` -> `IncidenteAdminService.aprobar`).
//
// **Este es el camino que se uso en produccion** el 2026-08-04 para registrar
// ₡9.999.999.999,99. Tiene archivo PROPIO, separado del emisor del cierre, para que quitar el
// tope de uno solo de los dos ponga en rojo un archivo distinto.
//
// Lo que se afirma en todos los casos: un monto pasado de tope NO llega a `repo.resolver`, es
// decir, no se abre la transaccion que escribe la indemnizacion y emite el egreso.

const AUTOR: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };
const APROBADOR: Actor = { usuarioId: "u-admin2", rol: RolValue.admin };

const ORDEN_ID = "o-1";
const INCIDENTE_ID = "inc-1";

/** El monto que se colo en PRODUCCION: cabe en la columna, no en el negocio. */
const MONTO_DEL_INCIDENTE_REAL = INDEMNIZACION_MONTO_MAX; // "9999999999.99"

/** Un incidente `solicitado`, reportado por OTRO (R51), sobre una orden de valor `ordenMontoCobrar`. */
function fila(ordenMontoCobrar: string | null): IncidenteAdminRow {
  return {
    incidenteId: INCIDENTE_ID,
    ordenId: ORDEN_ID,
    numGuia: 42,
    numRemision: "R-42",
    destinatario: "Ana",
    zonaId: "z-1",
    zonaNombre: "Centro",
    estatusValue: "incidente",
    causa: "perdido",
    motivo: "no aparece",
    estado: "solicitado",
    indemnizacion: null,
    ordenMontoCobrar,
    reportadoPor: AUTOR.usuarioId, // != APROBADOR: R51 no interfiere
    reportadoPorNombre: "Maestro",
    resueltoPor: null,
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-08-04T11:00:00.000Z",
    evidenciaStoragePaths: ["p/0.jpg"],
  };
}

function build(ordenMontoCobrar: string | null) {
  const repo = {
    reportar: vi.fn(async () => ({ status: "ok" as const, incidenteId: INCIDENTE_ID })),
    resolver: vi.fn(async (input: ResolverIncidenteRepoInput) => {
      void input;
      return "updated" as const;
    }),
    findByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findByIdEnAlcance: vi.fn(async () => fila(ordenMontoCobrar)),
  };
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-1"),
    findEstatusIdByValue: vi.fn(async (value: string) => `os-${value}`),
  };
  const historialRepo = {
    findOrigenesReversion: vi.fn(
      async () => new Map<string, string | null>([[ORDEN_ID, "en_bodega_central"]]),
    ),
  };
  const storage = { upload: vi.fn(async () => "p"), remove: vi.fn(async () => undefined) };
  const signedUrls = {
    createSignedUrl: vi.fn(async () => "https://firmada/x"),
    createSignedUrls: vi.fn(async () => ({})),
  };
  const service = new IncidenteAdminService(repo, ordenRepo, historialRepo, storage, signedUrls);
  return { service, repo };
}

describe("EMISOR 2 (incidente) — el monto no puede superar el valor de la orden", () => {
  it("EL CASO DE PRODUCCION: 9999999999.99 sobre una orden de ₡42.000 -> RECHAZADO", async () => {
    const { service, repo } = build("42000.00");

    const r = await service.aprobar(INCIDENTE_ID, MONTO_DEL_INCIDENTE_REAL, APROBADOR);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.monto[0]).toMatch(/valor de la orden/i);
    expect(r.fieldErrors.monto[0]).toContain("42000.00");
    // El incidente sigue `solicitado` y NO se emitio ningun `egreso_indemnizacion`.
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("un centimo por encima del valor de la orden -> rechazado, sin tocar el repo", async () => {
    const { service, repo } = build("42000.00");
    const r = await service.aprobar(INCIDENTE_ID, "42000.01", APROBADOR);
    expect(r.status).toBe("validation_error");
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("EXACTAMENTE el valor de la orden -> se APRUEBA (el limite es inclusivo)", async () => {
    const { service, repo } = build("42000.00");

    const r = await service.aprobar(INCIDENTE_ID, "42000.00", APROBADOR);

    expect(r).toEqual({ status: "ok", incidenteId: INCIDENTE_ID, estado: "aprobado" });
    expect(repo.resolver).toHaveBeenCalledTimes(1);
    // El monto llega al repo TAL CUAL (STRING): el tope no lo recorta ni lo convierte.
    expect(repo.resolver.mock.calls[0][0]).toMatchObject({ monto: "42000.00" });
  });

  it("por debajo del valor de la orden -> se aprueba", async () => {
    const { service, repo } = build("42000.00");
    const r = await service.aprobar(INCIDENTE_ID, "11091.62", APROBADOR);
    expect(r.status).toBe("ok");
    expect(repo.resolver).toHaveBeenCalledTimes(1);
  });
});

describe("EMISOR 2 (incidente) — DECISION: orden sin `monto_cobrar` (NULL)", () => {
  it("NULL -> el tope de negocio NO aplica: un monto normal se aprueba", async () => {
    const { service, repo } = build(null);
    const r = await service.aprobar(INCIDENTE_ID, "42000.00", APROBADOR);
    expect(r.status).toBe("ok"); // ni bloqueado
    expect(repo.resolver).toHaveBeenCalledTimes(1);
  });

  it("NULL -> pero NO es «sin limite»: sigue cayendo el tope TECNICO", async () => {
    const { service, repo } = build(null);

    const r = await service.aprobar(INCIDENTE_ID, "10000000000.00", APROBADOR);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.monto[0]).toContain(INDEMNIZACION_MONTO_MAX);
    expect(r.fieldErrors.monto[0]).not.toMatch(/valor de la orden/i); // el TECNICO, nombrado
    expect(repo.resolver).not.toHaveBeenCalled();
  });
});

describe("EMISOR 2 (incidente) — DECISION: orden con `monto_cobrar = 0.00`", () => {
  it("cero se trata como NULL: no bloquea la indemnizacion", async () => {
    const { service, repo } = build("0.00");
    const r = await service.aprobar(INCIDENTE_ID, "5000.00", APROBADOR);
    expect(r.status).toBe("ok");
    expect(repo.resolver).toHaveBeenCalledTimes(1);
  });
});

describe("EMISOR 2 (incidente) — el tope no pisa las guardias de la 158", () => {
  it("un monto no positivo sigue diciendo «obligatorio», no «supera el tope»", async () => {
    const { service, repo } = build("42000.00");
    const r = await service.aprobar(INCIDENTE_ID, "0.00", APROBADOR);
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors.monto).toEqual([MSG_MONTO_REQUERIDO]);
    expect(repo.resolver).not.toHaveBeenCalled();
  });

  it("R51 gana al tope: el AUTOR no aprueba ni con un monto valido", async () => {
    const { service, repo } = build("42000.00");
    const r = await service.aprobar(INCIDENTE_ID, "100.00", AUTOR);
    expect(r.status).toBe("conflict");
    expect(repo.resolver).not.toHaveBeenCalled();
  });
});
