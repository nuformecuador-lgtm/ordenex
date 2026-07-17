import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function request(pathname: string, conSesion = false): NextRequest {
  const req = new NextRequest(new URL(`https://ordenex.co${pathname}`));
  if (conSesion) req.cookies.set("session", "token-de-prueba");
  return req;
}

describe("middleware — rutas publicas", () => {
  it("deja pasar /postulacion sin sesion (feature 21, R22)", () => {
    const res = middleware(request("/postulacion"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("deja pasar /login sin sesion", () => {
    expect(middleware(request("/login")).status).toBe(200);
  });
});

describe("middleware — rutas protegidas", () => {
  it("redirige a /login conservando el destino cuando no hay sesion", () => {
    const res = middleware(request("/ordenes"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/ordenes");
  });

  it("deja pasar una ruta protegida cuando hay cookie de sesion", () => {
    expect(middleware(request("/ordenes", true)).status).toBe(200);
  });
});
