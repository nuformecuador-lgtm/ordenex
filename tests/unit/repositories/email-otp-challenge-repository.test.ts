import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { EmailOtpChallengeRepository } from "@/lib/repositories/EmailOtpChallengeRepository";

type MockedPrisma = Pick<PrismaClient, "emailOtpChallenge">;

function buildChallenge(overrides: Partial<{ consumedAt: Date | null; expiresAt: Date }> = {}) {
  return {
    id: "otp-1",
    usuarioId: "usr-1",
    codeHash: "hash-codigo",
    deviceHash: "hash-device",
    ipAddress: "1.2.3.4",
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    consumedAt: overrides.consumedAt ?? null,
    createdAt: new Date(),
  };
}

describe("EmailOtpChallengeRepository", () => {
  it("crea un challenge con codeHash (nunca el codigo en claro)", async () => {
    const create = vi.fn().mockResolvedValue(buildChallenge());
    const prisma = { emailOtpChallenge: { create } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    await repo.create({
      usuarioId: "usr-1",
      codeHash: "hash-codigo",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const dataArg = create.mock.calls[0][0].data;
    expect(dataArg.codeHash).toBe("hash-codigo");
    expect(dataArg).not.toHaveProperty("code");
  });

  it("findActiveById devuelve el challenge si no esta consumido ni expirado", async () => {
    const findUnique = vi.fn().mockResolvedValue(buildChallenge());
    const prisma = { emailOtpChallenge: { findUnique } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    const challenge = await repo.findActiveById("otp-1");
    expect(challenge?.id).toBe("otp-1");
  });

  it("findActiveById devuelve null si ya fue consumido", async () => {
    const findUnique = vi.fn().mockResolvedValue(buildChallenge({ consumedAt: new Date() }));
    const prisma = { emailOtpChallenge: { findUnique } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    await expect(repo.findActiveById("otp-1")).resolves.toBeNull();
  });

  it("findActiveById devuelve null si ya expiro (R20)", async () => {
    const findUnique = vi.fn().mockResolvedValue(
      buildChallenge({ expiresAt: new Date(Date.now() - 60_000) }),
    );
    const prisma = { emailOtpChallenge: { findUnique } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    await expect(repo.findActiveById("otp-1")).resolves.toBeNull();
  });

  it("markConsumed marca consumedAt", async () => {
    const update = vi.fn().mockResolvedValue(buildChallenge({ consumedAt: new Date() }));
    const prisma = { emailOtpChallenge: { update } } as unknown as MockedPrisma;
    const repo = new EmailOtpChallengeRepository(prisma);

    await repo.markConsumed("otp-1");

    expect(update).toHaveBeenCalledWith({
      where: { id: "otp-1" },
      data: { consumedAt: expect.any(Date) },
    });
  });
});
