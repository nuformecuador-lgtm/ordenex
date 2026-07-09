import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { LoginAttemptRepository } from "@/lib/repositories/LoginAttemptRepository";

type MockedPrisma = Pick<PrismaClient, "loginAttempt">;

describe("LoginAttemptRepository", () => {
  it("registrar inserta el intento con todos los campos de auditoria (R18)", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { loginAttempt: { create } } as unknown as MockedPrisma;
    const repo = new LoginAttemptRepository(prisma);

    await repo.registrar({
      usuarioId: "usr-1",
      emailUsado: "ana@example.com",
      exitoso: false,
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
      riskScore: 10,
      riskReason: "prueba",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        usuarioId: "usr-1",
        emailUsado: "ana@example.com",
        exitoso: false,
        ipAddress: "1.2.3.4",
        userAgent: "vitest",
        riskScore: 10,
        riskReason: "prueba",
      },
    });
  });

  it("cuenta fallos consecutivos hasta el primer exito dentro de la ventana", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { exitoso: false },
      { exitoso: false },
      { exitoso: true },
      { exitoso: false },
    ]);
    const prisma = { loginAttempt: { findMany } } as unknown as MockedPrisma;
    const repo = new LoginAttemptRepository(prisma);

    const fallos = await repo.contarFallosConsecutivosRecientes({
      usuarioId: "usr-1",
      ventanaMinutos: 15,
    });

    expect(fallos).toBe(2);
  });

  it("usa la ventana de tiempo configurable al consultar", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { loginAttempt: { findMany } } as unknown as MockedPrisma;
    const repo = new LoginAttemptRepository(prisma);

    await repo.contarFallosConsecutivosRecientes({ usuarioId: "usr-1", ventanaMinutos: 30 });

    const args = findMany.mock.calls[0][0];
    expect(args.where.usuarioId).toBe("usr-1");
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("ipReconocida es true si hubo al menos un intento exitoso desde esa IP", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const prisma = { loginAttempt: { count } } as unknown as MockedPrisma;
    const repo = new LoginAttemptRepository(prisma);

    await expect(repo.ipReconocida({ usuarioId: "usr-1", ipAddress: "1.2.3.4" })).resolves.toBe(true);
  });

  it("ipReconocida es false si no hubo intentos exitosos desde esa IP", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { loginAttempt: { count } } as unknown as MockedPrisma;
    const repo = new LoginAttemptRepository(prisma);

    await expect(repo.ipReconocida({ usuarioId: "usr-1", ipAddress: "9.9.9.9" })).resolves.toBe(false);
  });
});
