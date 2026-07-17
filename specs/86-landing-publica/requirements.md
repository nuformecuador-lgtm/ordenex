# Feature 86 — Landing pública en `/` (topbar + hero) y dashboard a `/dashboard`

## Requisitos (EARS)

Petición del humano: *"genera una landing page para la ruta /, para usuarios no
logueados, con un topbar con «trabaja con nosotros» que lo lleve directo a
postulaciones e «ingreso» junto con el logo; «ingreso» lleva al login; lo demás
se mantiene; mantén los colores que se están usando."*

> **Interpretación de «lo demás se mantiene» (regla 6 CLAUDE.md — no inventar):**
> NO existe ninguna landing/hero/marketing previa en el repo (grep
> `hero|landing|marketing` → 0 resultados). Por tanto «se mantiene» NO significa
> «conserva la landing anterior»: significa **no alterar el resto de la app**
> (dashboards por rol, login, postulación, recuperación, sidebar, menús). El
> alcance se acota a: crear la landing en `/`, mover el dashboard actual de `/`
> a `/dashboard` sin tocar su lógica, y ajustar las redirecciones internas que
> apuntaban a `/` como home.

### Ruta pública `/` (landing)

- **R1** — CUANDO un visitante sin cookie de sesión solicita `/`, el sistema DEBE
  responder con la landing pública (HTTP 200) sin redirigir a `/login`.

- **R2** — La landing DEBE renderizar un topbar que contenga: (a) el logo/wordmark
  de Ordenex, (b) un enlace «Trabaja con nosotros» cuyo destino es `/postulacion`,
  y (c) un enlace «Ingreso» cuyo destino es `/login`.

- **R3** — La landing DEBE renderizar un hero que contenga el wordmark/claim de
  Ordenex y los dos llamados a la acción: «Ingreso» (→ `/login`) y «Trabaja con
  nosotros» (→ `/postulacion`).

- **R4** — La landing DEBE reutilizar la paleta de marca ya existente
  (`navy` #0b2545, `brand` #f26419, `brand-soft`, `font-heading` Poppins) sin
  introducir nuevos tokens de color ni un archivo de configuración de Tailwind.

- **R5** — El único texto descriptivo permitido en la landing es el ya presente en
  el repo: «Plataforma de logística y entregas Ordenex» (metadata del root layout).
  El sistema NO DEBE introducir secciones, claims ni copy de marketing no
  verificables (servicios, testimonios, precios, footer con texto inventado).

### Componente logo compartido

- **R6** — El sistema DEBE exponer un componente `Logo` reutilizable que
  encapsule el wordmark textual actual de Ordenex (`font-heading text-2xl
  font-semibold tracking-tight`), y la landing DEBE usarlo.

### Redirección de la ruta `/` con sesión

- **R7** — SI existe cookie `session` Y la ruta solicitada es exactamente `/`,
  ENTONCES el middleware DEBE redirigir (HTTP 307) a `/dashboard`.

- **R8** — La regla de acceso público de `/` DEBE evaluarse por coincidencia
  EXACTA (`pathname === "/"`), y NO DEBE incorporarse a la lista de prefijos
  `PUBLIC_ROUTES` (que se evalúa con `startsWith`), para no volver pública toda
  la aplicación.

### Dashboard reubicado en `/dashboard`

- **R9** — El dashboard actualmente servido en `/` (ramificación por rol:
  `adminTienda` → dashboard de tienda; `maestro`/`admin` → dashboard maestro;
  resto → placeholder «Bienvenido») DEBE servirse en `/dashboard` conservando
  exactamente la misma lógica de roles, sin adiciones ni cambios de
  comportamiento.

- **R10** — MIENTRAS un visitante sin cookie de sesión solicita `/dashboard`, el
  sistema DEBE redirigir (HTTP 307) a `/login?redirect=%2Fdashboard` (regla actual
  del middleware para rutas privadas, sin excepción para `/dashboard`).

- **R11** — La ruta `/dashboard` DEBE seguir envuelta por el layout del grupo
  `(app)` (Sidebar + shell autenticado), igual que hoy lo está `/`.

### Redirecciones internas que apuntaban a la home

- **R12** — CUANDO un usuario con sesión válida visita `/login`, el sistema DEBE
  redirigir a `/dashboard` (antes `/`).

- **R13** — CUANDO un usuario con sesión válida visita `/recuperar-contrasena`,
  el sistema DEBE redirigir a `/dashboard` (antes `/`).

- **R14** — CUANDO un login/verificación OTP concluye con éxito y no hay
  parámetro `redirect` válido, el sistema DEBE navegar a `/dashboard` (destino por
  defecto de `getRedirectTarget`, antes `/`).

- **R15** — La protección contra open-redirect de `getRedirectTarget` DEBE
  conservarse: un `redirect` que no empiece por `/`, o que empiece por `//`, DEBE
  descartarse y caer al destino por defecto `/dashboard`.

### Regresión (no romper lo demás)

- **R16** — Una ruta privada distinta de `/` e `/dashboard` (p. ej. `/ordenes`) sin
  cookie DEBE seguir redirigiendo (307) a `/login?redirect=<pathname>`, y con
  cookie DEBE seguir pasando (200): el resto del guard de sesión no cambia.

## Trazabilidad requisito → test (resumen; el detalle vive en tasks.md)

| Req | Test |
| --- | --- |
| R1  | `tests/unit/auth/middleware.test.ts`: `/` sin sesión → 200 |
| R2  | `tests/components/LandingPage.test.tsx`: topbar con logo + 2 enlaces y sus `href` |
| R3  | `tests/components/LandingPage.test.tsx`: hero con los 2 CTA y sus `href` |
| R4  | `tests/components/LandingPage.test.tsx`: clases de marca presentes (navy/brand) |
| R5  | `tests/components/LandingPage.test.tsx`: sin secciones extra; copy = descripción base |
| R6  | `tests/components/Logo.test.tsx`: renderiza el wordmark; usado por la landing |
| R7  | `tests/unit/auth/middleware.test.ts`: `/` con sesión → 307 a `/dashboard` |
| R8  | `tests/unit/auth/middleware.test.ts`: `/xyz` con prefijo `/` no se vuelve público |
| R9  | `tests/components/HomePage*.test.tsx` reapuntados a `@/app/(app)/dashboard/page` |
| R10 | `tests/unit/auth/middleware.test.ts`: `/dashboard` sin sesión → 307 a `/login?redirect=%2Fdashboard` |
| R11 | Cubierto estructuralmente por ubicar la página en `(app)/dashboard/` (verificación manual + suite `(app)` verde) |
| R12 | `tests/components/LoginPage.test.tsx`: sesión válida → `NEXT_REDIRECT:/dashboard` |
| R13 | `tests/integration/recuperar-contrasena-page.test.tsx`: sesión válida → `NEXT_REDIRECT:/dashboard` |
| R14 | test de `getRedirectTarget`: sin param → `/dashboard` |
| R15 | test de `getRedirectTarget`: `//evil`, `http://` → `/dashboard` |
| R16 | `tests/unit/auth/middleware.test.ts`: `/ordenes` sin/con cookie (regresión) |

## Decisiones del gate F1.4 (resueltas por el humano 2026-07-17)

1. **Nombre del segmento del dashboard: `/dashboard`.** La mudanza destino es
   `app/(app)/dashboard/page.tsx`; el redirect del middleware con sesión, los
   redirects de login/recuperar-contrasena/LoginForm y los tests apuntan todos a
   `/dashboard`. (Se descartaron los nombres alternativos evaluados.)
2. **Dark mode: NO.** La landing usa el mismo esquema fijo (navy/brand) que
   login/postulación/recuperación, sin variante `.dark`. No hay toggle.
3. **Tagline: solo el copy existente.** El hero usa únicamente «Ordenex» +
   «Plataforma de logística y entregas» (de `metadata.description`). No se
   inventa copy adicional (regla 6 CLAUDE.md).
