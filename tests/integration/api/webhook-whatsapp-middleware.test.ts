import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Feature 109 — E3.T (R10). El webhook de WhatsApp NO usa cookie de sesion (su auth es la
// firma HMAC): DEBE quedar excluido del guard de sesion. El middleware es ASYNC, por eso se
// hace `await` de su resultado (a diferencia del baseline rojo de middleware.test.ts).

const isSessionActive = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-guard", () => ({ isSessionActive }));

const { middleware } = await import("@/middleware");

const BASE_URL = "https://app.test";

function buildRequest(pathname: string, method = "POST"): NextRequest {
  return new NextRequest(new URL(pathname, BASE_URL), { method });
}

beforeEach(() => {
  isSessionActive.mockReset();
  isSessionActive.mockResolvedValue(false);
});

describe("middleware — webhook de WhatsApp (R10)", () => {
  it("el POST del webhook NO redirige a /login y pasa sin cookie de sesion", async () => {
    const res = await middleware(buildRequest("/api/webhooks/whatsapp"));

    expect(res.status).toBe(200); // next(), no 307
    expect(res.headers.get("location")).toBeNull();
    // Ni siquiera se consulta la sesion en la DB: es self-auth (firma HMAC).
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it("el GET del handshake tampoco redirige a /login", async () => {
    const res = await middleware(buildRequest("/api/webhooks/whatsapp", "GET"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
