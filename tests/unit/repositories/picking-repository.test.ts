import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { PickingRepository, type PickingPrismaClient } from "@/lib/repositories/PickingRepository";

// Ficha 476 (T3.1, R29) — el repositorio con un doble de Prisma: UNA sentencia por lectura sea cual
// sea el numero de ordenes, y la forma de la sentencia. Lo que el `WHERE` filtra DE VERDAD lo prueba
// `tests/integration/db/picking-ordenes-en-preparacion.test.ts` contra Postgres (un doble no ve SQL).

function filasCrudas(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    orden_id: `o${i}`,
    tienda_id: "t1",
    num_remision: `NA-${i}`,
    num_guia: i % 2 === 0 ? null : BigInt(48000 + i),
    producto: "1 * X",
    entrada: new Date("2026-10-04T12:00:00.000Z"),
  }));
}

function doble(n: number) {
  const $queryRaw = vi.fn<(q: Prisma.Sql) => Promise<ReturnType<typeof filasCrudas>>>(async () => filasCrudas(n));
  const findUnique = vi.fn();
  const findMany = vi.fn(async () => [{ id: "t1", nombre: "Gameos" }]);
  const prisma = { $queryRaw, usuario: { findUnique, findMany } } as unknown as PickingPrismaClient;
  return { repo: new PickingRepository(prisma), $queryRaw, findUnique, findMany };
}

const sqlDe = (q: Prisma.Sql) => q.text.replace(/\s+/g, " ");

describe("476/R29 — una sentencia por generacion, sin N+1", () => {
  it.each([1, 60])("ordenesEnPreparacion con %i ordenes hace UNA $queryRaw", async (n) => {
    const d = doble(n);
    const filas = await d.repo.ordenesEnPreparacion("t1");
    expect(filas).toHaveLength(n);
    expect(d.$queryRaw).toHaveBeenCalledTimes(1);
    expect(d.findUnique).not.toHaveBeenCalled();
  });

  it("la sentencia: LATERAL al historial por destino, los cuatro predicados, orden natural y la tienda como parametro", async () => {
    const d = doble(1);
    await d.repo.ordenesEnPreparacion("t-123");
    const q = d.$queryRaw.mock.calls[0][0];
    const sql = sqlDe(q);
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain('hh."estatus_destino_id" = s."id"');
    expect(sql).toContain('COALESCE(h."entrada", o."created_at")');
    expect(sql).toContain('o."deleted_at" IS NULL');
    expect(sql).toContain("s.\"value\" = 'en_preparacion'");
    expect(sql).toContain('t."fulfillment" = true');
    expect(sql).toContain('o."tienda_id" = $1');
    expect(sql).toContain('ORDER BY o."clave_remision" ASC, o."id" ASC');
    expect(q.values).toEqual(["t-123"]);
  });

  it("mapea la fila: num_guia a number o null, entrada como Date", async () => {
    const d = doble(2);
    expect(await d.repo.ordenesEnPreparacion("t1")).toEqual([
      { ordenId: "o0", numRemision: "NA-0", numGuia: null, producto: "1 * X", entrada: new Date("2026-10-04T12:00:00.000Z") },
      { ordenId: "o1", numRemision: "NA-1", numGuia: 48001, producto: "1 * X", entrada: new Date("2026-10-04T12:00:00.000Z") },
    ]);
  });

  it("entradasEnPreparacion: UNA sentencia, la MISMA seleccion pero sin filtro de tienda", async () => {
    const d = doble(60);
    const e = await d.repo.entradasEnPreparacion();
    expect(e).toHaveLength(60);
    expect(e[0]).toEqual({ tiendaId: "t1", entrada: new Date("2026-10-04T12:00:00.000Z") });
    expect(d.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlDe(d.$queryRaw.mock.calls[0][0]);
    expect(sql).toContain('t."fulfillment" = true');
    expect(sql).not.toContain('o."tienda_id" =');
    expect(d.$queryRaw.mock.calls[0][0].values).toEqual([]);
  });
});

describe("476/R7/R3 — lecturas de tienda", () => {
  it("tiendaDelPicking: rol adminTienda → esTienda; otro rol → no; inexistente → null", async () => {
    const d = doble(0);
    d.findUnique.mockResolvedValueOnce({ id: "t1", nombre: "Gameos", fulfillment: true, rol: { value: "adminTienda" } });
    expect(await d.repo.tiendaDelPicking("t1")).toEqual({ id: "t1", nombre: "Gameos", fulfillment: true, esTienda: true });
    d.findUnique.mockResolvedValueOnce({ id: "m1", nombre: "Ana", fulfillment: false, rol: { value: "admin" } });
    expect(await d.repo.tiendaDelPicking("m1")).toMatchObject({ esTienda: false });
    d.findUnique.mockResolvedValueOnce(null);
    expect(await d.repo.tiendaDelPicking("x")).toBeNull();
    expect(d.findUnique.mock.calls[0][0]).toMatchObject({ where: { id: "t1" } });
  });

  it("tiendasFulfillment: solo adminTienda con fulfillment", async () => {
    const d = doble(0);
    await d.repo.tiendasFulfillment();
    expect(d.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fulfillment: true, rol: { value: "adminTienda" } } }),
    );
  });
});
