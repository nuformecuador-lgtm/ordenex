// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getRedirectTarget } from "@/app/login/_components/LoginForm";

// Destino post-login/OTP (feature 86, R14/R15). Por defecto es `/dashboard`
// (la home autenticada se movió de `/` a `/dashboard`); la guarda open-redirect
// del parámetro `redirect` se conserva intacta.
describe("getRedirectTarget — destino de redirección tras login (R14, R15)", () => {
  it("R14: sin parámetro cae al destino por defecto /dashboard", () => {
    expect(getRedirectTarget(null)).toBe("/dashboard");
  });

  it("R15: `//evil` (protocol-relative) se descarta → /dashboard", () => {
    expect(getRedirectTarget("//evil")).toBe("/dashboard");
  });

  it("R15: `http://x` (absoluta externa) se descarta → /dashboard", () => {
    expect(getRedirectTarget("http://x")).toBe("/dashboard");
  });

  it("R15: un path interno válido se respeta (/ordenes → /ordenes)", () => {
    expect(getRedirectTarget("/ordenes")).toBe("/ordenes");
  });
});
