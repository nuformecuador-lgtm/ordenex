import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests de `middleware.ts` (feature 78, endurecido despues). Importa el
 * middleware REAL: reimplementar la logica aqui no verificaria nada.
 *
 * Se mockea SOLO `isSessionActive` — la frontera con la DB. Asi el test cubre lo
 * que es del middleware (que rutas pasan, a donde redirige, si limpia la cookie)
 * sin levantar Postgres. La validez de una sesion en si es responsabilidad de
 * `session-guard` / `SessionRepository` y se prueba en su propio nivel.
 *
 * Contrato que se fija:
 * - ruta publica sin cookie -> `next()` (200), sin `location`.
 * - ruta con auth propia (cron / api-key) -> `next()` SIEMPRE, incluso sin cookie.
 * - ruta privada sin cookie -> 307 a `/login?redirect=<pathname>`.
 * - ruta privada con cookie INVALIDA -> 307 a login + `Set-Cookie` que la borra.
 * - ruta privada con cookie VALIDA -> `next()` (200).
 * - `/paquete/*` sin sesion -> 307 a `/` (no a `/login`).
 */

const isSessionActive = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-guard", () => ({ isSessionActive }));

const { middleware } = await import("@/middleware");

const BASE_URL = "https://app.test";

function buildRequest(pathname: string, session?: string): NextRequest {
  const request = new NextRequest(new URL(pathname, BASE_URL));
  if (session) request.cookies.set("session", session);
  return request;
}

beforeEach(() => {
  isSessionActive.mockReset();
  isSessionActive.mockResolvedValue(false);
});

describe("middleware — rutas publicas", () => {
  it.each([
    "/login",
    "/api/health",
    "/recuperar-contrasena",
    "/postulacion",
  ])("deja pasar %s sin cookie de sesion", async (ruta) => {
    const res = await middleware(buildRequest(ruta));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    // No se consulta la DB para una ruta publica.
    expect(isSessionActive).not.toHaveBeenCalled();
  });
});

describe("middleware — endpoints con autenticacion propia", () => {
  // REGRESION: estas rutas se autentican por `Authorization: Bearer ...` dentro
  // del handler. Cuando el middleware las trataba como privadas, respondia 307 a
  // /login y el handler NUNCA corria: los crons de Vercel y el canal de carga
  // por API key quedaban silenciosamente muertos.
  it.each([
    "/api/cron/corte-diario",
    "/api/cron/procesar-jobs",
    "/api/ordenes/api-key/carga",
  ])("deja pasar %s sin cookie (su auth vive en el handler)", async (ruta) => {
    const res = await middleware(buildRequest(ruta));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(isSessionActive).not.toHaveBeenCalled();
  });
});

describe("middleware — guard de sesion en rutas privadas", () => {
  it("redirige a /login con ?redirect= cuando no hay cookie", async () => {
    const res = await middleware(buildRequest("/ordenes"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.test/login?redirect=%2Fordenes",
    );
    // Sin cookie no hay nada que validar contra la DB.
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it("deja pasar cuando la sesion es valida", async () => {
    isSessionActive.mockResolvedValue(true);

    const res = await middleware(buildRequest("/ordenes", "sesion-valida"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(isSessionActive).toHaveBeenCalledWith("sesion-valida");
  });

  // El corazon del endurecimiento: antes bastaba con que la cookie EXISTIERA.
  it("rechaza una cookie que no corresponde a una sesion activa", async () => {
    isSessionActive.mockResolvedValue(false);

    const res = await middleware(buildRequest("/ordenes", "cookie-inventada"));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
    expect(isSessionActive).toHaveBeenCalledWith("cookie-inventada");
  });

  it("borra la cookie invalida al rechazarla", async () => {
    isSessionActive.mockResolvedValue(false);

    const res = await middleware(buildRequest("/ordenes", "cookie-inventada"));

    expect(res.cookies.get("session")?.value).toBe("");
  });
});

describe("middleware — /paquete/[numGuia]", () => {
  it("redirige a / (no a /login) cuando no hay sesion activa", async () => {
    const res = await middleware(buildRequest("/paquete/ABC123"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/");
  });

  it("deja pasar cuando la sesion es valida", async () => {
    isSessionActive.mockResolvedValue(true);

    const res = await middleware(buildRequest("/paquete/ABC123", "sesion-valida"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
