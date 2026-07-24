import { describe, it, expect, vi } from "vitest";
import { listarLiberadasHoy } from "@/lib/actions/liberacion-reprogramada";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ILiberacionReprogramadaRepository,
  LiberadaHoyRow,
} from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

// Feature 46 (T15, R15/R16) — loader del aviso derivado "Liberadas hoy". Verifica el
// filtro por rol (destinatario de la bodega responsable) con inyección de deps, patrón
// `recepcion-satelite-action.test.ts` (sin DB ni HTTP).

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

describe("listarLiberadasHoy — filtro por rol (R16)", () => {
  it("maestro => filtro {zona: central, estatus: en_bodega_central}", async () => {
    const repo = buildRepo([makeRow("a")]);
    const zonaRepo = { findCentralZonaId: vi.fn(async () => "zona-central") };
    const r = await listarLiberadasHoy({
      repo,
      zonaRepo,
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
