import { describe, it, expect, vi } from "vitest";
import { listarLiberadasHoy } from "@/lib/actions/liberacion-reprogramada";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ILiberacionReprogramadaRepository,
  LiberadaHoyRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import {
  fakeIntentosEnLote,
  llamadasIntentos,
  type IntentosSvcDoble,
} from "@/tests/fixtures/intentos-entrega";

// Feature 46 (T15, R15/R16) — loader del aviso derivado "Liberadas hoy". Verifica el
// filtro por rol (destinatario de la bodega responsable) con inyección de deps, patrón
// `recepcion-satelite-action.test.ts` (sin DB ni HTTP).
//
// Feature 160 (T13): este borde gana el merge del conteo de intentos EN LOTE. La dep
// `historial` SE INYECTA SIEMPRE en los tests: sin ella el loader construye el servicio real
// (que abre Prisma) y el test dejaría de ser unitario.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_SAT: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };

const HOY = new Date("2026-07-13T00:00:00.000Z");

function makeRow(id: string): LiberadaHoyRow {
  return {
    id,
    numGuia: 1,
    numRemision: `REM-${id}`,
    destinatario: "X",
    liberadaReprogramadaAt: new Date(),
  };
}

function buildRepo(
  rows: LiberadaHoyRow[] = [],
): Pick<ILiberacionReprogramadaRepository, "findLiberadasHoy"> {
  return { findLiberadasHoy: vi.fn(async () => rows) };
}

// Feature 160: doble del derivador de intentos EN LOTE (Map vacio -> ejerce el `?? 0`, R14).
const intentos: IntentosSvcDoble = fakeIntentosEnLote();

describe("listarLiberadasHoy — filtro por rol (R16)", () => {
  it("maestro => filtro {zona: central, estatus: en_bodega_central}", async () => {
    const repo = buildRepo([makeRow("a")]);
    const zonaRepo = { findCentralZonaId: vi.fn(async () => "zona-central") };
    const r = await listarLiberadasHoy({
      repo,
      zonaRepo,
      historial: intentos,
      getActor: async () => MAESTRO,
      hoyCR: HOY,
    });

    expect(r.status).toBe("ok");
    expect(zonaRepo.findCentralZonaId).toHaveBeenCalled();
    expect(repo.findLiberadasHoy).toHaveBeenCalledWith(
      { zonaId: "zona-central", estatusValue: "en_bodega_central" },
      HOY,
    );
    if (r.status === "ok") expect(r.liberadas).toHaveLength(1);
  });

  it("adminSatelite => filtro {zona: su zona, estatus: en_bodega_satelite}", async () => {
    const repo = buildRepo([makeRow("b"), makeRow("c")]);
    const ordenRepo = { findUsuarioZonaId: vi.fn(async () => "zona-sat") };
    const r = await listarLiberadasHoy({
      repo,
      ordenRepo,
      historial: intentos,
      getActor: async () => ADMIN_SAT,
      hoyCR: HOY,
    });

    expect(r.status).toBe("ok");
    expect(ordenRepo.findUsuarioZonaId).toHaveBeenCalledWith("u-sat");
    expect(repo.findLiberadasHoy).toHaveBeenCalledWith(
      { zonaId: "zona-sat", estatusValue: "en_bodega_satelite" },
      HOY,
    );
    if (r.status === "ok") expect(r.liberadas).toHaveLength(2);
  });

  it("otro rol => forbidden, sin tocar el repo", async () => {
    const repo = buildRepo();
    const r = await listarLiberadasHoy({
      repo,
      getActor: async () => ADMIN_TIENDA,
      hoyCR: HOY,
    });

    expect(r.status).toBe("forbidden");
    expect(repo.findLiberadasHoy).not.toHaveBeenCalled();
  });

  it("sin actor => unauthenticated, sin tocar el repo", async () => {
    const repo = buildRepo();
    const r = await listarLiberadasHoy({ repo, getActor: async () => null, hoyCR: HOY });

    expect(r.status).toBe("unauthenticated");
    expect(repo.findLiberadasHoy).not.toHaveBeenCalled();
  });

  it("maestro sin zona central => lista vacía sin consultar liberadas", async () => {
    const repo = buildRepo();
    const zonaRepo = { findCentralZonaId: vi.fn(async () => null) };
    const r = await listarLiberadasHoy({
      repo,
      zonaRepo,
      getActor: async () => MAESTRO,
      hoyCR: HOY,
    });

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.liberadas).toEqual([]);
    expect(repo.findLiberadasHoy).not.toHaveBeenCalled();
  });

  it("adminSatelite sin zona => lista vacía sin consultar liberadas", async () => {
    const repo = buildRepo();
    const ordenRepo = { findUsuarioZonaId: vi.fn(async () => null) };
    const r = await listarLiberadasHoy({
      repo,
      ordenRepo,
      getActor: async () => ADMIN_SAT,
      hoyCR: HOY,
    });

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.liberadas).toEqual([]);
    expect(repo.findLiberadasHoy).not.toHaveBeenCalled();
  });
});

// --- Feature 160 (T13): el conteo de intentos en el aviso "Liberadas hoy" ---

describe("listarLiberadasHoy — intentos de entrega en lote (160/R11-R15/R27)", () => {
  it("R11/R14: cada fila sale con `intentosEntrega` numerico, el `0` INCLUIDO", async () => {
    const repo = buildRepo([makeRow("l1"), makeRow("l2")]);
    const doble = fakeIntentosEnLote({ l1: 2 }); // `l2` sin intentos -> 0
    const r = await listarLiberadasHoy({
      repo,
      zonaRepo: { findCentralZonaId: vi.fn(async () => "zona-central") },
      historial: doble,
      getActor: async () => MAESTRO,
      hoyCR: HOY,
    });

    if (r.status !== "ok") throw new Error("esperaba ok");
    const porId = new Map(r.liberadas.map((l) => [l.id, l.intentosEntrega]));
    expect(porId.get("l1")).toBe(2);
    expect(porId.get("l2")).toBe(0);
  });

  it("R12/R15: UNA sola llamada, con los ids del aviso YA acotado por rol/zona", async () => {
    const repo = buildRepo([makeRow("b"), makeRow("c")]);
    const doble = fakeIntentosEnLote();
    await listarLiberadasHoy({
      repo,
      ordenRepo: { findUsuarioZonaId: vi.fn(async () => "zona-sat") },
      historial: doble,
      getActor: async () => ADMIN_SAT,
      hoyCR: HOY,
    });

    expect(doble.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(llamadasIntentos(doble)).toEqual([["b", "c"]]);
    // El filtro (zona + estatus) lo impuso el borde con el rol del actor, no el cliente.
    expect(repo.findLiberadasHoy).toHaveBeenCalledWith(
      { zonaId: "zona-sat", estatusValue: "en_bodega_satelite" },
      HOY,
    );
  });

  it("R13/R15: sin bodega que consultar (rol ajeno o sin zona) el derivador ni se toca", async () => {
    const sinZona = fakeIntentosEnLote();
    await listarLiberadasHoy({
      repo: buildRepo(),
      zonaRepo: { findCentralZonaId: vi.fn(async () => null) },
      historial: sinZona,
      getActor: async () => MAESTRO,
      hoyCR: HOY,
    });
    expect(sinZona.contarIntentosEnLote).not.toHaveBeenCalled();

    const rolAjeno = fakeIntentosEnLote();
    const r = await listarLiberadasHoy({
      repo: buildRepo(),
      historial: rolAjeno,
      getActor: async () => ADMIN_TIENDA,
      hoyCR: HOY,
    });
    expect(r.status).toBe("forbidden");
    expect(rolAjeno.contarIntentosEnLote).not.toHaveBeenCalled();
  });
});
