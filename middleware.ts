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

  // `/` es la landing publica (feature 86), pero por coincidencia EXACTA: NO se
  // agrega a PUBLIC_ROUTES porque esa lista se evalua con `startsWith` y `"/"`
  // es prefijo de TODO -> volveria publica la app entera (R8). Con sesion, la
  // home autenticada vive en /dashboard (R7); sin sesion se sirve la landing (R1).
  if (pathname === "/") {
    const sessionCookie = request.cookies.get("session");
    if (sessionCookie) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  if (isPublic) return NextResponse.next();

  // Las rutas bajo `/api` NO pasan por el guard de cookie: cada Route Handler
  // autoriza POR SI MISMO y con el esquema que le corresponde —
  // `/api/cron/*` con `Authorization: Bearer <CRON_SECRET>`,
  // `/api/ordenes/api-key/carga` con `Authorization: Bearer ordx_...`, y
  // `/api/ordenes/carga-masiva/chunk` con `resolveActorFromSession()`.
  //
  // Sin esta salida, el guard redirigia (307) a `/login` toda llamada sin
  // cookie `session`: Vercel Cron manda Bearer pero NO cookies, asi que los
  // cuatro crons y la ingesta por API key eran INALCANZABLES en produccion.
  // Ademas, responder a un cliente de API con un redirect a HTML nunca es
  // correcto; lo correcto es el 401 JSON que ya devuelve cada handler.
  //
  // Se excluye la RAMA ENTERA a proposito, no las rutas de hoy una por una:
  // que una ruta nueva quede inalcanzable por olvidar listarla es justo el bug
  // que ya ocurrio con /recuperar-contrasena y /postulacion (ver feature 78).
  if (pathname.startsWith("/api/")) return NextResponse.next();

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
