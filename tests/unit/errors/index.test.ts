import { describe, it, expect } from "vitest";
import * as errors from "@/lib/errors";
import {
  withErrorHandler,
  AppError,
  normalizeError,
  appErrorToResponse,
  isAppErrorShape,
  ConsoleErrorLogger,
  defaultLogger,
  HTTP_STATUS_BY_CODE,
  MSG,
  CODE_BY_DOMAIN_STATUS,
} from "@/lib/errors";

describe("index — barrel de la API publica (R17)", () => {
  it("la API publica se importa desde @/lib/errors", () => {
    expect(typeof withErrorHandler).toBe("function");
    expect(typeof normalizeError).toBe("function");
    expect(typeof appErrorToResponse).toBe("function");
    expect(typeof isAppErrorShape).toBe("function");
    expect(typeof AppError).toBe("function");
    expect(typeof ConsoleErrorLogger).toBe("function");
    expect(defaultLogger).toBeInstanceOf(ConsoleErrorLogger);
  });

  it("reexporta las constantes y subclases publicas (R17)", () => {
    expect(HTTP_STATUS_BY_CODE.INTERNAL).toBe(500);
    expect(MSG.INTERNAL).toBe("Error interno del servidor.");
    expect(CODE_BY_DOMAIN_STATUS.conflict).toBe("CONFLICT");
    for (const name of [
      "ValidationError",
      "UnauthenticatedError",
      "ForbiddenError",
      "NotFoundError",
      "ConflictError",
    ]) {
      expect(typeof (errors as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
