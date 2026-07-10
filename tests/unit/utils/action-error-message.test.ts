import { describe, it, expect } from "vitest";
import { messageFromActionError } from "@/lib/utils/action-error-message";
import { MSG } from "@/lib/errors/codes";
import type { ActionError } from "@/lib/types/orden";

describe("messageFromActionError (R21)", () => {
  it("mapea cada status de ActionError a su mensaje canónico en español (R21)", () => {
    const cases: Array<[ActionError, string]> = [
      [{ status: "unauthenticated" }, MSG.UNAUTHORIZED],
      [{ status: "forbidden" }, MSG.FORBIDDEN],
      [{ status: "not_found" }, MSG.NOT_FOUND],
      [{ status: "conflict" }, MSG.CONFLICT],
      [{ status: "validation_error", fieldErrors: {} }, MSG.VALIDATION_ERROR],
    ];
    for (const [err, expected] of cases) {
      expect(messageFromActionError(err)).toBe(expected);
    }
  });

  it("validation_error devuelve el mensaje genérico (no aplana fieldErrors) (R21 / [RESUELTO-B])", () => {
    const err: ActionError = {
      status: "validation_error",
      fieldErrors: { peso: ["El peso debe ser mayor que 0."] },
    };
    const msg = messageFromActionError(err);
    expect(msg).toBe(MSG.VALIDATION_ERROR);
    expect(msg).not.toContain("peso");
    expect(msg).not.toContain("El peso debe ser mayor que 0.");
  });
});
