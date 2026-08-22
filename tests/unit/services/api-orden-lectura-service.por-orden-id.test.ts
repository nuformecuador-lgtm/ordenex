// Feature 177 (R16/R17) — `ApiOrdenLecturaService.detallePorOrdenId(actor, ordenId)`: MISMO DTO
// y MISMO firmado de evidencias que `detalle`, pero leyendo por `orden.id`. Es una ADICION: los
// tests de la 106 (`api-orden-lectura-service.test.ts`) siguen intactos y verdes.
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

// ---------------------------------------------------------------------------
// FEATURE 268 (T6c / R27, 2026-08-22) — el DETALLE POR `orden.id` expone las evidencias del
// INCIDENTE, por sus DOS procedencias.
//
// Se afirma tambien AQUI, y no solo en el archivo de la 106, porque este es el recurso que enlaza
// el webhook (design §6: se elige la variante por `orden.id` porque `num_guia` puede ser NULL).
// Que el mapeo y el firmado sean "los mismos" es precisamente lo que hay que demostrar, no lo que
// se puede dar por supuesto: si alguien duplicara la proyeccion, este bloque lo caza.
//
// Igual que en el archivo hermano, el service se monta sobre el `OrdenRepository` REAL con Prisma
// mockeado: con un repo falso el caso del ADMIN pasaria aunque el mapeo no existiera.
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

describe("ApiOrdenLecturaService.detallePorOrdenId — evidencias de incidente (feature 268, R27)", () => {
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

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

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
    // El caso que separa la opcion (a+) de la (a): las aristas #48-#52 no crean gestion, asi que
    // ampliar solo el `where` de `gestiones` deja este array vacio y el aserto cae.
    const { svc, provider } = servicioSobrePrisma(
      prismaDetalleRow({
        gestiones: [],
        incidentesAdmin: [
          { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
        ],
      }),
      { "incidentes/i1/portada.jpg": "https://signed/admin.jpg" },
    );

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

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

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

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

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

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

    const res = await svc.detallePorOrdenId(ACTOR, ORDEN_ID);

    // Sobre el JSON ENTERO, no sobre un campo suelto.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("ordenes/o1/incidente-mensajero.jpg");
    expect(serialized).not.toContain("incidentes/i1/portada.jpg");
    expect(serialized).not.toMatch(/storagePath|storage_path|bucket|evidencias-gestion/i);
  });
});
