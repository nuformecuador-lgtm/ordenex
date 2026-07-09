import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { normalizeError } from "@/lib/errors/normalize";
import { AppError, ConflictError } from "@/lib/errors/app-error";
import { MSG } from "@/lib/errors/codes";
import type { ErrorLogger } from "@/lib/errors/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeLogger() {
  return { logError: vi.fn<(err: unknown) => void>() } satisfies ErrorLogger;
}

// Errores de dominio conocidos: se identifican por `err.name` (no se importan las clases).
class NumRemisionDuplicadoError extends Error {
  constructor() {
    super("num remision duplicada");
    this.name = "NumRemisionDuplicadoError";
  }
}
class CatalogoInvalidoError extends Error {
  constructor() {
    super("catalogo invalido");
    this.name = "CatalogoInvalidoError";
  }
}

describe("normalizeError (R9-R14)", () => {
  it("mapea una instancia de AppError a su shape (R9)", () => {
    const err = new ConflictError("ya existe", { id: "1" });
    const shape = normalizeError(err, fakeLogger());
    expect(shape).toEqual({
      status: "error",
      code: "CONFLICT",
      message: "ya existe",
      details: { id: "1" },
    });
  });

  it("mapea NumRemisionDuplicadoError a CONFLICT y CatalogoInvalidoError a VALIDATION_ERROR (R10)", () => {
    const logger = fakeLogger();
    const conflict = normalizeError(new NumRemisionDuplicadoError(), logger);
    expect(conflict).toEqual({ status: "error", code: "CONFLICT", message: MSG.CONFLICT });

    const validation = normalizeError(new CatalogoInvalidoError(), logger);
    expect(validation).toEqual({
      status: "error",
      code: "VALIDATION_ERROR",
      message: MSG.VALIDATION_ERROR,
    });
    // Errores de dominio conocidos NO se loguean como internos.
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("mapea ZodError a VALIDATION_ERROR con fieldErrors en details (R11)", () => {
    const schema = z.object({ nombre: z.string(), edad: z.number() });
    const parsed = schema.safeParse({ nombre: 1, edad: "x" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const shape = normalizeError(parsed.error, fakeLogger());
    expect(shape.code).toBe("VALIDATION_ERROR");
    expect(shape.message).toBe(MSG.VALIDATION_ERROR);
    const fieldErrors = (shape.details as { fieldErrors: Record<string, string[]> }).fieldErrors;
    expect(fieldErrors).toHaveProperty("nombre");
    expect(fieldErrors).toHaveProperty("edad");
  });

  it("mapea error desconocido a INTERNAL con message generico (R12)", () => {
    const shape = normalizeError(new Error("cualquier cosa"), fakeLogger());
    expect(shape).toEqual({ status: "error", code: "INTERNAL", message: MSG.INTERNAL });
  });

  it("un error INTERNAL no expone el message ni el stack originales (R13)", () => {
    const secreto = "secreto-DB://user:pass@host";
    const err = new Error(secreto);
    const shape = normalizeError(err, fakeLogger());
    const serialized = JSON.stringify(shape);
    expect(serialized).not.toContain("secreto");
    expect(serialized).not.toContain(secreto);
    expect(shape.message).toBe(MSG.INTERNAL);
    expect("details" in shape).toBe(false);
    expect((shape as unknown as Record<string, unknown>).stack).toBeUndefined();
  });

  it("registra el error interno por el canal de servidor con el error original (R14)", () => {
    const logger = fakeLogger();
    const original = new Error("fallo interno");
    normalizeError(original, logger);
    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError).toHaveBeenCalledWith(original);
  });

  it("usa el ErrorLogger inyectado en vez del default (R14a)", () => {
    const injected = fakeLogger();
    const spyConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    normalizeError(new Error("x"), injected);
    expect(injected.logError).toHaveBeenCalledTimes(1);
    // El default (console.error) no debe usarse cuando se inyecta otro logger.
    expect(spyConsole).not.toHaveBeenCalled();
  });

  it("sin logger inyectado usa el default (ConsoleErrorLogger -> console.error) (R14b)", () => {
    const spyConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    normalizeError(new Error("x"));
    expect(spyConsole).toHaveBeenCalledTimes(1);
  });

  it("no loguea como interno los errores reconocidos AppError/dominio/Zod (R20)", () => {
    const logger = fakeLogger();
    const zodResult = z.string().safeParse(1);
    expect(zodResult.success).toBe(false);
    if (zodResult.success) return;

    normalizeError(new AppError("FORBIDDEN", "no"), logger);
    normalizeError(new NumRemisionDuplicadoError(), logger);
    normalizeError(zodResult.error, logger);
    expect(logger.logError).not.toHaveBeenCalled();
  });
});
