import { describe, it, expect, vi } from "vitest";
import { generateStrongPassword } from "@/lib/utils/password-generator";
import { strongPasswordSchema } from "@/lib/types/password-policy";

describe("generateStrongPassword (R32/R34)", () => {
  it("genera contrasena que pasa strongPasswordSchema en N iteraciones (R32)", () => {
    for (let i = 0; i < 500; i++) {
      const pwd = generateStrongPassword();
      expect(strongPasswordSchema.safeParse(pwd).success).toBe(true);
    }
  });

  it("genera valores distintos en llamadas sucesivas", () => {
    const values = new Set<string>();
    for (let i = 0; i < 100; i++) values.add(generateStrongPassword());
    // Colisiones practicamente imposibles con 16 chars cripto-aleatorios.
    expect(values.size).toBe(100);
  });

  it("no expone/loguea el valor generado (R34)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const pwd = generateStrongPassword();

    for (const spy of [logSpy, errSpy, warnSpy, infoSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.join(" ")).not.toContain(pwd);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
