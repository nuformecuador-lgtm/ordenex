import { describe, it, expect } from "vitest";
import { appErrorToResponse } from "@/lib/errors/http";
import { HTTP_STATUS_BY_CODE } from "@/lib/errors/codes";
import type { AppErrorShape } from "@/lib/errors/shape";

describe("appErrorToResponse (R18)", () => {
  it("devuelve NextResponse con el status HTTP del code y body igual al shape", async () => {
    const shape: AppErrorShape = {
      status: "error",
      code: "NOT_FOUND",
      message: "El recurso solicitado no existe.",
    };
    const res = appErrorToResponse(shape);
    expect(res.status).toBe(HTTP_STATUS_BY_CODE.NOT_FOUND);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual(shape);
  });

  it("deriva el status de cada code desde HTTP_STATUS_BY_CODE (R18/R3)", async () => {
    const conflict = appErrorToResponse({ status: "error", code: "CONFLICT", message: "x" });
    expect(conflict.status).toBe(409);
    const internal = appErrorToResponse({ status: "error", code: "INTERNAL", message: "x" });
    expect(internal.status).toBe(500);
    const validation = appErrorToResponse({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "x",
      details: { fieldErrors: { a: ["b"] } },
    });
    expect(validation.status).toBe(422);
    expect(await validation.json()).toHaveProperty("details.fieldErrors.a");
  });
});
