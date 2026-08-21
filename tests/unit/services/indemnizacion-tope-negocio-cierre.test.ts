import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  GestionIncidenteDelCierre,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";

// Fix «tope de negocio de la indemnizacion» (2026-08-04) — EMISOR 1 de 2: la aprobacion del
// CIERRE (`lib/actions/cierres-admin.ts` -> `CierresAdminService.aprobarCierre`).
//
// Este archivo mide UN camino. El otro emisor —la aprobacion del INCIDENTE del admin— tiene el
// suyo (`indemnizacion-tope-negocio-incidente.test.ts`) A PROPOSITO: quitar el tope de UNO SOLO
// de los dos tiene que poner en rojo un archivo distinto, o «los dos emisores estan cubiertos»
// no seria una afirmacion comprobable.
//
// Lo que se afirma en todos los casos: un monto que supera el tope NO llega al repo, es decir,
// no se abre la transaccion que escribe el monto y emite el `egreso_indemnizacion`.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };
const G1 = "g-incidente-1";
const G2 = "g-incidente-2";

/** El monto que se colo en PRODUCCION el 2026-08-04: cabe en la columna, no en el negocio. */
const MONTO_DEL_INCIDENTE_REAL = INDEMNIZACION_MONTO_MAX; // "9999999999.99"

function gestion(
  gestionId: string,
  ordenMontoCobrar: string | null,
): GestionIncidenteDelCierre {
  return { gestionId, ordenMontoCobrar };
}

function fakeRepo(delCierre: GestionIncidenteDelCierre[]): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    // Feature 184 (T D.1): los dos CONJUNTOS de la descarga; no-op en esta suite.
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => delCierre),
    // Feature 238 (T1.3): el conjunto esperado de la confirmacion fisica. Doble VACIO por
    // defecto: sin nada que devolver, la guardia de la 238 deja el camino de esta suite intacto.
    findGestionesRetornablesDelCierre: vi.fn(async () => []),
    // Feature 230 (T2.1): el doble implementa la interfaz ENTERA. Estos casos no ejercitan la
    // descarga detallada; devolver el conjunto vacio deja el camino de la 38 intacto.
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
    // Pedido humano (2026-08-19): la correccion del desglose. Dobles no-op: esta suite no la
    // ejercita (vive en `cierres-admin-corregir-pagos.test.ts`).
    findGestionEditableEnCierre: vi.fn(async () => null),
    actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
  };
}

function newService(repo: ICierresAdminRepository) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  return new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  });
}

describe("EMISOR 1 (cierre) — el monto no puede superar el valor de la orden", () => {
  it("EL CASO DE PRODUCCION: 9999999999.99 sobre una orden de ₡42.000 -> RECHAZADO", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00")]);

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: MONTO_DEL_INCIDENTE_REAL },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors[G1][0]).toMatch(/valor de la orden/i);
    expect(r.fieldErrors[G1][0]).toContain("42000.00");
    // Lo que de verdad importa: el cierre sigue `solicitado` y NO se emitio ningun movimiento.
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("un centimo por encima del valor de la orden -> rechazado, sin tocar el repo", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00")]);
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "42000.01" },
    ]);
    expect(r.status).toBe("validation_error");
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("EXACTAMENTE el valor de la orden -> se APRUEBA (el limite es inclusivo)", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00")]);

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "42000.00" },
    ]);

    expect(r.status).toBe("ok");
    expect(repo.resolverCierre).toHaveBeenCalledTimes(1);
    // Y el monto viaja TAL CUAL (STRING) al repo: el tope no lo recorta ni lo transforma.
    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.indemnizaciones).toEqual([{ gestionId: G1, monto: "42000.00" }]);
  });

  it("por debajo del valor de la orden -> se aprueba", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00")]);
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "11091.62" },
    ]);
    expect(r.status).toBe("ok");
  });
});

describe("EMISOR 1 (cierre) — DECISION: orden sin `monto_cobrar` (NULL)", () => {
  it("NULL -> el tope de negocio NO aplica: un monto normal se aprueba", async () => {
    const repo = fakeRepo([gestion(G1, null)]);
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "42000.00" },
    ]);
    expect(r.status).toBe("ok"); // ni bloqueado
  });

  it("NULL -> pero NO es «sin limite»: sigue cayendo el tope TECNICO", async () => {
    const repo = fakeRepo([gestion(G1, null)]);

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "10000000000.00" }, // un centimo sobre el maximo de la columna
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors[G1][0]).toContain(INDEMNIZACION_MONTO_MAX);
    expect(r.fieldErrors[G1][0]).not.toMatch(/valor de la orden/i); // el TECNICO, nombrado
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });
});

describe("EMISOR 1 (cierre) — DECISION: orden con `monto_cobrar = 0.00`", () => {
  it("cero se trata como NULL: no bloquea la indemnizacion", async () => {
    const repo = fakeRepo([gestion(G1, "0.00")]);
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "5000.00" },
    ]);
    expect(r.status).toBe("ok");
    expect(repo.resolverCierre).toHaveBeenCalledTimes(1);
  });
});

describe("EMISOR 1 (cierre) — el tope se aplica POR GESTION, no al lote", () => {
  it("dos incidentes, uno pasado de tope: solo ese se marca y NADA se aprueba", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00"), gestion(G2, "1000.00")]);

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "40000.00" }, // dentro
      { gestionId: G2, monto: "1000.01" }, // fuera por un centimo
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(Object.keys(r.fieldErrors)).toEqual([G2]);
    expect(r.fieldErrors[G2][0]).toContain("1000.00");
    // Un solo monto invalido deja TODO el cierre sin aprobar: la aprobacion es atomica.
    expect(repo.resolverCierre).not.toHaveBeenCalled();
  });

  it("cada gestion se acota contra SU orden, no contra la de otra fila", async () => {
    const repo = fakeRepo([gestion(G1, "100.00"), gestion(G2, "90000.00")]);

    // Si el tope se cruzara de fila, `G1: 50000` pasaria (cabe en la orden de G2).
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "50000.00" },
      { gestionId: G2, monto: "50000.00" },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(Object.keys(r.fieldErrors)).toEqual([G1]);
    expect(r.fieldErrors[G1][0]).toContain("100.00");
  });
});

describe("EMISOR 1 (cierre) — el tope no pisa las guardias de cobertura de la 158", () => {
  it("una gestion AJENA sigue diciendo «no corresponde», no «supera el tope»", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00")]);

    const r = await newService(repo).aprobarCierre("c1", MAESTRO, [
      { gestionId: G1, monto: "100.00" },
      { gestionId: "g-de-otro-cierre", monto: "999999999.00" },
    ]);

    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    // Sin valor de orden con el que comparar, el error correcto es el de pertenencia (R21).
    expect(r.fieldErrors["g-de-otro-cierre"][0]).toMatch(/no corresponde/i);
    expect(r.fieldErrors["g-de-otro-cierre"][0]).not.toMatch(/tope|valor de la orden/i);
  });

  it("un monto que FALTA sigue diciendo «falta el monto» (R19/R20 intacto)", async () => {
    const repo = fakeRepo([gestion(G1, "42000.00")]);
    const r = await newService(repo).aprobarCierre("c1", MAESTRO, []);
    if (r.status !== "validation_error") throw new Error("esperaba validation_error");
    expect(r.fieldErrors[G1][0]).toMatch(/falta el monto/i);
  });

  it("un cierre SIN incidentes se aprueba como siempre (R36 intacto)", async () => {
    const repo = fakeRepo([]);
    const r = await newService(repo).aprobarCierre("c1", MAESTRO);
    expect(r.status).toBe("ok");
  });
});
