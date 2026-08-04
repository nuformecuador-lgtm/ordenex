// Feature 177 (R16/R17) — `ApiOrdenLecturaService.detallePorOrdenId(actor, ordenId)`: MISMO DTO
// y MISMO firmado de evidencias que `detalle`, pero leyendo por `orden.id`. Es una ADICION: los
// tests de la 106 (`api-orden-lectura-service.test.ts`) siguen intactos y verdes.
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
const ORDEN_ID = "3f6a1c2e-0000-4000-8000-000000000001";

function row(overrides: Partial<ApiOrdenRow> = {}): ApiOrdenRow {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    estatusValue: "entregada",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    ...overrides,
  };
}

function fakeRepo(detalle: ApiOrdenDetalleRow | null) {
  return {
    listByOwner: vi.fn(),
    findDetalleByNumGuiaForOwner: vi.fn().mockResolvedValue(null),
    findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue(detalle),
    findEstatusIdByValue: vi.fn(),
  };
}

function fakeSignedUrls(map: Record<string, string> = {}): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async () => "https://signed/one"),
    createSignedUrls: vi.fn(async () => map),
  };
}

describe("ApiOrdenLecturaService.detallePorOrdenId (feature 177)", () => {
  it("R16: orden propia con evidencias -> DTO con URLs firmadas al TTL de la 106, sin storagePath", async () => {
    const detalleRow: ApiOrdenDetalleRow = {
      ...row(),
      evidencias: [
        { resultado: "entregada", storagePath: "ordenes/o1/e.jpg", contentType: "image/jpeg" },
      ],
    };
    const repo = fakeRepo(detalleRow);
    const provider = fakeSignedUrls({ "ordenes/o1/e.jpg": "https://signed/e.jpg" });
    const svc = new ApiOrdenLecturaService(repo as never, provider);

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(provider.createSignedUrls).toHaveBeenCalledWith(
      ["ordenes/o1/e.jpg"],
      gestionConfig.SIGNED_URL_TTL_SECONDS,
    );
    expect(res).toMatchObject({ numGuia: 10234, estado: "entregada" });
    expect(res!.evidencias).toEqual([
      {
        resultado: "entregada",
        contentType: "image/jpeg",
        url: "https://signed/e.jpg",
        expiraEnSegundos: gestionConfig.SIGNED_URL_TTL_SECONDS,
      },
    ]);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("ordenes/o1/e.jpg");
    expect(serialized).not.toMatch(/storagePath|mensajero|bucket/i);
  });

  it("R16: orden propia sin evidencias -> [] y NO se invoca el provider", async () => {
    const repo = fakeRepo({ ...row(), evidencias: [] });
    const provider = fakeSignedUrls();
    const svc = new ApiOrdenLecturaService(repo as never, provider);

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res!.evidencias).toEqual([]);
    expect(provider.createSignedUrls).not.toHaveBeenCalled();
  });

  it("R11/R12: orden ajena o borrada (repo null) -> null y no se firma nada", async () => {
    const repo = fakeRepo(null);
    const provider = fakeSignedUrls();
    const svc = new ApiOrdenLecturaService(repo as never, provider);

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(res).toBeNull();
    expect(provider.createSignedUrls).not.toHaveBeenCalled();
  });

  it("R4/R7: el ownerId que llega al repo es actor.usuarioId (y el ordenId va como ordenId)", async () => {
    const repo = fakeRepo({ ...row(), evidencias: [] });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    expect(repo.findDetalleByOrdenIdForOwner).toHaveBeenCalledWith(ORDEN_ID, "store-1");
    // R17: el metodo de la 106 no se usa en este camino.
    expect(repo.findDetalleByNumGuiaForOwner).not.toHaveBeenCalled();
  });
});
