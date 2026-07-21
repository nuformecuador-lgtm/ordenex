import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

/**
 * Primer test de `middleware.ts` del repo (feature 78). Importa el middleware
 * REAL: reimplementar la logica aqui no verificaria nada.
 *
 * Contrato que se fija (antes solo implicito):
 * - ruta publica sin cookie -> `NextResponse.next()` (200), sin header `location`.
 * - ruta privada sin cookie -> redirige (307) a `/login?redirect=<pathname>`.
 * - ruta privada con cookie -> `NextResponse.next()` (200).
 *
 * Deliberadamente NO se afirma nada sobre el matching por prefijo
 * (`pathname.startsWith`), que puede endurecerse en una feature futura, ni que
 * la cookie se valide: el middleware solo mira su PRESENCIA, no su validez.
 *
 * CONSOLIDACION (merge de `dev`, 2026-07-17): este archivo ABSORBE
 * `tests/unit/middleware.test.ts`, que otra sesion aterrizo en `dev` en paralelo
 * (commit 43159c8, la mitad `/postulacion` de esta misma feature 78). Aquel
 * archivo se elimina para no dejar dos suites del mismo middleware. Sus 4 casos
 * quedan cubiertos aqui y sus aserciones de `res.status` (200/307) se
 * incorporaron a los casos equivalentes: NO se perdio cobertura.
 */

const BASE_URL = "https://app.test";

function buildRequest(pathname: string, session?: string): NextRequest {
  const request = new NextRequest(new URL(pathname, BASE_URL));
  if (session) request.cookies.set("session", session);
  return request;
}

describe("middleware — rutas publicas y guard de sesion", () => {
  it("deja pasar /recuperar-contrasena sin cookie de sesion", () => {
    const res = middleware(buildRequest("/recuperar-contrasena"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("deja pasar /postulacion sin cookie de sesion", () => {
    const res = middleware(buildRequest("/postulacion"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("deja pasar /login sin cookie de sesion", () => {
    const res = middleware(buildRequest("/login"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("deja pasar /api/health sin cookie de sesion", () => {
    const res = middleware(buildRequest("/api/health"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirige a /login con ?redirect= cuando una ruta privada no trae cookie", () => {
    const res = middleware(buildRequest("/ordenes"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.test/login?redirect=%2Fordenes",
    );
  });

  it("deja pasar una ruta privada cuando trae cookie de sesion", () => {
    const res = middleware(buildRequest("/ordenes", "cookie-de-sesion"));

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
