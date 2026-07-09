import { describe, it, expect, vi, afterEach } from "vitest";
import { ConsoleErrorLogger, defaultLogger, type ErrorLogger } from "@/lib/errors/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger — ConsoleErrorLogger y defaultLogger (R14b)", () => {
  it("ConsoleErrorLogger registra por console.error (R14b)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleErrorLogger();
    const err = new Error("boom");
    logger.logError(err);
    expect(spy).toHaveBeenCalledTimes(1);
    // Registra el stack/mensaje del error original para diagnostico server-side.
    expect(spy.mock.calls[0][0]).toBe("[AppError:INTERNAL]");
  });

  it("defaultLogger es un ConsoleErrorLogger que implementa ErrorLogger (R14b)", () => {
    const logger: ErrorLogger = defaultLogger;
    expect(logger).toBeInstanceOf(ConsoleErrorLogger);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.logError("valor-no-error");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
