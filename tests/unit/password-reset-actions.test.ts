import { describe, it, expect, vi } from "vitest";
import {
  solicitarRecuperacion,
  verificarCodigoRecuperacion,
  restablecerContrasena,
} from "@/lib/actions/password-reset";
import type { IPasswordResetService } from "@/lib/interfaces/services/IPasswordResetService";

// Feature 20 / R1, R6, R7, R8, R11, R12, R15, R19, R20.

const CTX = { ipAddress: "1.2.3.4", userAgent: "vitest-agent" };

function buildService(overrides: Partial<IPasswordResetService> = {}): IPasswordResetService {
  return {
    solicitar: vi.fn().mockResolvedValue({ status: "ok" }),
    verificarCodigo: vi.fn().mockResolvedValue({ status: "ok" }),
    restablecer: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides,
  };
}

describe("Server Action solicitarRecuperacion", () => {
  it("R1/R12: devuelve ok generico exista o no el email", async () => {
    const service = buildService();
    const result = await solicitarRecuperacion(
      { email: "ana@example.com" },
      { service, getContext: async () => CTX },
    );
    expect(result).toEqual({ status: "ok" });
    expect(service.solicitar).toHaveBeenCalledTimes(1);
  });

  it("rechaza email invalido con validation_error sin llamar al servicio", async () => {
    const service = buildService();
    const result = await solicitarRecuperacion(
      { email: "no-es-email" },
      { service, getContext: async () => CTX },
    );
    expect(result.status).toBe("validation_error");
    expect(service.solicitar).not.toHaveBeenCalled();
  });
});

describe("Server Action verificarCodigoRecuperacion", () => {
  it("R6: propaga invalid_or_expired del servicio", async () => {
    const service = buildService({
      verificarCodigo: vi.fn().mockResolvedValue({ status: "invalid_or_expired" }),
    });
    const result = await verificarCodigoRecuperacion(
      { email: "ana@example.com", code: "000000" },
      { service, getContext: async () => CTX },
    );
    expect(result).toEqual({ status: "invalid_or_expired" });
  });

  it("rechaza codigo con formato invalido sin llamar al servicio", async () => {
    const service = buildService();
    const result = await verificarCodigoRecuperacion(
      { email: "ana@example.com", code: "abc" },
      { service, getContext: async () => CTX },
    );
    expect(result.status).toBe("validation_error");
    expect(service.verificarCodigo).not.toHaveBeenCalled();
  });
});

describe("Server Action restablecerContrasena", () => {
  it("R7: confirmacion distinta devuelve validation_error sin llamar al servicio", async () => {
    const service = buildService();
    const result = await restablecerContrasena(
      {
        email: "ana@example.com",
        code: "123456",
        password: "Abcdef1!",
        confirmPassword: "Otra1234!",
      },
      { service, getContext: async () => CTX },
    );
    expect(result.status).toBe("validation_error");
    expect(service.restablecer).not.toHaveBeenCalled();
  });

  it("R8: password debil devuelve validation_error", async () => {
    const service = buildService();
    const result = await restablecerContrasena(
      {
        email: "ana@example.com",
        code: "123456",
        password: "debil",
        confirmPassword: "debil",
      },
      { service, getContext: async () => CTX },
    );
    expect(result.status).toBe("validation_error");
    expect(service.restablecer).not.toHaveBeenCalled();
  });

  it("R11: desafio inactivo devuelve invalid_or_expired", async () => {
    const service = buildService({
      restablecer: vi.fn().mockResolvedValue({ status: "invalid_or_expired" }),
    });
    const result = await restablecerContrasena(
      {
        email: "ana@example.com",
        code: "123456",
        password: "Abcdef1!",
        confirmPassword: "Abcdef1!",
      },
      { service, getContext: async () => CTX },
    );
    expect(result).toEqual({ status: "invalid_or_expired" });
    expect(service.restablecer).toHaveBeenCalledTimes(1);
  });
});
