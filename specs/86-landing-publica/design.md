# Feature 86 — Diseño técnico

## Contexto verificado (contra el código, no supuestos)

- `app/(app)/page.tsx` (función `Home`) resuelve **`/`** hoy: llama
  `resolveActorFromSession()` y ramifica por rol (`adminTienda` →
  `AdminTiendaDashboard`; `maestro`/`admin` → `AdminMaestroDashboard`; resto/sin
  sesión → placeholder `<PageHeader title="Bienvenido">`). Está dentro del grupo
  `(app)`, cuyo `layout.tsx` pinta el Sidebar. Los route groups **no** añaden
  segmento de URL: `(app)/page.tsx` sirve `/`.
- No se puede tener a la vez `app/page.tsx` y `app/(app)/page.tsx`: ambos
  resolverían `/` → colisión de rutas en App Router. Por eso el dashboard debe
  moverse a un segmento real.
- `middleware.ts`: `PUBLIC_ROUTES = ["/login","/api/health",
  "/recuperar-contrasena","/postulacion"]`, evaluadas con
  `PUBLIC_ROUTES.some(r => pathname.startsWith(r))`. Sin cookie `session` →
  redirect 307 a `/login?redirect=<pathname>`. `config.matcher` ya excluye
  `_next/static`, `_next/image`, `favicon.ico`, `*.svg`.
- Wordmark textual `<span className="font-heading text-2xl font-semibold
  tracking-tight">Ordenex</span>` duplicado en `app/login/page.tsx`,
  `app/postulacion/page.tsx`, `app/recuperar-contrasena/page.tsx`. NO hay asset
  de logo en `public/` (solo svgs de plantilla + `icons/icon-192|512.png`);
  `next/image` no se usa en el repo.
- `app/globals.css` es Tailwind v4 puro (`@theme inline`, sin
  `tailwind.config.*`). Tokens disponibles: `navy`, `brand`, `brand-soft`,
  `brand-dark`, `font-heading`. `buttonVariants` en `components/ui/button.tsx`
  ya expone la variante `brand-outline` (no hay que crearla).
- Redirecciones a `/` como home: `app/login/page.tsx:21`,
  `app/recuperar-contrasena/page.tsx:20`, `getRedirectTarget` en
  `app/login/_components/LoginForm.tsx:30` y `:35`. El sidebar NO enlaza a `/`
  (grep `href: "/"` en `lib/auth/menu-visibility.ts` → 0) → el menú no se toca.
- Tests que importan `@/app/(app)/page`: `tests/components/HomePage.test.tsx`,
  `HomePageRol.test.tsx`, `HomePageMaestro.test.tsx` → deben reapuntar al nuevo
  path. Tests que esperan `NEXT_REDIRECT:/` para dashboard:
  `tests/components/LoginPage.test.tsx:62`,
  `tests/integration/recuperar-contrasena-page.test.tsx:57`.

## Decisiones de diseño

### 1. Nueva landing en `app/page.tsx` (Server Component público)

- Archivo `app/page.tsx`, **fuera** del grupo `(app)` → no hereda el Sidebar ni
  `resolveActorFromSession`. Server Component sin fetch de datos (no hay datos
  sensibles ni públicos que cargar; regla de arquitectura: no fetchear desde
  Server Component datos que no existen).
- Composición del topbar y el hero **inline en `app/page.tsx`**. Justificación
  (regla «sin sobre-ingeniería» de `architecture.md`): topbar y hero se usan en
  UN solo lugar y no tienen lógica reutilizable → viven junto a la página, no en
  `shared/`. El único trozo reutilizable (el wordmark, usado en 4 páginas) sí se
  promueve a componente (ver §2).
- Visual: reutiliza el patrón «brand panel» de las páginas públicas
  (`bg-navy` + `radial-gradient` naranja + wordmark + barra `bg-brand`).
- CTA: `<Link className={buttonVariants({ variant: "brand-outline" })} href=…>`
  para «Trabaja con nosotros» y «Ingreso». (Patrón shadcn: link estilizado con
  `buttonVariants`; no se usa `asChild` sobre `<Button>` para no arrastrar el
  `data-slot`/base-ui a un ancla simple.)

### 2. Componente `components/shared/Logo.tsx`

- Encapsula el wordmark textual actual. Props mínimas (p. ej. `className?` para
  ajustar tamaño/color según contexto navy vs claro). Sin dependencias de datos.
- **Fuera de alcance:** deduplicar login/postulación/recuperación para que usen
  `<Logo/>`. Se crea el componente y lo usa la landing; la refactorización de las
  otras 3 páginas queda para otra feature (evita tocar «lo demás»).

### 3. Middleware — regla de `/` exacta + redirect a `/dashboard`

Contrato nuevo (además del existente, que no se altera):

```
const { pathname } = request.nextUrl;
const sessionCookie = request.cookies.get("session");

// `/` es público, pero por coincidencia EXACTA (NO startsWith, que volvería
// pública toda la app). Con sesión, la home autenticada vive en /dashboard.
if (pathname === "/") {
  if (sessionCookie) return NextResponse.redirect(new URL("/dashboard", request.url)); // R7
  return NextResponse.next(); // R1
}

// ...resto sin cambios: PUBLIC_ROUTES (startsWith) + guard de sesión (R10, R16)
```

- `/dashboard` **no** entra en `PUBLIC_ROUTES` → sin cookie cae en el guard general
  y redirige a `/login?redirect=%2Fdashboard` (R10). Con cookie pasa (R16 análogo).
- `config.matcher` no cambia (ya cubre `/`).

### 4. Mover el dashboard a `app/(app)/dashboard/page.tsx`

- `git mv app/(app)/page.tsx app/(app)/dashboard/page.tsx`. **No se toca** el cuerpo
  de la función `Home` (misma ramificación por rol; R9). Sigue dentro de `(app)`
  → conserva el layout con Sidebar (R11).
- Imports relativos del archivo (`@/app/(app)/_components/…`) usan alias `@`, no
  rutas relativas → no se rompen al mover.

### 5. Ajuste de redirecciones internas → `/dashboard`

- `app/login/page.tsx`: `redirect("/")` → `redirect("/dashboard")` (R12).
- `app/recuperar-contrasena/page.tsx`: `redirect("/")` → `redirect("/dashboard")` (R13).
- `LoginForm.tsx` `getRedirectTarget`: los dos `return "/"` → `return "/dashboard"`
  (R14). Se conserva intacta la guarda open-redirect `startsWith("/") &&
  !startsWith("//")` (R15).

## Contratos I/O

| Ruta | Método | Sesión | Resultado |
| --- | --- | --- | --- |
| `/` | GET | ausente | 200, landing pública (R1) |
| `/` | GET | presente | 307 → `/dashboard` (R7) |
| `/dashboard` | GET | ausente | 307 → `/login?redirect=%2Fdashboard` (R10) |
| `/dashboard` | GET | presente | 200, dashboard por rol (R9, R11) |
| `/login` | GET | válida | `redirect("/dashboard")` (R12) |
| `/recuperar-contrasena` | GET | válida | `redirect("/dashboard")` (R13) |
| login/OTP OK | — | — | navega a `getRedirectTarget()` → `/dashboard` por defecto (R14/R15) |

Sin cambios de modelo de datos: **no hay tablas, RLS ni migraciones** en esta
feature (es 100% enrutado + UI estática). No hay endpoints API nuevos ni
Server Actions.

## Alternativas descartadas

### A. Landing dentro de un route group `(marketing)` con su propio layout
Crear `app/(marketing)/page.tsx` + `app/(marketing)/layout.tsx`.
**Descartada:** un `page.tsx` en cualquier route group en la raíz sigue
resolviendo `/`, así que igualmente colisiona con `(app)/page.tsx` y no evita
mover el dashboard. Añade un layout extra para una única página estática → viola
«sin sobre-ingeniería». `app/page.tsx` directo es más simple y equivalente.

### B. Mantener el dashboard en `/` y detectar «no logueado» dentro de la página
Servir landing o dashboard desde el mismo `(app)/page.tsx` según `resolveActor`.
**Descartada:** (1) la landing quedaría bajo el layout `(app)` (Sidebar), que no
debe verse sin sesión; (2) mezcla dos responsabilidades en un archivo y complica
el guard del middleware (habría que exceptuar `/` del guard general de forma
frágil); (3) contradice R7/R8, que separan claramente `/` público de `/dashboard`
autenticado. El humano decidió segmento real `/dashboard`.

### C. Añadir `"/"` a `PUBLIC_ROUTES`
**Descartada — catastrófica:** `PUBLIC_ROUTES` se evalúa con `startsWith`;
`"/".startsWith` es prefijo de todo → toda la app se volvería pública. Por eso
`/` se resuelve con match EXACTO fuera de esa lista (R8).

### D. Crear un asset de logo (SVG/PNG) + `next/image`
**Descartada:** no existe asset de logo en el repo y `next/image` no se usa en
ninguna parte; introducirlo excede el alcance y la petición («junto con el
logo», siendo el logo hoy un wordmark textual). Se reutiliza el wordmark en
`<Logo/>`.
