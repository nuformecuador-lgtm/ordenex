// BAJA (2026-08-31) — este archivo cubria tambien `ApiOrdenLecturaService.detalle(actor, numGuia)`
// y sus evidencias de incidente (268/R27). El metodo se retiro con su endpoint
// (`GET /api/ordenes/api-key/{numGuia}`) y esa cobertura NO se pierde: vive intacta, caso por
// caso, en `api-orden-lectura-service.por-orden-id.test.ts`, que afirma lo mismo sobre
// `detallePorOrdenId` —el mismo mapeo, el mismo firmado y el mismo `OrdenRepository` real sobre
// Prisma mockeado—. Aqui queda `listar`.
import { describe, it, expect, vi } from "vitest";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

function row(overrides: Partial<ApiOrdenRow> = {}): ApiOrdenRow {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    estatusValue: "en_bodega_central",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    // ⏳ 2026-09-09 (feature 404): campo REQUERIDO de `ApiOrdenRow`. Por defecto, sin asignado.
    mensajero: null,
    ...overrides,
  };
}

/** ⏳ 2026-09-09 (404) — el mensajero que devolveria el repo, ya compuesto por el repositorio. */
const MENSAJERO = { id: "018f2c31-0000-4000-8000-0000000000aa", nombre: "Carlos Jimenez Mora" };

function fakeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listByOwner: vi.fn().mockResolvedValue({ items: [row()], total: 1 }),
    findDetalleByOrdenIdForOwner: vi.fn().mockResolvedValue(null),
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
    await svc.listar(ACTOR, { limit: 20, offset: 40, estado: "en_bodega_central" });
    expect(repo.findEstatusIdByValue).toHaveBeenCalledWith("en_bodega_central");
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
    const res = await svc.listar(ACTOR, { limit: 50, offset: 0, estado: "devuelta_a_tienda" });
    expect(res).toEqual({ items: [], pagination: { limit: 50, offset: 0, total: 0 } });
    expect(repo.listByOwner).not.toHaveBeenCalled();
  });

  it("R10: devuelve items publicos (estado plano) + pagination con total", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());
    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });
    expect(res.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
    expect(res.items[0]).toMatchObject({ numGuia: 10234, estado: "en_bodega_central" });
    expect(res.items[0]).not.toHaveProperty("estatusValue");
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-09-09 — Feature 404 (T5): el DTO del item lleva `mensajero`, tal cual lo dio el repo.
// -----------------------------------------------------------------------------------------------

describe("ApiOrdenLecturaService.listar — `mensajero` en el DTO (feature 404)", () => {
  it("404/R14: el DTO del item lleva `mensajero` TAL CUAL lo dio el repo (no lo recompone)", async () => {
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({ items: [row({ mensajero: MENSAJERO })], total: 1 }),
    });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(res.items[0].mensajero).toEqual({
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos Jimenez Mora",
    });
  });

  it("404/R1+R6: el objeto `mensajero` del DTO tiene EXACTAMENTE dos claves", async () => {
    // El repo devuelve una fila con un campo de mas (lo que pasaria si alguien ampliara la
    // proyeccion sin actualizar el tipo): el DTO no debe dejarlo pasar por copia ciega.
    const repo = fakeRepo({
      listByOwner: vi.fn().mockResolvedValue({
        items: [row({ mensajero: MENSAJERO })],
        total: 1,
      }),
    });
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(Object.keys(res.items[0].mensajero!).sort()).toEqual(["id", "nombre"]);
    // Y el item entero sigue teniendo los nueve publicados + `mensajero`, ni uno mas (R16).
    expect(Object.keys(res.items[0]).sort()).toEqual([
      "createdAt",
      "destinatario",
      "direccion",
      "estado",
      "mensajero",
      "montoCobrar",
      "numGuia",
      "numRemision",
      "producto",
      "telefonoDest",
    ]);
  });

  it("404/R2+R23: sin asignado el DTO lleva la clave con `null`, no la omite", async () => {
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    const res = await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect("mensajero" in res.items[0]).toBe(true);
    expect(res.items[0].mensajero).toBeNull();
    expect(JSON.stringify(res.items[0])).toContain('"mensajero":null');
  });

  it("404/R17: `mensajero` no llega al repo como criterio: los params del listado no cambian", async () => {
    // El service traduce `estado`/`desde`/`hasta`/`numGuia`/`numRemision` y NADA MAS. Si alguien
    // anadiera un filtro por mensajero, esta igualdad exacta de argumentos se pondria roja.
    const repo = fakeRepo();
    const svc = new ApiOrdenLecturaService(repo as never, fakeSignedUrls());

    await svc.listar(ACTOR, { limit: 50, offset: 0 });

    expect(repo.listByOwner).toHaveBeenCalledWith({
      ownerId: "store-1",
      estatusId: undefined,
      skip: 0,
      take: 50,
    });
    const args = repo.listByOwner.mock.calls[0][0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("mensajero");
    expect(args).not.toHaveProperty("mensajeroAsignadoId");
    expect(args).not.toHaveProperty("orderBy");
  });
});

