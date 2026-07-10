import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EmailOtpChallengeRepository } from "@/lib/repositories/EmailOtpChallengeRepository";

// Feature 20 / R5, R13: findLatestActiveByUsuarioId.

type MockedPrisma = Pick<PrismaClient, "emailOtpChallenge">;

function buildChallenge() {
  return {
    id: "otp-1",
    usuarioId: "usr-1",
    codeHash: "hash",
    deviceHash: "dh",
    ipAddress: "1.2.3.4",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date(),
  };
}

describe("EmailOtpChallengeRepository.findLatestActiveByUsuarioId (R5/R13)", () => {
  it("devuelve el desafio activo mas reciente del usuario", async () => {
    const findFirst = vi.fn().mockResolvedValue(buildChallenge());
    const prisma = { emailOtpChallenge: { findFirst } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    const challenge = await repo.findLatestActiveByUsuarioId("usr-1");

    expect(challenge?.id).toBe("otp-1");
    const arg = findFirst.mock.calls[0][0];
    expect(arg.where.usuarioId).toBe("usr-1");
    expect(arg.where.consumedAt).toBeNull();
    expect(arg.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("devuelve null si no hay desafio activo (consumido o expirado)", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { emailOtpChallenge: { findFirst } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    await expect(repo.findLatestActiveByUsuarioId("usr-1")).resolves.toBeNull();
  });
});
