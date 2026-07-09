import { describe, it, expect, vi } from "vitest";
import { RiskEngine } from "@/lib/services/RiskEngine";
import type { ILoginAttemptRepository } from "@/lib/interfaces/repositories/ILoginAttemptRepository";
import type { ITrustedDeviceRepository } from "@/lib/interfaces/repositories/ITrustedDeviceRepository";

function buildRepos(overrides: {
  dispositivoReconocido?: boolean;
  ipReconocida?: boolean;
  fallosRecientes?: number;
}) {
  const loginAttemptRepo: ILoginAttemptRepository = {
    registrar: vi.fn(),
    contarFallosConsecutivosRecientes: vi.fn().mockResolvedValue(overrides.fallosRecientes ?? 0),
    ipReconocida: vi.fn().mockResolvedValue(overrides.ipReconocida ?? true),
  };
  const trustedDeviceRepo: ITrustedDeviceRepository = {
    findByUsuarioAndDevice: vi
      .fn()
      .mockResolvedValue(overrides.dispositivoReconocido === false ? null : { id: "td-1" }),
    upsert: vi.fn(),
  };
  return { loginAttemptRepo, trustedDeviceRepo };
}

describe("RiskEngine", () => {
  it("score bajo cuando dispositivo e IP son reconocidos y sin fallos (R15, R16)", async () => {
    const { loginAttemptRepo, trustedDeviceRepo } = buildRepos({
      dispositivoReconocido: true,
      ipReconocida: true,
      fallosRecientes: 0,
    });
    const engine = new RiskEngine(loginAttemptRepo, trustedDeviceRepo, 50, 15);

    const result = await engine.evaluate({
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });

    expect(result.score).toBe(0);
    expect(result.isHigh).toBe(false);
  });

  it("score alto cuando el dispositivo es nuevo (R15, R17)", async () => {
    const { loginAttemptRepo, trustedDeviceRepo } = buildRepos({
      dispositivoReconocido: false,
      ipReconocida: true,
      fallosRecientes: 0,
    });
    const engine = new RiskEngine(loginAttemptRepo, trustedDeviceRepo, 30, 15);

    const result = await engine.evaluate({
      usuarioId: "usr-1",
      deviceHash: "hash-device-nuevo",
      ipAddress: "1.2.3.4",
    });

    expect(result.isHigh).toBe(true);
    expect(result.reasons).toContain("dispositivo_no_reconocido");
  });

  it("score alto cuando los fallos recientes superan el umbral (R15, R17)", async () => {
    const { loginAttemptRepo, trustedDeviceRepo } = buildRepos({
      dispositivoReconocido: true,
      ipReconocida: true,
      fallosRecientes: 3,
    });
    const engine = new RiskEngine(loginAttemptRepo, trustedDeviceRepo, 30, 15);

    const result = await engine.evaluate({
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });

    expect(result.isHigh).toBe(true);
    expect(result.reasons.some((r) => r.startsWith("fallos_recientes"))).toBe(true);
  });

  it("el umbral se lee de configuracion, no hardcodeado", async () => {
    const { loginAttemptRepo, trustedDeviceRepo } = buildRepos({
      dispositivoReconocido: false,
      ipReconocida: true,
      fallosRecientes: 0,
    });
    // Con un umbral muy alto, el mismo score de "dispositivo nuevo" ya no es alto.
    const engineUmbralAlto = new RiskEngine(loginAttemptRepo, trustedDeviceRepo, 999, 15);
    const result = await engineUmbralAlto.evaluate({
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });
    expect(result.isHigh).toBe(false);
  });
});
