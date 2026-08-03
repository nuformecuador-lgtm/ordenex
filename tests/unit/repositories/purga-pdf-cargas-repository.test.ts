import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PurgaPdfCargasRepository } from "@/lib/repositories/PurgaPdfCargasRepository";

// Feature 178 (T6/T7/T8) — repo del cron de purga de PDF de cargas. Prisma MOCKEADO (patron
// devolucion-sla-repository.test.ts): sin DB real. Las aserciones son DISCRIMINANTES a proposito:
// una purga que mire `fecha_carga` en vez de `created_at`, que use `<` en vez de `<=`, que filtre
// por `deleted_at` o que escriba una columna de mas pasaria un `toMatchObject` laxo y romperia
// R5/R9/R15 en produccion en silencio.

const CORTE = new Date("2026-07-27T09:00:00.000Z");

function buildPrisma() {
  const prisma = {
    carga: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    orden: { findMany: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.carga.findMany.mockResolvedValue([]);
  prisma.orden.findMany.mockResolvedValue([]);
  prisma.orden.updateMany.mockResolvedValue({ count: 0 });
  prisma.carga.update.mockResolvedValue({ id: "c1" });
  // El fake pasa el propio prisma como `tx`: expone orden.updateMany + carga.update.
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new PurgaPdfCargasRepository(prisma as unknown as PrismaClient);
}

// Helpers de lectura del argumento capturado (Prisma recibe un unico objeto por llamada).
type Arg = Record<string, unknown>;
function argDe(spy: { mock: { calls: unknown[][] } }, i = 0): Arg {
  return spy.mock.calls[i][0] as Arg;
}

describe("PurgaPdfCargasRepository.findCargasPurgables (T6)", () => {
  it("R5: filtra por createdAt con operador inclusivo lte, nunca por fechaCarga ni con lt", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).findCargasPurgables(CORTE, 200);

    const where = argDe(prisma.carga.findMany).where as Arg;
    // La columna del corte es `createdAt` y su unico operador es `lte` (corte INCLUSIVO).
    expect(Object.keys(where.createdAt as Arg)).toEqual(["lte"]);
    expect((where.createdAt as { lte: Date }).lte).toEqual(CORTE);
    expect(where.createdAt).not.toHaveProperty("lt");
    // Discriminante: `fechaCarga` no aparece en NINGUNA parte del where (ni anidada).
    expect(JSON.stringify(where)).not.toContain("fechaCarga");
    expect(JSON.stringify(where)).not.toContain("fecha_carga");
  });

  it("R8: exige referencia viva — en la propia carga (OR de las dos columnas) o via some de sus ordenes", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).findCargasPurgables(CORTE, 200);

    const where = argDe(prisma.carga.findMany).where as Arg;
    const or = where.OR as Arg[];
    expect(or).toHaveLength(3);
    expect(or).toEqual(
      expect.arrayContaining([
        { downloadStoragePath: { not: null } },
        { downloadUrl: { not: null } },
      ]),
    );
    // La tercera rama es el EXISTS sobre las ordenes del lote.
    const viaOrdenes = or.find((r) => "ordenes" in r) as { ordenes: { some: { OR: Arg[] } } };
    expect(viaOrdenes.ordenes.some.OR).toEqual(
      expect.arrayContaining([
        { downloadStoragePath: { not: null } },
        { downloadUrl: { not: null } },
      ]),
    );
  });

  it("R5: ordena por createdAt ASC (lo mas viejo primero) y respeta el limite recibido", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).findCargasPurgables(CORTE, 37);

    const arg = argDe(prisma.carga.findMany);
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
    expect(arg.take).toBe(37);
  });

  it("R9: la consulta de rutas de las ordenes NO filtra por deletedAt (los PDF de las borradas ocupan bucket)", async () => {
    const prisma = buildPrisma();
    prisma.carga.findMany.mockResolvedValue([
      { id: "c1", downloadStoragePath: "u1/consolidado.pdf" },
    ]);
    await repoWith(prisma).findCargasPurgables(CORTE, 200);

    const where = argDe(prisma.orden.findMany).where as Arg;
    expect(where).not.toHaveProperty("deletedAt");
    expect(JSON.stringify(where)).not.toContain("deletedAt");
    expect(JSON.stringify(where)).not.toContain("deleted_at");
    expect(where.cargaId).toEqual({ in: ["c1"] });
  });

  it("R7: devuelve la unidad de purga por carga — consolidado + rutas de todas sus ordenes, sin nulos", async () => {
    const prisma = buildPrisma();
    prisma.carga.findMany.mockResolvedValue([
      { id: "c1", downloadStoragePath: "u1/consolidado-1.pdf" },
      { id: "c2", downloadStoragePath: null },
    ]);
    prisma.orden.findMany.mockResolvedValue([
      { cargaId: "c1", downloadStoragePath: "u1/o-a.pdf" },
      { cargaId: "c1", downloadStoragePath: "u1/o-b.pdf" },
      { cargaId: "c2", downloadStoragePath: "u1/o-c.pdf" },
      { cargaId: "c1", downloadStoragePath: null },
      { cargaId: null, downloadStoragePath: "u1/sin-lote.pdf" },
    ]);

    const res = await repoWith(prisma).findCargasPurgables(CORTE, 200);
    expect(res).toEqual([
      {
        cargaId: "c1",
        cargaPath: "u1/consolidado-1.pdf",
        ordenPaths: ["u1/o-a.pdf", "u1/o-b.pdf"],
      },
      { cargaId: "c2", cargaPath: null, ordenPaths: ["u1/o-c.pdf"] },
    ]);
  });

  it("R8: sin cargas candidatas no consulta las ordenes y devuelve lista vacia", async () => {
    const prisma = buildPrisma();
    prisma.carga.findMany.mockResolvedValue([]);

    const res = await repoWith(prisma).findCargasPurgables(CORTE, 200);
    expect(res).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("PurgaPdfCargasRepository.existeAlgunaCandidata (T7)", () => {
  it("R22: devuelve true cuando queda alguna candidata viva y consulta SIN skip", async () => {
    const prisma = buildPrisma();
    prisma.carga.findFirst.mockResolvedValue({ id: "c-201" });

    await expect(repoWith(prisma).existeAlgunaCandidata(CORTE)).resolves.toBe(true);

    const arg = argDe(prisma.carga.findFirst);
    // DISCRIMINANTE (el bug original): la pregunta va DESPUES de purgar, y las ya purgadas
    // salieron del `where` al quedarse sin referencia viva. Un `skip` descontaria candidatas
    // TODAVIA VIVAS y devolveria false con backlog pendiente.
    expect(Object.keys(arg)).not.toContain("skip");
    expect(arg.skip).toBeUndefined();
    expect(arg.take).toBe(1);
    // Mismo predicado que `findCargasPurgables`: corte inclusivo sobre createdAt + referencia viva.
    const where = arg.where as Arg;
    expect(Object.keys(where.createdAt as Arg)).toEqual(["lte"]);
    expect((where.createdAt as { lte: Date }).lte).toEqual(CORTE);
    expect((where.OR as Arg[])).toHaveLength(3);
    // El `where` es LITERALMENTE el mismo objeto de predicado que el de la seleccion.
    await repoWith(prisma).findCargasPurgables(CORTE, 200);
    expect(where).toEqual(argDe(prisma.carga.findMany).where);
  });

  it("R22: devuelve false cuando no queda ninguna candidata", async () => {
    const prisma = buildPrisma();
    prisma.carga.findFirst.mockResolvedValue(null);

    await expect(repoWith(prisma).existeAlgunaCandidata(CORTE)).resolves.toBe(false);
  });
});

describe("PurgaPdfCargasRepository.limpiarReferencias (T8)", () => {
  it("R13/R14/R15: el data de ambos updates es exactamente downloadUrl y downloadStoragePath a null", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 12 });

    await repoWith(prisma).limpiarReferencias("c1");

    const dataOrdenes = argDe(prisma.orden.updateMany).data as Arg;
    const dataCarga = argDe(prisma.carga.update).data as Arg;
    // Conjunto EXACTO de claves: ninguna otra columna se toca (R15).
    expect(new Set(Object.keys(dataOrdenes))).toEqual(
      new Set(["downloadUrl", "downloadStoragePath"]),
    );
    expect(new Set(Object.keys(dataCarga))).toEqual(
      new Set(["downloadUrl", "downloadStoragePath"]),
    );
    expect(dataOrdenes).toEqual({ downloadUrl: null, downloadStoragePath: null });
    expect(dataCarga).toEqual({ downloadUrl: null, downloadStoragePath: null });
    expect(argDe(prisma.carga.update).where).toEqual({ id: "c1" });
  });

  it("R15: no borra ninguna fila de carga ni de orden", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 3 });

    await repoWith(prisma).limpiarReferencias("c1");

    expect(prisma.orden.delete).not.toHaveBeenCalled();
    expect(prisma.orden.deleteMany).not.toHaveBeenCalled();
    expect(prisma.carga.delete).not.toHaveBeenCalled();
  });

  it("R9: el where del update de ordenes es solo cargaId, sin deletedAt (incluye las borradas)", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 3 });

    await repoWith(prisma).limpiarReferencias("c1");

    const where = argDe(prisma.orden.updateMany).where as Arg;
    expect(where).toEqual({ cargaId: "c1" });
    expect(where).not.toHaveProperty("deletedAt");
  });

  it("R13/R14: ambos updates ocurren dentro de la MISMA transaccion y devuelve las ordenes actualizadas", async () => {
    const prisma = buildPrisma();
    const orden: string[] = [];
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      orden.push("tx:inicio");
      const out = await fn(prisma);
      orden.push("tx:fin");
      return out;
    });
    prisma.orden.updateMany.mockImplementation(async () => {
      orden.push("orden.updateMany");
      return { count: 7 };
    });
    prisma.carga.update.mockImplementation(async () => {
      orden.push("carga.update");
      return { id: "c1" };
    });

    const res = await repoWith(prisma).limpiarReferencias("c1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(orden).toEqual(["tx:inicio", "orden.updateMany", "carga.update", "tx:fin"]);
    expect(res).toEqual({ ordenesActualizadas: 7 });
  });
});
