import { describe, it, expect, vi } from "vitest";
import { withErrorHandler } from "@/lib/errors/with-error-handler";
import { ConflictError } from "@/lib/errors/app-error";
import { isAppErrorShape } from "@/lib/errors/shape";
import { MSG } from "@/lib/errors/codes";
import type { ErrorLogger } from "@/lib/errors/logger";

function fakeLogger() {
  return { logError: vi.fn<(err: unknown) => void>() } satisfies ErrorLogger;
}

describe("withErrorHandler (R7, R8, R14a)", () => {
  it("devuelve el valor original cuando la operacion no lanza (R8)", async () => {
    const value = { status: "ok", data: [1, 2, 3] } as const;
    const result = await withErrorHandler(async () => value);
    // Paso transparente: misma referencia, sin envolver.
    expect(result).toBe(value);
  });

  it("devuelve AppErrorShape cuando la operacion lanza un AppError (R7/R9)", async () => {
    const result = await withErrorHandler(async () => {
      throw new ConflictError("ya existe");
    }, fakeLogger());
    expect(isAppErrorShape(result)).toBe(true);
    if (isAppErrorShape(result)) {
      expect(result.code).toBe("CONFLICT");
      expect(result.message).toBe("ya existe");
    }
  });

  it("normaliza un error inesperado a INTERNAL sin filtrar el message original (R7/R12/R13)", async () => {
    const result = await withErrorHandler(async () => {
      throw new Error("detalle-secreto");
    }, fakeLogger());
    expect(isAppErrorShape(result)).toBe(true);
    if (isAppErrorShape(result)) {
      expect(result.code).toBe("INTERNAL");
      expect(result.message).toBe(MSG.INTERNAL);
    }
    expect(JSON.stringify(result)).not.toContain("secreto");
  });

  it("propaga el ErrorLogger inyectado hasta normalizeError (R14a)", async () => {
    const logger = fakeLogger();
    const original = new Error("boom");
    await withErrorHandler(async () => {
      throw original;
    }, logger);
    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError).toHaveBeenCalledWith(original);
  });
});
