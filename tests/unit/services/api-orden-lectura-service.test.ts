import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
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
    estatusValue: "en_bodega_central",
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

// ---------------------------------------------------------------------------
// FEATURE 268 (T6c / R27, 2026-08-22) — el DETALLE POR `numGuia` expone las evidencias del
// INCIDENTE, por sus DOS procedencias.
//
// POR QUE ESTE BLOQUE NO USA `fakeRepo`: con un repo falso, el caso del ADMIN pasaria aunque el
// mapeo no existiera —le estariamos dando la fila ya mapeada—. Aqui se monta el service sobre el
// `OrdenRepository` REAL con Prisma mockeado, de modo que el select y los dos mapeos entran en el
// aserto. Es la unica forma de que el caso del ADMIN se ponga ROJO si solo se amplio el `where`
// de gestiones, que es el criterio de «hecho» de la task.
// ---------------------------------------------------------------------------

const TTL = gestionConfig.SIGNED_URL_TTL_SECONDS;

/** Fila cruda tal y como la devuelve Prisma para `API_ORDEN_DETALLE_SELECT`. */
function prismaDetalleRow(overrides: Record<string, unknown> = {}) {
  return {
    numGuia: 10234,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(1500),
    createdAt: new Date("2026-07-20T15:04:00.000Z"),
    estatus: { value: "incidente" },
    gestiones: [],
    incidentesAdmin: [],
    ...overrides,
  };
}

function servicioSobrePrisma(detalle: Record<string, unknown>, urls: Record<string, string>) {
  const prisma = {
    orden: {
      findFirst: vi.fn().mockResolvedValue(detalle),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const provider = fakeSignedUrls(urls);
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  return { svc: new ApiOrdenLecturaService(repo, provider), provider };
}

describe("ApiOrdenLecturaService.detalle — evidencias de incidente (feature 268, R27)", () => {
  it("R27: incidente del MENSAJERO -> resultado 'incidente', URL firmada y expiraEnSegundos", async () => {
    const { svc, provider } = servicioSobrePrisma(
      prismaDetalleRow({
        gestiones: [
          {
            resultado: "incidente",
            evidenciaStoragePath: "ordenes/o1/incidente-mensajero.jpg",
            evidenciaContentType: "image/jpeg",
            createdAt: new Date("2026-08-22T10:00:00.000Z"),
          },
        ],
      }),
      { "ordenes/o1/incidente-mensajero.jpg": "https://signed/mensajero.jpg" },
    );

    const res = await svc.detalle(ACTOR, 10234);

    expect(provider.createSignedUrls).toHaveBeenCalledWith(
      ["ordenes/o1/incidente-mensajero.jpg"],
      TTL,
    );
    expect(res!.evidencias).toEqual([
      {
        resultado: "incidente",
        contentType: "image/jpeg",
        url: "https://signed/mensajero.jpg",
        expiraEnSegundos: TTL,
      },
    ]);
  });

  it("R27: incidente del ADMIN (sin gestion ninguna) -> resultado 'incidente', URL firmada y expiraEnSegundos", async () => {
    // Este caso es el que distingue la opcion (a+) de la (a): las aristas #48-#52 no crean
    // gestion, asi que ampliar solo el `where` de `gestiones` lo deja en [] y este aserto cae.
    const { svc, provider } = servicioSobrePrisma(
      prismaDetalleRow({
        gestiones: [],
        incidentesAdmin: [
          { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
        ],
      }),
      { "incidentes/i1/portada.jpg": "https://signed/admin.jpg" },
    );

    const res = await svc.detalle(ACTOR, 10234);

    expect(provider.createSignedUrls).toHaveBeenCalledWith(["incidentes/i1/portada.jpg"], TTL);
    expect(res!.evidencias).toEqual([
      {
        resultado: "incidente",
        contentType: "image/png",
        url: "https://signed/admin.jpg",
        expiraEnSegundos: TTL,
      },
    ]);
  });

  it("R27: las DOS procedencias se firman en UNA sola llamada y salen en el mismo array", async () => {
    const { svc, provider } = servicioSobrePrisma(
      prismaDetalleRow({
        gestiones: [
          {
            resultado: "incidente",
            evidenciaStoragePath: "ordenes/o1/incidente-mensajero.jpg",
            evidenciaContentType: "image/jpeg",
            createdAt: new Date("2026-08-22T10:00:00.000Z"),
          },
        ],
        incidentesAdmin: [
          { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
        ],
      }),
      {
        "ordenes/o1/incidente-mensajero.jpg": "https://signed/mensajero.jpg",
        "incidentes/i1/portada.jpg": "https://signed/admin.jpg",
      },
    );

    const res = await svc.detalle(ACTOR, 10234);

    // R17/R18 de la 106 siguen mandando: UNA sola llamada a Storage para todas las evidencias.
    expect(provider.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(res!.evidencias.map((e) => e.url)).toEqual([
      "https://signed/mensajero.jpg",
      "https://signed/admin.jpg",
    ]);
    expect(res!.evidencias.every((e) => e.resultado === "incidente")).toBe(true);
  });

  it("R27: un incidente del ADMIN sin evidencias no produce entrada alguna (nada de url undefined)", async () => {
    const { svc, provider } = servicioSobrePrisma(
      prismaDetalleRow({ gestiones: [], incidentesAdmin: [{ evidencias: [] }] }),
      {},
    );

    const res = await svc.detalle(ACTOR, 10234);

    expect(res!.evidencias).toEqual([]);
    expect(provider.createSignedUrls).not.toHaveBeenCalled();
  });

  it("R27: el DTO del incidente NO expone el storage_path crudo ni el nombre del bucket", async () => {
    const { svc } = servicioSobrePrisma(
      prismaDetalleRow({
        gestiones: [
          {
            resultado: "incidente",
            evidenciaStoragePath: "ordenes/o1/incidente-mensajero.jpg",
            evidenciaContentType: "image/jpeg",
            createdAt: new Date("2026-08-22T10:00:00.000Z"),
          },
        ],
        incidentesAdmin: [
          { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
        ],
      }),
      {
        "ordenes/o1/incidente-mensajero.jpg": "https://signed/mensajero.jpg",
        "incidentes/i1/portada.jpg": "https://signed/admin.jpg",
      },
    );

    const res = await svc.detalle(ACTOR, 10234);

    // Se afirma sobre el JSON ENTERO, no sobre un campo suelto: un campo nuevo que colara el path
    // por otra clave tambien cae aqui.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("ordenes/o1/incidente-mensajero.jpg");
    expect(serialized).not.toContain("incidentes/i1/portada.jpg");
    expect(serialized).not.toMatch(/storagePath|storage_path|bucket|evidencias-gestion/i);
  });
});
