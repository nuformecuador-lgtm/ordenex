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
// por `Authorization: Bearer ...` o firma, validada dentro del route handler:
//  - `/api/cron/*`  -> CRON_SECRET (features 41 y siguientes)
//  - `/api/ordenes/api-key/*` -> API key `ordx_...` (feature 88)
//  - `/api/webhooks/*` -> firma HMAC del proveedor externo (feature 120: WhatsApp valida
//    `X-Hub-Signature-256` sobre el cuerpo crudo; el handshake GET valida `hub.verify_token`).
//    Meta llama SIN cookie; el guard de sesion lo mandaba a /login, que Meta nunca alcanza.
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

  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  // Feature 86: `/` es la landing publica. Se resuelve por coincidencia EXACTA (no entra en
  // PUBLIC_ROUTES, cuyo `startsWith` volveria publica la app entera, R8). Con cookie de sesion
  // la home autenticada vive en /dashboard (R7) —cuyo propio guard revalida la sesion contra la
  // DB, asi que basta la presencia de la cookie para el redirect—; sin cookie se sirve la
  // landing publica (R1). Sin este caso la landing quedaba detras del login (regresion del merge).
  if (pathname === "/") {
    if (sessionId) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  // Validacion REAL contra la DB: existencia de la cookie no es autenticacion.
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
  // Los ESTATICOS DE IMAGEN de `public/` quedan fuera del guard. Antes solo se
  // excluia `.svg`, asi que una peticion de `/landing/hero-bodega.jpg` entraba
  // aqui, no casaba con ninguna ruta publica, se trataba como privada y salia en
  // 307 a /login: el navegador recibia HTML donde esperaba una imagen y la
  // landing publica se veia SIN NINGUNA FOTO (solo sobrevivian los `.svg`, que ya
  // estaban excluidos). Feature 86: la landing es publica y sus fotos tambien.
  //
  // No afloja nada: lo que vive en `public/` ya se sirve tal cual a cualquiera que
  // sepa la URL —el middleware nunca fue su control de acceso— y la exclusion se
  // acota a extensiones de imagen, asi que el resto de `public/` (los `.xlsx` de
  // geografia, por ejemplo) sigue pasando por el guard exactamente igual que antes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|jpg|jpeg|png|gif|webp|avif|ico)).*)",
  ],
};
