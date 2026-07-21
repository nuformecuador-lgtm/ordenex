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

  // REGRESION: las rutas de API autorizan por si mismas (Bearer con CRON_SECRET
  // o con una api key `ordx_`, o sesion resuelta dentro del handler). El guard de
  // cookie las redirigia (307) a /login, dejando los cuatro crons y la ingesta
  // por API key INALCANZABLES en produccion: Vercel Cron manda el header
  // Authorization pero NUNCA una cookie `session`.
  it.each([
    "/api/cron/procesar-jobs",
    "/api/cron/corte-diario",
    "/api/cron/generar-gastos-fijos",
    "/api/cron/liberar-reprogramadas",
    "/api/ordenes/api-key/carga",
    "/api/ordenes/carga-masiva/chunk",
  ])("deja pasar %s sin cookie de sesion (autoriza el handler)", (ruta) => {
    const res = middleware(buildRequest(ruta));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // --- Feature 86: landing publica en `/` + dashboard en /dashboard ---

  it("/ sin sesion deja pasar (landing publica, 200) (R1)", () => {
    const res = middleware(buildRequest("/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // La exclusion es de la rama /api entera, no de una lista de rutas conocidas:
  // una ruta de API nueva no debe nacer inalcanzable por olvidar registrarla.
  it("deja pasar una ruta de API que todavia no existe", () => {
    const res = middleware(buildRequest("/api/lo-que-sea/futuro"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // El guard de cookie SIGUE aplicando a las paginas: la exclusion es solo /api.
  it("sigue redirigiendo una pagina privada que empieza con 'api' en el nombre", () => {
    const res = middleware(buildRequest("/apitos"));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
  });

  it("/ con sesion redirige (307) a /dashboard (R7)", () => {
    const res = middleware(buildRequest("/", "cookie-de-sesion"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("/dashboard sin sesion redirige (307) a /login?redirect=%2Fdashboard (R10)", () => {
    const res = middleware(buildRequest("/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.test/login?redirect=%2Fdashboard",
    );
  });

  it("R8: una ruta con prefijo `/` arbitraria sin sesion NO se vuelve publica (sigue redirigiendo a /login)", () => {
    const res = middleware(buildRequest("/xyz"));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe(
      "/login",
    );
  });

  it("R16 (regresion): /ordenes sin cookie -> 307 a /login; con cookie -> 200", () => {
    const sin = middleware(buildRequest("/ordenes"));
    expect(sin.status).toBe(307);
    expect(sin.headers.get("location")).toBe(
      "https://app.test/login?redirect=%2Fordenes",
    );

    const con = middleware(buildRequest("/ordenes", "cookie-de-sesion"));
    expect(con.status).toBe(200);
    expect(con.headers.get("location")).toBeNull();
  });

  // CARACTERIZACION, no comportamiento deseado: fija que HOY /paquete/[numGuia]
  // redirige a /login por no estar en PUBLIC_ROUTES. Si la feature 79 decide que
  // el rastreo es publico, este test DEBE cambiarse a proposito (y ese es el
  // punto: obliga a decidir en vez de olvidar, que es exactamente como
  // /recuperar-contrasena y /postulacion llegaron a estar inalcanzables).
  it("caracterizacion: hoy /paquete/[numGuia] redirige a /login sin cookie (pendiente feature 79)", () => {
    const res = middleware(buildRequest("/paquete/ABC123"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location as string).pathname).toBe("/login");
  });
});
