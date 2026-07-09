import { describe, it, expect } from "vitest";
import {
  AppError,
  ValidationError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "@/lib/errors/app-error";
import { MSG } from "@/lib/errors/codes";

describe("app-error — AppError y subclases (R5, R6)", () => {
  it("AppError expone code y message (R5)", () => {
    const err = new AppError("FORBIDDEN", "sin permiso");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("sin permiso");
  });

  it("AppError.toShape preserva code, message y details (R6)", () => {
    const details = { fieldErrors: { x: ["req"] } };
    const shape = new AppError("VALIDATION_ERROR", "invalido", details).toShape();
    expect(shape).toEqual({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "invalido",
      details,
    });
  });

  it("toShape omite details cuando no se proveen (R6)", () => {
    const shape = new AppError("NOT_FOUND", "no existe").toShape();
    expect(shape).toEqual({ status: "error", code: "NOT_FOUND", message: "no existe" });
    expect("details" in shape).toBe(false);
  });

  it("cada subclase fija su code y un message por defecto de MSG (R5/R6)", () => {
    expect(new ValidationError().code).toBe("VALIDATION_ERROR");
    expect(new ValidationError().message).toBe(MSG.VALIDATION_ERROR);
    expect(new UnauthenticatedError().code).toBe("UNAUTHORIZED");
    expect(new UnauthenticatedError().message).toBe(MSG.UNAUTHORIZED);
    expect(new ForbiddenError().code).toBe("FORBIDDEN");
    expect(new NotFoundError().code).toBe("NOT_FOUND");
    expect(new ConflictError().code).toBe("CONFLICT");
    // Todas siguen siendo AppError (para el instanceof de normalizeError).
    expect(new ConflictError()).toBeInstanceOf(AppError);
  });
});
