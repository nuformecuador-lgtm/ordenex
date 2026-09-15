import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

// Feature 311 — F5.T (R26). La ruta de media DEBE quedar detras del guard de sesion: es PII del
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
  // FEATURE 426 — CASO INVERTIDO. LO QUE R26 PROTEGIA SE CONSERVA INTACTO: la media del cliente
  // sigue DETRAS del guard de sesion, una peticion sin cookie NO la alcanza, y la ruta no entro en
  // ninguna lista de excepcion (eso lo siguen midiendo los dos casos de mas abajo, sin tocar).
  // Lo unico que cambia es la FORMA del rechazo: el 307 a /login hacia que el `fetch` de
  // `useMediaChat` siguiera el redirect, recibiera el HTML del login con 200 y pintara la burbuja
  // como "listo" con una imagen rota; el 401 cae en `!res.ok` y deja el estado en "error".
  it("GET sin cookie de sesion se rechaza con 401 JSON (ya no redirige a /login)", async () => {
    const res = await middleware(new NextRequest(new URL(RUTA, BASE_URL), { method: "GET" }));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("location")).toBeNull();
    expect(((await res.json()) as { code?: string }).code).toBe("UNAUTHORIZED");
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
