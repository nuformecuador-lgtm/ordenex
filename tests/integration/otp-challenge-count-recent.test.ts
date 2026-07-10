import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EmailOtpChallengeRepository } from "@/lib/repositories/EmailOtpChallengeRepository";

// Feature 20 / R19: contarRecientesPorUsuario cuenta por createdAt en la ventana.

type MockedPrisma = Pick<PrismaClient, "emailOtpChallenge">;

describe("EmailOtpChallengeRepository.contarRecientesPorUsuario (R19)", () => {
  it("cuenta solo los desafios dentro de la ventana", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const prisma = { emailOtpChallenge: { count } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    const total = await repo.contarRecientesPorUsuario("usr-1", 15);

    expect(total).toBe(2);
    const arg = count.mock.calls[0][0];
    expect(arg.where.usuarioId).toBe("usr-1");
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("aplica una ventana que ignora los mas antiguos (createdAt >= ahora - ventana)", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { emailOtpChallenge: { count } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    const antes = Date.now();
    await repo.contarRecientesPorUsuario("usr-1", 10);
    const despues = Date.now();

    const desde = count.mock.calls[0][0].where.createdAt.gte as Date;
    // El corte debe estar ~10 min atras respecto al instante de la llamada.
    expect(desde.getTime()).toBeGreaterThanOrEqual(antes - 10 * 60_000 - 5);
    expect(desde.getTime()).toBeLessThanOrEqual(despues - 10 * 60_000 + 5);
  });
});
