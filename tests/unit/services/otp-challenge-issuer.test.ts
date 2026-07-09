import { describe, it, expect, vi } from "vitest";
import { OtpChallengeIssuer } from "@/lib/services/OtpChallengeIssuer";
import type { IEmailOtpChallengeRepository } from "@/lib/interfaces/repositories/IEmailOtpChallengeRepository";
import type { IEmailProvider } from "@/lib/interfaces/external/IEmailProvider";

describe("OtpChallengeIssuer", () => {
  it("nunca persiste el codigo en claro, solo codeHash", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "otp-1",
      usuarioId: "usr-1",
      codeHash: "irrelevante-para-el-assert",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
      createdAt: new Date(),
    });
    const otpRepo: IEmailOtpChallengeRepository = {
      create,
      findActiveById: vi.fn(),
      markConsumed: vi.fn(),
    };
    const emailProvider: IEmailProvider = { sendOtpCode: vi.fn() };
    const issuer = new OtpChallengeIssuer(otpRepo, emailProvider);

    await issuer.emitir({
      usuarioId: "usr-1",
      email: "ana@example.com",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });

    const dataPersistida = create.mock.calls[0][0];
    expect(dataPersistida).not.toHaveProperty("code");
    expect(typeof dataPersistida.codeHash).toBe("string");
    expect(dataPersistida.codeHash.length).toBeGreaterThan(0);
  });

  it("invoca al proveedor de email con el codigo en claro para el envio", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "otp-1",
      usuarioId: "usr-1",
      codeHash: "hash",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    });
    const sendOtpCode = vi.fn().mockResolvedValue(undefined);
    const otpRepo: IEmailOtpChallengeRepository = {
      create,
      findActiveById: vi.fn(),
      markConsumed: vi.fn(),
    };
    const emailProvider: IEmailProvider = { sendOtpCode };
    const issuer = new OtpChallengeIssuer(otpRepo, emailProvider);

    const result = await issuer.emitir({
      usuarioId: "usr-1",
      email: "ana@example.com",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });

    expect(sendOtpCode).toHaveBeenCalledTimes(1);
    const callArgs = sendOtpCode.mock.calls[0][0];
    expect(callArgs.to).toBe("ana@example.com");
    expect(typeof callArgs.code).toBe("string");
    expect(callArgs.code).toMatch(/^\d{6}$/);
    expect(result.challengeId).toBe("otp-1");
  });
});
