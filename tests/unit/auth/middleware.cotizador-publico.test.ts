import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Feature 248 — T4.4 / R1: `/cotizador` es una PAGINA PUBLICA.
 *
 * Mismo patron que `tests/unit/auth/middleware.test.ts`: se importa el middleware REAL y se
 * mockea SOLO `isSessionActive`, la frontera con la DB. Reimplementar aqui la logica de rutas
 * no verificaria nada; lo que se fija es el contrato observable:
 *
 *  - `/cotizador` sin cookie -> `next()` (200), sin `location` y SIN consultar la sesion;
 *  - `/cotizador/*` tambien, porque `PUBLIC_ROUTES` compara con `startsWith`;
 *  - lo que NO abre: `/cotizadores` u otra ruta privada sigue yendo a `/login`.
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

describe("R1 — la superficie publica del cotizador se sirve sin sesion", () => {
  it("sirve /cotizador sin cookie de sesión, sin redirigir a /login", async () => {
    const res = await middleware(buildRequest("/cotizador"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    // Una ruta publica no gasta un roundtrip a la base para comprobar una sesion que no hay.
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it("tambien sirve las subrutas de /cotizador sin cookie (PUBLIC_ROUTES compara con startsWith)", async () => {
    const res = await middleware(buildRequest("/cotizador/resultado"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it("con una cookie de sesion INVALIDA la sigue sirviendo, sin borrarla ni redirigir", async () => {
    // Es publica: la validez de la sesion no es asunto suyo. Si pasara por el guard, un usuario
    // con la cookie caducada veria un /login en vez del cotizador.
    const res = await middleware(buildRequest("/cotizador", "sesion-caducada"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it("CONTRAPRUEBA: la entrada nueva NO abre rutas vecinas ni la app entera", async () => {
    for (const ruta of ["/cotizadores", "/ordenes", "/dashboard"]) {
      const res = await middleware(buildRequest(ruta));

      expect(res.status, `${ruta} dejo de ser privada`).toBe(307);
      expect(res.headers.get("location")).toBe(
        `${BASE_URL}/login?redirect=${encodeURIComponent(ruta)}`,
      );
    }
  });
});
