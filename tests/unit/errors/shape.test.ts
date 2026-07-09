import { describe, it, expect } from "vitest";
import { isAppErrorShape, type AppErrorShape } from "@/lib/errors/shape";

describe("shape — AppErrorShape e isAppErrorShape (R1, R4)", () => {
  it("AppErrorShape tiene status error, code, message y details opcional (R1)", () => {
    const conDetails: AppErrorShape = {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Los datos enviados no son validos.",
      details: { fieldErrors: { nombre: ["requerido"] } },
    };
    const sinDetails: AppErrorShape = {
      status: "error",
      code: "INTERNAL",
      message: "Error interno del servidor.",
    };
    expect(conDetails.status).toBe("error");
    expect(conDetails.code).toBe("VALIDATION_ERROR");
    expect(conDetails.details).toEqual({ fieldErrors: { nombre: ["requerido"] } });
    expect(sinDetails.details).toBeUndefined();
  });

  it("status error convive con status ok en union discriminada (R4)", () => {
    const ok = { status: "ok", data: 1 } as const;
    const err: AppErrorShape = { status: "error", code: "NOT_FOUND", message: "x" };
    const union: typeof ok | AppErrorShape = err;
    // Discriminacion por `status`: solo el error pasa el guard.
    expect(isAppErrorShape(ok)).toBe(false);
    expect(isAppErrorShape(union)).toBe(true);
    if (isAppErrorShape(union)) {
      expect(union.code).toBe("NOT_FOUND");
    }
  });

  it("isAppErrorShape rechaza valores que no son la shape (R1/R4)", () => {
    expect(isAppErrorShape(null)).toBe(false);
    expect(isAppErrorShape(undefined)).toBe(false);
    expect(isAppErrorShape("error")).toBe(false);
    expect(isAppErrorShape({ status: "error" })).toBe(false); // falta code/message
    expect(isAppErrorShape({ status: "error", code: "NOPE", message: "x" })).toBe(false); // code invalido
    expect(isAppErrorShape({ status: "validation_error", code: "CONFLICT", message: "x" })).toBe(false);
  });
});
