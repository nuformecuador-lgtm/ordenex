import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { idEstado } from "@/tests/fixtures/catalogo-estados";

// Feature 149 — T2.1 (R11): `findOrigenesReversion` es una LECTURA PURA. Verifica la FORMA de
// la consulta (DISTINCT ON + orden de desempate + join al `value` del origen) y el mapeo
// `ordenId -> value | null`. Prisma va con un doble: no hay DB en un unit.

function buildPrisma(rows: { orden_id: string; value: string | null }[] = []) {
  const $queryRaw = vi.fn().mockResolvedValue(rows);
  return { prisma: { $queryRaw, ordenHistorialEstado: {} }, $queryRaw };
}

function sqlDe($queryRaw: ReturnType<typeof vi.fn>): string {
  const call = $queryRaw.mock.calls[0] as unknown[];
  return (call[0] as string[]).join(" ");
}

describe("OrdenHistorialRepository.findOrigenesReversion (feature 149/R11)", () => {
  it("una sola consulta para todo el lote, con DISTINCT ON y desempate created_at/id DESC", async () => {
    const { prisma, $queryRaw } = buildPrisma([
      { orden_id: "o1", value: "en_bodega_central" },
      { orden_id: "o2", value: "en_bodega_satelite" },
    ]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const mapa = await repo.findOrigenesReversion([
      { ordenId: "o1", estatusActualId: idEstado("por_recoger") },
      { ordenId: "o2", estatusActualId: idEstado("por_recoger") },
    ]);

    expect($queryRaw).toHaveBeenCalledTimes(1); // sin N+1
    const sql = sqlDe($queryRaw);
    expect(sql).toMatch(/DISTINCT ON \(h\."orden_id"\)/);
    expect(sql).toMatch(/"orden_historial_estado"/);
    // Q3: desempate determinista por (created_at DESC, id DESC).
    expect(sql).toMatch(/ORDER BY h\."orden_id", h\."created_at" DESC, h\."id" DESC/);
    // El origen se resuelve a `value` con LEFT JOIN: una fila de creacion (origen NULL) llega
    // como `value` NULL en vez de desaparecer del resultado.
    expect(sql).toMatch(/LEFT JOIN "order_status" os ON os\."id" = h\."estatus_origen_id"/);
    // El par (orden, estado actual) se filtra por `estatus_destino_id` (indice existente).
    expect(sql).toMatch(/f\.estatus_destino_id = h\."estatus_destino_id"/);

    expect(mapa.get("o1")).toBe("en_bodega_central");
    expect(mapa.get("o2")).toBe("en_bodega_satelite");
  });

  it("los pares (ordenId, estatusActualId) viajan PARAMETRIZADOS, no concatenados", async () => {
    const { prisma, $queryRaw } = buildPrisma([]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.findOrigenesReversion([
      { ordenId: "o1", estatusActualId: idEstado("por_recoger") },
    ]);

    const sql = sqlDe($queryRaw);
    expect(sql).not.toContain("o1"); // el id no esta en el texto del SQL
    expect(sql).not.toContain(idEstado("por_recoger"));
  });

  it("mapea `value` NULL (fila de creacion) a null y omite las ordenes sin fila", async () => {
    const { prisma } = buildPrisma([{ orden_id: "o1", value: null }]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const mapa = await repo.findOrigenesReversion([
      { ordenId: "o1", estatusActualId: idEstado("por_recoger") },
      { ordenId: "o2", estatusActualId: idEstado("por_recoger") },
    ]);

    expect(mapa.has("o1")).toBe(true);
    expect(mapa.get("o1")).toBeNull(); // fila de creacion -> el service rechaza (R13)
    expect(mapa.has("o2")).toBe(false); // sin fila -> el service rechaza (R13)
  });

  it("no consulta nada con el lote vacio", async () => {
    const { prisma, $queryRaw } = buildPrisma([]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    expect((await repo.findOrigenesReversion([])).size).toBe(0);
    expect($queryRaw).not.toHaveBeenCalled();
  });
});
