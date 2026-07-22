import { describe, it, expect, vi } from "vitest";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ApiOrdenRow,
  ApiOrdenDetalleRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import { gestionConfig } from "@/lib/config/gestion";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

function row(overrides: Partial<ApiOrdenRow> = {}): ApiOrdenRow {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    estatusValue: "en_bodega",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    ...overrides,
  };
}

function fakeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listByOwner: vi.fn().mockResolvedValue({ items: [row()], total: 1 }),
    findDetalleByNumGuiaForOwner: vi.fn().mockResolvedValue(null),
    findEstatusIdByValue: vi.fn().mockResolvedValue("os-bodega"),
    ...overrides,
  };
}

function fakeSignedUrls(map: Record<string, string> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async () => "https://signed/one"),
    createSignedUrls: vi.fn(async () => map),
  };
}

describe("ApiOrdenLecturaService.listar (feature 106, T8)", () => {
  it("R4/R6: usa actor.usuarioId como owner (no un input) al llamar al repo", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());
    await svc.listar(ACTOR, { limit: 50, offset: 0 });
    expect(repo.listByOwner).toHaveBeenCalledWith({
      ownerId: "store-1",
      estatusId: undefined,
      skip: 0,
      take: 50,
    });
  });

  it("R8: el filtro estado se resuelve a estatusId; no amplia scope", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());
    await svc.listar(ACTOR, { limit: 20, offset: 40, estado: "en_bodega" });
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_bodega");
    expect(repo.listByOwner).toHaveBeenCalledWith({
      ownerId: "store-1",
      estatusId: "os-bodega",
      skip: 40,
      take: 20,
    });
  });

  it("estado valido sin id en el catalogo -> pagina vacia con total 0 (no consulta el listado)", async () => {
    const repo = fakeRepo({ findEstatusIdByValue: vi.fn().mockResolvedValue(null) });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());
    const res = await svc.listar(ACTOR, { limit: 50, offset: 0, estado: "recibido_origen" });
    expect(res).toEqual({ items: [], pagination: { limit: 50, offset: 0, total: 0 } });
    expect(repo.listByOwner).not.toHaveBeenCalled();
  });

  it("R10: devuelve items publicos (estado plano) + pagination con total", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());
    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });
    expect(res.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
    expect(res.items[0]).toMatchObject({ numGuia: 10234, estado: "en_bodega" });
    expect(res.items[0]).not.toHaveProperty("estatusValue");
  });
});

describe("ApiOrdenLecturaService.detalle (feature 106, T8)", () => {
  it("R13/R14: repo null (ajena/inexistente) -> null", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());
    const res = await svc.detalle(ACTOR, 999);
    expect(res).toBeNull();
    expect(repo.findDetalleByNumGuiaForOwner).toHaveBeenCalledWith(999, "store-1");
  });

  it("R15/R16/R17: firma evidencias con gestionConfig.SIGNED_URL_TTL_SECONDS; DTO sin storagePath ni PII", async () => {
    const detalleRow: ApiOrdenDetalleRow = {
      ...row({ estatusValue: "entregada" }),
      evidencias: [
        { resultado: "entregada", storagePath: "ordenes/o1/e.jpg", contentType: "image/jpeg" },
      ],
    };
    const repo = fakeRepo({
      findDetalleByNumGuiaForOwner: vi.fn().mockResolvedValue(detalleRow),
    });
    const provider = fakeSignedUrls({ "ordenes/o1/e.jpg": "https://signed/e.jpg" });
    const svc = new ApiOrdenLecturaService(repo as never, provider);

    const res = await svc.detalle(ACTOR, 10234);

    expect(provider.createSignedUrls).toHaveBeenCalledWith(
      ["ordenes/o1/e.jpg"],
      gestionConfig.SIGNED_URL_TTL_SECONDS,
    );
    expect(res!.evidencias).toEqual([
      {
        resultado: "entregada",
        contentType: "image/jpeg",
        url: "https://signed/e.jpg",
        expiraEnSegundos: gestionConfig.SIGNED_URL_TTL_SECONDS,
      },
    ]);
    // R16: ni el path crudo ni el bucket viajan en la respuesta.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("ordenes/o1/e.jpg");
    expect(serialized).not.toMatch(/storagePath|mensajero|bucket/i);
  });

  it("R18: sin evidencias -> evidencias [] y NO se invoca el provider", async () => {
    const detalleRow: ApiOrdenDetalleRow = { ...row(), evidencias: [] };
    const repo = fakeRepo({
      findDetalleByNumGuiaForOwner: vi.fn().mockResolvedValue(detalleRow),
    });
    const provider = fakeSignedUrls();
    const svc = new ApiOrdenLecturaService(repo as never, provider);

    const res = await svc.detalle(ACTOR, 10234);

    expect(res!.evidencias).toEqual([]);
    expect(provider.createSignedUrls).not.toHaveBeenCalled();
  });
});
