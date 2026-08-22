import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 177 (Bloque C: T6/T7/T8/T9) — metodos de repositorio del canal integrador para la
// consulta por identificador libre y el PDF de etiquetas. Prisma mockeado: lo que se afirma es
// el ARGUMENTO que llega a Prisma (scope por owner, igualdad exacta, columnas tocadas), porque
// es ahi donde vive el aislamiento entre integradores.

type Mock = ReturnType<typeof vi.fn>;

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    carga: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    ordenHistorialEstado: { createMany: vi.fn() },
    orderStatus: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    ...overrides,
  };
}

function repoCon(prisma: ReturnType<typeof buildPrisma>) {
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

function ordenDetalleRow(overrides: Record<string, unknown> = {}) {
  return {
    numGuia: 100234,
    numRemision: "REM-0001",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(25.9),
    createdAt: new Date("2026-07-22T14:03:11.000Z"),
    estatus: { value: "entregada" },
    gestiones: [],
    incidentesAdmin: [], // 268/R27: segunda procedencia de las evidencias (incidente del ADMIN)
    ...overrides,
  };
}

const OWNER = "store-1";

// ---------------------------------------------------------------------------
// T6 — findByGuiaORemisionForOwner [R6-R12]
// ---------------------------------------------------------------------------

describe("OrdenRepository.findByGuiaORemisionForOwner (feature 177, T6)", () => {
  it("R7/R12: el where fuerza tiendaId = ownerId y deletedAt: null", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: 100234, numRemision: "100234" },
      OWNER,
    );

    const where = (prisma.orden.findMany as Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ tiendaId: OWNER, deletedAt: null });
    expect(where.deletedAt).toBeNull();
  });

  it("R8: con numGuia null NO se emite ninguna condicion sobre numGuia", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: null, numRemision: "REM-0001" },
      OWNER,
    );

    const where = (prisma.orden.findMany as Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual([{ numRemision: "REM-0001" }]);
    expect(JSON.stringify(where)).not.toContain("numGuia");
  });

  it("R9: con entero positivo evalua AMBAS columnas en el OR", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: 100234, numRemision: "100234" },
      OWNER,
    );

    const where = (prisma.orden.findMany as Mock).mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ numGuia: 100234 }, { numRemision: "100234" }]),
    );
    expect(where.OR).toHaveLength(2);
  });

  it("R10: compara por IGUALDAD exacta, nunca contains/startsWith/endsWith/mode", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: 100234, numRemision: "100234" },
      OWNER,
    );

    const where = (prisma.orden.findMany as Mock).mock.calls[0][0].where;
    const serializado = JSON.stringify(where);
    for (const prohibido of ["contains", "startsWith", "endsWith", "mode", "search", "not"]) {
      expect(serializado).not.toContain(prohibido);
    }
    // Igualdad = valor primitivo directo, no un objeto de filtro.
    for (const rama of where.OR as Array<Record<string, unknown>>) {
      for (const valor of Object.values(rama)) {
        expect(typeof valor === "number" || typeof valor === "string").toBe(true);
      }
    }
  });

  it("R11: sin coincidencias devuelve lista vacia", async () => {
    const prisma = buildPrisma();
    const res = await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: 999, numRemision: "999" },
      OWNER,
    );
    expect(res).toEqual([]);
  });

  it("R6: una sola coincidencia devuelve id, numGuia y numRemision de esa fila", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findMany as Mock).mockResolvedValue([
      { id: "o-1", numGuia: 100234, numRemision: "REM-0001" },
    ]);

    const res = await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: 100234, numRemision: "100234" },
      OWNER,
    );

    expect(res).toEqual([{ id: "o-1", numGuia: 100234, numRemision: "REM-0001" }]);
  });

  it("R6/R14: con coincidencia cruzada devuelve LAS DOS filas sin desempatar, con take 2", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findMany as Mock).mockResolvedValue([
      { id: "o-guia", numGuia: 100234, numRemision: "REM-A" },
      { id: "o-remision", numGuia: 555, numRemision: "100234" },
    ]);

    const res = await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: 100234, numRemision: "100234" },
      OWNER,
    );

    expect(res).toHaveLength(2);
    expect(res.map((r) => r.id)).toEqual(["o-guia", "o-remision"]);
    expect((prisma.orden.findMany as Mock).mock.calls[0][0].take).toBe(2);
  });

  it("proyecta solo id, numGuia y numRemision (nada de PII ni columnas internas)", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).findByGuiaORemisionForOwner(
      { numGuia: null, numRemision: "REM-0001" },
      OWNER,
    );

    const select = (prisma.orden.findMany as Mock).mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(["id", "numGuia", "numRemision"]);
  });
});

// ---------------------------------------------------------------------------
// T7 — findDetalleByOrdenIdForOwner [R16, R17]
// ---------------------------------------------------------------------------

describe("OrdenRepository.findDetalleByOrdenIdForOwner (feature 177, T7)", () => {
  it("R16: orden propia devuelve el detalle con sus evidencias firmables", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findFirst as Mock).mockResolvedValue(
      ordenDetalleRow({
        gestiones: [
          {
            resultado: "entregada",
            evidenciaStoragePath: "ordenes/o1/evidencia.jpg",
            evidenciaContentType: "image/jpeg",
            createdAt: new Date("2026-07-23T10:00:00.000Z"),
          },
        ],
      }),
    );

    const res = await repoCon(prisma).findDetalleByOrdenIdForOwner("o-1", OWNER);

    expect(res).not.toBeNull();
    expect(res!.numGuia).toBe(100234);
    expect(res!.estatusValue).toBe("entregada");
    expect(res!.montoCobrar).toBe(25.9);
    expect(res!.evidencias).toEqual([
      {
        resultado: "entregada",
        storagePath: "ordenes/o1/evidencia.jpg",
        contentType: "image/jpeg",
      },
    ]);
  });

  it("R16: orden propia sin evidencias devuelve evidencias = []", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findFirst as Mock).mockResolvedValue(ordenDetalleRow());

    const res = await repoCon(prisma).findDetalleByOrdenIdForOwner("o-1", OWNER);

    expect(res!.evidencias).toEqual([]);
  });

  it("R16: orden AJENA devuelve null porque el where exige tiendaId = ownerId", async () => {
    const prisma = buildPrisma();

    const res = await repoCon(prisma).findDetalleByOrdenIdForOwner("o-ajena", OWNER);

    expect(res).toBeNull();
    const where = (prisma.orden.findFirst as Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "o-ajena", tiendaId: OWNER });
  });

  it("R16: orden BORRADA devuelve null porque el where exige deletedAt: null", async () => {
    const prisma = buildPrisma();

    const res = await repoCon(prisma).findDetalleByOrdenIdForOwner("o-borrada", OWNER);

    expect(res).toBeNull();
    const where = (prisma.orden.findFirst as Mock).mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect("deletedAt" in where).toBe(true);
  });

  it("R16 (+268/R27): acota las evidencias a entregada/rechazada/incidente con evidencia_storage_path no nulo", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findFirst as Mock).mockResolvedValue(ordenDetalleRow());

    await repoCon(prisma).findDetalleByOrdenIdForOwner("o-1", OWNER);

    // FEATURE 268 (T6c, 2026-08-22): el `in` gana `incidente` (camino del MENSAJERO). El camino
    // del ADMIN no crea gestion, asi que viaja aparte por `incidentesAdmin`; ambos se mapean al
    // mismo array `evidencias[]`. Ver design §7.3 (opcion a+).
    const gestiones = (prisma.orden.findFirst as Mock).mock.calls[0][0].select.gestiones;
    expect(gestiones.where.resultado.in).toEqual(["entregada", "rechazada", "incidente"]);
    expect(gestiones.where.evidenciaStoragePath).toEqual({ not: null });
  });

  it("268/R27: la variante por id trae tambien la evidencia del incidente del ADMIN", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findFirst as Mock).mockResolvedValue(
      ordenDetalleRow({
        estatus: { value: "incidente" },
        gestiones: [], // el admin NO crea gestion: sin el mapeo de `incidentesAdmin` esto sale []
        incidentesAdmin: [
          { evidencias: [{ storagePath: "incidentes/i1/portada.jpg", contentType: "image/png" }] },
        ],
      }),
    );

    const res = await repoCon(prisma).findDetalleByOrdenIdForOwner("o-1", OWNER);

    expect(res!.evidencias).toEqual([
      {
        resultado: "incidente",
        storagePath: "incidentes/i1/portada.jpg",
        contentType: "image/png",
      },
    ]);
  });

  it("R17: findDetalleByNumGuiaForOwner NO cambio de firma ni de proyeccion (misma que la variante por id)", async () => {
    // Firma: sigue recibiendo (numGuia, ownerId) y resolviendo por num_guia.
    expect(OrdenRepository.prototype.findDetalleByNumGuiaForOwner.length).toBe(2);

    const prismaGuia = buildPrisma();
    (prismaGuia.orden.findFirst as Mock).mockResolvedValue(ordenDetalleRow());
    const porGuia = await repoCon(prismaGuia).findDetalleByNumGuiaForOwner(100234, OWNER);
    const callGuia = (prismaGuia.orden.findFirst as Mock).mock.calls[0][0];

    const prismaId = buildPrisma();
    (prismaId.orden.findFirst as Mock).mockResolvedValue(ordenDetalleRow());
    const porId = await repoCon(prismaId).findDetalleByOrdenIdForOwner("o-1", OWNER);
    const callId = (prismaId.orden.findFirst as Mock).mock.calls[0][0];

    // La 106 sigue resolviendo por num_guia con su scope intacto.
    expect(callGuia.where).toMatchObject({ numGuia: 100234, tiendaId: OWNER, deletedAt: null });
    // Y la proyeccion es EXACTAMENTE la misma en ambas variantes (extraida a una constante).
    expect(callId.select).toEqual(callGuia.select);
    expect(porId).toEqual(porGuia);
  });
});

// ---------------------------------------------------------------------------
// T8 — download_storage_path de la ORDEN [R26, R38]
// ---------------------------------------------------------------------------

describe("OrdenRepository.findDownloadStoragePathByOrdenForOwner (feature 177, T8)", () => {
  it("R38: fila heredada de la 136/141 (download_url poblada, path NULL) devuelve null", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findFirst as Mock).mockResolvedValue({
      downloadStoragePath: null,
      // La columna vieja existe en la fila real, pero no debe influir.
      downloadUrl: "https://proyecto.supabase.co/storage/v1/object/sign/etiquetas/caducada",
    });

    const res = await repoCon(prisma).findDownloadStoragePathByOrdenForOwner("o-1", OWNER);

    expect(res).toBeNull();
  });

  it("R21: devuelve el path persistido cuando la orden propia ya tiene PDF", async () => {
    const prisma = buildPrisma();
    (prisma.orden.findFirst as Mock).mockResolvedValue({
      downloadStoragePath: "usuario-1/abc.pdf",
    });

    const res = await repoCon(prisma).findDownloadStoragePathByOrdenForOwner("o-1", OWNER);

    expect(res).toBe("usuario-1/abc.pdf");
  });

  it("R26/R38: la lectura NO proyecta download_url y va scoped por owner y no borrada", async () => {
    const prisma = buildPrisma();

    const res = await repoCon(prisma).findDownloadStoragePathByOrdenForOwner("o-ajena", OWNER);

    expect(res).toBeNull();
    const call = (prisma.orden.findFirst as Mock).mock.calls[0][0];
    expect(Object.keys(call.select)).toEqual(["downloadStoragePath"]);
    expect(call.where).toMatchObject({ id: "o-ajena", tiendaId: OWNER, deletedAt: null });
  });
});

describe("OrdenRepository.setOrdenDownloadStoragePath (feature 177, T8)", () => {
  it("R26: el update emite UNA sola clave en data (downloadStoragePath) y no incluye downloadUrl", async () => {
    const prisma = buildPrisma();

    await repoCon(prisma).setOrdenDownloadStoragePath("o-1", "usuario-1/abc.pdf");

    expect(prisma.orden.update as Mock).toHaveBeenCalledTimes(1);
    const call = (prisma.orden.update as Mock).mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(["downloadStoragePath"]);
    expect(Object.keys(call.data)).not.toContain("downloadUrl");
    expect(call.data.downloadStoragePath).toBe("usuario-1/abc.pdf");
    expect(call.where).toEqual({ id: "o-1" });
  });
});

// ---------------------------------------------------------------------------
// T9 — carga del lote y su download_storage_path [R29, R32, R35]
// ---------------------------------------------------------------------------

describe("OrdenRepository.findCargaConOrdenesForOwner (feature 177, T9)", () => {
  it("R29: carga propia devuelve su path y los ids de sus N ordenes", async () => {
    const prisma = buildPrisma();
    (prisma.carga.findFirst as Mock).mockResolvedValue({
      downloadStoragePath: "usuario-1/lote.pdf",
      ordenes: [{ id: "o-1" }, { id: "o-2" }, { id: "o-3" }],
    });

    const res = await repoCon(prisma).findCargaConOrdenesForOwner("carga-1", OWNER);

    expect(res).toEqual({
      downloadStoragePath: "usuario-1/lote.pdf",
      ordenIds: ["o-1", "o-2", "o-3"],
    });
  });

  it("R29: carga sin PDF aun devuelve downloadStoragePath null y sus ordenes", async () => {
    const prisma = buildPrisma();
    (prisma.carga.findFirst as Mock).mockResolvedValue({
      downloadStoragePath: null,
      ordenes: [{ id: "o-1" }],
    });

    const res = await repoCon(prisma).findCargaConOrdenesForOwner("carga-1", OWNER);

    expect(res).toEqual({ downloadStoragePath: null, ordenIds: ["o-1"] });
  });

  it("R29: carga AJENA devuelve null porque el where exige usuarioCarga = ownerId", async () => {
    const prisma = buildPrisma();

    const res = await repoCon(prisma).findCargaConOrdenesForOwner("carga-ajena", OWNER);

    expect(res).toBeNull();
    const where = (prisma.carga.findFirst as Mock).mock.calls[0][0].where;
    expect(where).toEqual({ id: "carga-ajena", usuarioCarga: OWNER });
  });

  it("R29: carga INEXISTENTE devuelve null (mismo camino que la ajena)", async () => {
    const prisma = buildPrisma();

    const res = await repoCon(prisma).findCargaConOrdenesForOwner("carga-fantasma", OWNER);

    expect(res).toBeNull();
  });

  it("R32: excluye del lote las ordenes borradas y las de otro owner", async () => {
    const prisma = buildPrisma();
    (prisma.carga.findFirst as Mock).mockResolvedValue({
      downloadStoragePath: null,
      ordenes: [{ id: "o-viva" }],
    });

    const res = await repoCon(prisma).findCargaConOrdenesForOwner("carga-1", OWNER);

    const select = (prisma.carga.findFirst as Mock).mock.calls[0][0].select;
    expect(select.ordenes.where).toEqual({ tiendaId: OWNER, deletedAt: null });
    expect(res!.ordenIds).toEqual(["o-viva"]);
  });
});

describe("OrdenRepository.setCargaDownloadStoragePath (feature 177, T9)", () => {
  it("R35: el update de carga toca UNA sola columna y no incluye downloadUrl", async () => {
    const prisma = buildPrisma();

    await repoCon(prisma).setCargaDownloadStoragePath("carga-1", "usuario-1/lote.pdf");

    expect(prisma.carga.update as Mock).toHaveBeenCalledTimes(1);
    const call = (prisma.carga.update as Mock).mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(["downloadStoragePath"]);
    expect(Object.keys(call.data)).not.toContain("downloadUrl");
    expect(call.where).toEqual({ id: "carga-1" });
  });
});
