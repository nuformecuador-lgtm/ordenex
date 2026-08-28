import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

// Feature 308 — F5.T (R26). La ruta de media DEBE quedar detras del guard de sesion: es PII del
// cliente. Molde de `webhook-whatsapp-middleware.test.ts`, pero al reves: alli se comprobaba que
// el webhook SI se salta el guard; aqui que el proxy NO se lo salta.
//
// Y hay una segunda razon para que este test exista: si alguien "arregla" un 307 añadiendo
// `/api/chat` a `PUBLIC_ROUTES`, ademas de abrir la media al mundo pondria roja la guardia de la
// feature 229 (que compara esa lista posicionalmente contra una lista firmada). Este test lo
// detiene antes.

const isSessionActive = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-guard", () => ({ isSessionActive }));

const { middleware } = await import("@/middleware");

const BASE_URL = "https://app.test";
const RUTA = "/api/chat/media/11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  isSessionActive.mockReset();
  isSessionActive.mockResolvedValue(false);
});

describe("middleware — proxy de media del chat (R26)", () => {
  it("GET sin cookie de sesion redirige (307) a /login", async () => {
    const res = await middleware(new NextRequest(new URL(RUTA, BASE_URL), { method: "GET" }));

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location as string).pathname).toBe("/login");
  });

  it("con cookie valida el middleware la deja pasar (la autorizacion real va en el handler)", async () => {
    isSessionActive.mockResolvedValue(true);
    const req = new NextRequest(new URL(RUTA, BASE_URL), { method: "GET" });
    req.cookies.set("session", "sess-1");

    const res = await middleware(req);
    expect(res.status).toBe(200); // next()
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — la ruta NO se añadio a las listas de excepcion (R26)", () => {
  const fuente = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "middleware.ts"),
    "utf8",
  );

  function lista(nombre: string): string[] {
    const bloque = fuente.match(new RegExp(`const ${nombre} = \\[([\\s\\S]*?)\\];`));
    expect(bloque).not.toBeNull();
    return [...(bloque as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("PUBLIC_ROUTES no contiene ninguna entrada que cubra /api/chat", () => {
    for (const ruta of lista("PUBLIC_ROUTES")) {
      expect(RUTA === ruta || RUTA.startsWith(`${ruta}/`)).toBe(false);
    }
  });

  it("SELF_AUTH_ROUTES tampoco", () => {
    for (const ruta of lista("SELF_AUTH_ROUTES")) {
      expect(RUTA === ruta || RUTA.startsWith(`${ruta}/`)).toBe(false);
    }
  });
});
