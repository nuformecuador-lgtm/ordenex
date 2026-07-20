import { NextRequest, NextResponse } from "next/server";

// Rutas alcanzables SIN cookie `session`. Son las paginas publicas fuera de
// `(app)`: login, recuperacion de contrasena (feature 20) y postulacion de
// mensajero (feature 21, unica via de auto-registro, su R22 exige acceso sin
// sesion). `/paquete/[numGuia]` queda deliberadamente fuera: feature 79 decide
// si el rastreo exige sesion (ver el test de caracterizacion en
// tests/unit/auth/middleware.test.ts).
const PUBLIC_ROUTES = [
  "/login",
  "/api/health",
  "/recuperar-contrasena",
  "/postulacion",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  if (isPublic) return NextResponse.next();

  const sessionCookie = request.cookies.get("session");
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
