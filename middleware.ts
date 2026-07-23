import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";
import { isSessionActive } from "@/lib/auth/session-guard";

// Rutas alcanzables SIN cookie `session`. Son las paginas publicas fuera de
// `(app)`: login, recuperacion de contrasena (feature 20) y postulacion de
// mensajero (feature 21, unica via de auto-registro, su R22 exige acceso sin
// sesion).
const PUBLIC_ROUTES = [
  "/login",
  "/api/health",
  "/recuperar-contrasena",
  "/postulacion",
  // Feature 106: documentacion publica de la API por API key (Swagger UI). Ambas rutas deben ser
  // publicas: `/api-docs` (la pagina que renderiza Swagger UI) y `/api/docs/openapi` (el spec JSON
  // que la pagina consume). El middleware NO deja pasar `/api/*` por defecto, asi que hay que
  // listar el prefijo `/api/docs` explicitamente o el spec redirige a /login y la UI no renderiza.
  "/api-docs",
  "/api/docs",
];

// Endpoints que NO usan cookie de sesion porque traen su PROPIA autenticacion
// por `Authorization: Bearer ...`, validada dentro del route handler:
//  - `/api/cron/*`  -> CRON_SECRET (features 41 y siguientes)
//  - `/api/ordenes/api-key/*` -> API key `ordx_...` (feature 88)
//  - `/api/webhooks/*` -> firma HMAC del proveedor externo (feature 109: WhatsApp valida
//    `X-Hub-Signature-256` sobre el cuerpo crudo; el handshake GET valida `hub.verify_token`).
//    Meta llama sin cookie; el guard de sesion lo mandaba a /login, que Meta nunca alcanza.
// El guard de sesion los dejaba en 307 a /login, es decir: se autenticaban
// contra una puerta que nunca alcanzaban. Se excluyen aqui; su auth real vive
// en el handler y sigue siendo obligatoria.
const SELF_AUTH_ROUTES = ["/api/cron", "/api/ordenes/api-key", "/api/webhooks"];

// Rutas privadas cuyo rechazo va a `/` en vez de a `/login`: el rastreo de un
// paquete es cara al publico, mandar a un formulario de login a quien solo
// pego una guia es un callejon. Decide la mitad "no publica" de la feature 79.
const REDIRECT_TO_ROOT = ["/paquete"];

function matches(pathname: string, routes: string[]): boolean {
  return routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (matches(pathname, PUBLIC_ROUTES)) return NextResponse.next();
  if (matches(pathname, SELF_AUTH_ROUTES)) return NextResponse.next();

  // Validacion REAL contra la DB: existencia de la cookie no es autenticacion.
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId && (await isSessionActive(sessionId))) {
    return NextResponse.next();
  }

  const response = matches(pathname, REDIRECT_TO_ROOT)
    ? NextResponse.redirect(new URL("/", request.url))
    : redirectALogin(request, pathname);

  // La cookie que acaba de fallar la validacion se borra: si no, el navegador
  // la sigue mandando y cada request repite el roundtrip a la DB para nada.
  if (sessionId) response.cookies.delete(SESSION_COOKIE_NAME);

  return response;
}

function redirectALogin(request: NextRequest, pathname: string): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Prisma necesita el runtime de Node: el default (edge) no puede abrir la
  // conexion TCP a Postgres que exige `isSessionActive`.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
