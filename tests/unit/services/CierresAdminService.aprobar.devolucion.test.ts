import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 139 (T1.4) — el service resuelve la config del DISPARO de la devolucion de `rechazada`
// (origen `rechazada` + destinos `por_devolver`/`por_devolver_a_tienda` + zona central) y la pasa
// SOLO al aprobar (R5). El rechazo NO la pasa (R10). Catalogo incompleto -> undefined (defensivo).

const MAESTRO: Actor = { usuarioId: "adm-maestro", rol: "maestro" };

// Ids del catalogo que `aprobarCierre` resuelve (109 + 139). El default trae todos -> la config
// de devolucion se puede construir.
const ESTATUS_IDS: Record<string, string | null> = {
  sin_gestionar: "s-sin-gestionar",
  en_bodega_central: "s-en-bodega",
  en_bodega_satelite: "s-en-bodega-sat",
  rechazada: "s-rechazada",
  por_devolver: "s-por-devolver",
  por_devolver_a_tienda: "s-por-devolver-a-tienda",
};

function fakeRepo(): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
  // Feature 158/R19: sin incidentes -> cobertura vacia (camino de la 38 intacto).
  findGestionesIncidenteDelCierre: vi.fn(async () => [] as string[]),
  };
}

function newService(estatusIds: Record<string, string | null> = ESTATUS_IDS) {
  const repo = fakeRepo();
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-cartago"),
    findEstatusIdByValue: vi.fn(async (v: string) => estatusIds[v] ?? null),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  const service = new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls);
  return { service, repo, ordenRepo };
}

describe("CierresAdminService.aprobarCierre — config de devolucion de `rechazada` (feature 139/R5/R10)", () => {
  it("R5: resuelve rechazada/por_devolver/por_devolver_a_tienda + zona central y los pasa al aprobar", async () => {
    const { service, repo, ordenRepo } = newService();

    await service.aprobarCierre("c1", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.devolucionRechazadas).toEqual({
      rechazadaId: "s-rechazada",
      porDevolverId: "s-por-devolver",
      porDevolverATiendaId: "s-por-devolver-a-tienda",
      centralZonaId: "z-central",
    });
    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("rechazada");
    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("por_devolver");
    expect(ordenRepo.findEstatusIdByValue).toHaveBeenCalledWith("por_devolver_a_tienda");
  });

  it("R5 defensivo: catalogo sin `por_devolver` (seed pendiente) -> devolucionRechazadas undefined", async () => {
    const { service, repo } = newService({ ...ESTATUS_IDS, por_devolver: null });

    await service.aprobarCierre("c1", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.devolucionRechazadas).toBeUndefined();
  });

  it("R10: rechazar NO pasa la config de devolucion (solo la aprobacion dispara)", async () => {
    const { service, repo } = newService();

    await service.rechazarCierre("c1", "cuadre no coincide", MAESTRO);

    const arg = (repo.resolverCierre as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.nuevoEstado).toBe("rechazado");
    expect(arg.devolucionRechazadas).toBeUndefined();
  });

  it("la aprobacion sigue devolviendo ok/aprobado (la config no altera el resultado)", async () => {
    const { service } = newService();
    const r = await service.aprobarCierre("c1", MAESTRO);
    expect(r).toEqual({ status: "ok", cierreId: "c1", estado: "aprobado" });
  });
});
