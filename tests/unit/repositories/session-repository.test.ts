import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { SessionRepository } from "@/lib/repositories/SessionRepository";

type MockedPrisma = Pick<PrismaClient, "session">;

describe("SessionRepository", () => {
  it("crea una sesion con expiresAt calculado a partir del TTL en horas (R23)", async () => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({
      id: "sess-1",
      userId: data.userId,
      expiresAt: data.expiresAt,
      createdAt: new Date(),
    }));
    const prisma = { session: { create } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    const before = Date.now();
    const session = await repo.create({ userId: "usr-1", ttlHours: 24 });
    const expectedMs = before + 24 * 60 * 60 * 1000;

    expect(session.userId).toBe("usr-1");
    expect(Math.abs(session.expiresAt.getTime() - expectedMs)).toBeLessThan(5_000);
  });

  it("findValidById devuelve la sesion si expiresAt aun no paso", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "sess-1",
      userId: "usr-1",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    const prisma = { session: { findUnique } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    const session = await repo.findValidById("sess-1");
    expect(session?.id).toBe("sess-1");
  });

  it("findValidById devuelve null si expiresAt ya paso (R23a)", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "sess-1",
      userId: "usr-1",
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    });
    const prisma = { session: { findUnique } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    await expect(repo.findValidById("sess-1")).resolves.toBeNull();
  });

  it("findValidById devuelve null si la sesion no existe", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { session: { findUnique } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    await expect(repo.findValidById("no-existe")).resolves.toBeNull();
  });

  it("deleteById elimina el registro (R24)", async () => {
    const del = vi.fn().mockResolvedValue({});
    const prisma = { session: { delete: del } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    await repo.deleteById("sess-1");

    expect(del).toHaveBeenCalledWith({ where: { id: "sess-1" } });
  });

  // Feature 287 (T2, R16/R19).
  //
  // ⚠️ ESTE CASO **NO** PRUEBA EL `WHERE`. Comprueba que el repositorio EMITE el objeto que
  // decimos, que es otra cosa distinta de que ese `where` seleccione las filas correctas: con un
  // doble, `where: {}` responde exactamente igual. Lo que sostiene R16/R17 de verdad es
  // `tests/integration/db/restablecer-contrasena-sql-real.test.ts`, contra Postgres.
  it("deleteAllByUserId borra por userId y devuelve el count (287/R16/R19)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = { session: { deleteMany } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    await expect(repo.deleteAllByUserId("usr-1")).resolves.toBe(3);

    // El `where` es el userId Y NADA MAS: no filtra por `expiresAt`, porque R16 exige borrar
    // tambien las sesiones que aun no han expirado (son justo las peligrosas).
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "usr-1" } });
    expect(Object.keys(deleteMany.mock.calls[0][0].where)).toEqual(["userId"]);
  });

  it("deleteAllByUserId es idempotente: cero sesiones devuelve 0, no lanza (287/R16)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { session: { deleteMany } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    await expect(repo.deleteAllByUserId("sin-sesiones")).resolves.toBe(0);
  });

  it("deleteById es idempotente si la sesion ya no existe", async () => {
    const del = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "7.8.0",
      }),
    );
    const prisma = { session: { delete: del } } as unknown as MockedPrisma;
    const repo = new SessionRepository(prisma);

    await expect(repo.deleteById("no-existe")).resolves.toBeUndefined();
  });
});
