import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { JobRepository } from "@/lib/repositories/JobRepository";

// Feature 92 (R4) — `findByDedupeKeys`. Prisma va mockeado (patron del resto de
// tests/integration/repositories: la suite de vitest NO levanta Postgres), pero el fake
// EJECUTA la semantica que importa —igualdad sobre `dedupe_key`— en vez de devolver una
// constante. Asi se verifican el match exacto, el lote mixto y la lista vacia.

interface FilaJob {
  id: string;
  dedupe_key: string | null;
  estado: string;
}

const FILAS: FilaJob[] = [
  { id: "j1", dedupe_key: "geocodificacion:o1:aaaaaaaa", estado: "failed" },
  { id: "j2", dedupe_key: "geocodificacion:o2:bbbbbbbb", estado: "pending" },
  { id: "j3", dedupe_key: null, estado: "done" },
];

/**
 * Prisma fake cuyo `$queryRaw` aplica el filtro `IN (...)` sobre `FILAS`. Los valores
 * interpolados llegan como argumentos variadicos tras el array de literales.
 */
function buildPrisma() {
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    // El primer valor es el `Prisma.join(keys)`; se leen las claves de los argumentos.
    const keys = values.flatMap((v) => {
      const sqlValues = (v as { values?: unknown[] })?.values;
      return Array.isArray(sqlValues) ? sqlValues : [v];
    });
    return {
      sql,
      rows: FILAS.filter((f) => f.dedupe_key !== null && keys.includes(f.dedupe_key)).map(
        (f) => ({
          ...f,
          tipo: "geocodificacion",
          payload: {},
          intentos: 1,
          max_intentos: 8,
          run_after: new Date(),
          locked_at: null,
          last_error: null,
          created_at: new Date(),
          updated_at: new Date(),
        }),
      ),
    }.rows;
  });
  const prisma = { $queryRaw, $executeRaw: vi.fn() };
  return { prisma, $queryRaw };
}

describe("R4 — findByDedupeKeys", () => {
  it("match EXACTO: devuelve solo el job de la clave pedida", async () => {
    const { prisma } = buildPrisma();
    const repo = new JobRepository(prisma as unknown as PrismaClient);

    const jobs = await repo.findByDedupeKeys(["geocodificacion:o1:aaaaaaaa"]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("j1");
    expect(jobs[0].estado).toBe("failed");
    expect(jobs[0].dedupeKey).toBe("geocodificacion:o1:aaaaaaaa");
  });

  it("lote MIXTO: devuelve las existentes y omite las inexistentes, sin fallar", async () => {
    const { prisma } = buildPrisma();
    const repo = new JobRepository(prisma as unknown as PrismaClient);

    const jobs = await repo.findByDedupeKeys([
      "geocodificacion:o1:aaaaaaaa",
      "geocodificacion:o9:zzzzzzzz", // no existe
      "geocodificacion:o2:bbbbbbbb",
    ]);

    expect(jobs.map((j) => j.id).sort()).toEqual(["j1", "j2"]);
  });

  it("clave INEXISTENTE -> [] (no lanza, no devuelve la fila con dedupe_key null)", async () => {
    const { prisma } = buildPrisma();
    const repo = new JobRepository(prisma as unknown as PrismaClient);
    expect(await repo.findByDedupeKeys(["no-existe"])).toEqual([]);
  });

  it("lista VACIA -> [] SIN tocar la DB (`IN ()` no es SQL valido)", async () => {
    const { prisma, $queryRaw } = buildPrisma();
    const repo = new JobRepository(prisma as unknown as PrismaClient);

    expect(await repo.findByDedupeKeys([])).toEqual([]);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it("la consulta es por IGUALDAD (`IN`), NUNCA por prefijo (`LIKE`)", async () => {
    // Con `LIKE` haria falta un indice `text_pattern_ops` nuevo, degeneraria en seq scan
    // por lote y devolveria jobs de direcciones HISTORICAS (design §0.2).
    const { prisma, $queryRaw } = buildPrisma();
    const repo = new JobRepository(prisma as unknown as PrismaClient);

    await repo.findByDedupeKeys(["geocodificacion:o1:aaaaaaaa"]);

    const sql = ($queryRaw.mock.calls[0][0] as unknown as string[]).join(" ");
    expect(sql).toMatch(/"dedupe_key"\s+IN/);
    expect(sql).not.toMatch(/LIKE/i);
  });
});
