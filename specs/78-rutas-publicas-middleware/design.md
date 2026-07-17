# Feature 78 — Diseño técnico

## Resumen

Cambio de una línea en `middleware.ts` + el primer test de `middleware.ts` del repo +
un `TODO:` en `password-reset.ts`. Sin migración, sin tabla, sin RLS, sin endpoint
nuevo, sin dependencia nueva.

## ⚠️ Desambiguación obligatoria: "las 4 públicas" son DOS conjuntos distintos

La descripción original de la feature 78 decía *"sin cookie → las 4 públicas pasan"*
refiriéndose a las **4 rutas públicas fuera de `(app)`**, lo que contradecía la decisión
(a). El leader corrigió la descripción en `feature_list.json` el 2026-07-16. Hay una
**coincidencia numérica que confunde**: ambos conjuntos tienen 4 elementos, pero **no
son los mismos**.

| Conjunto | Elementos | En `PUBLIC_ROUTES`? |
|---|---|---|
| Las 4 páginas públicas fuera de `(app)` | `login`, `postulacion`, `paquete/[numGuia]`, `recuperar-contrasena` | **no todas** |
| `PUBLIC_ROUTES` tras esta feature (4 entradas) | `/login`, `/api/health`, `/recuperar-contrasena`, `/postulacion` | sí, por definición |

**`/paquete` NO entra en `PUBLIC_ROUTES` en esta feature** (decisión (a); es la feature
79). `/api/health` no es una página, pero sí es una entrada de la lista. Cualquier test
que afirme que `/paquete` pasa sin cookie **debe fallar** y estaría mal escrito: lo
correcto es el test de caracterización de R6 (abajo).

## Modelo de datos

**Ninguno.** No hay tablas, columnas, migraciones ni políticas RLS en esta feature.
Nota de stack (verificada, no supuesta): la auth de este repo **no es Supabase Auth**;
es auth propia sobre Prisma/Postgres con sesión en cookie (`Usuario.passwordHash`,
`Session`, `EmailOtpChallenge` en `db/schema.prisma`). Supabase se usa **solo** para
Storage. Por eso no existe ni debe existir `resetPasswordForEmail`,
`updateUser({password})`, `exchangeCodeForSession` ni `app/auth/callback`.

## Cambio 1 — `PUBLIC_ROUTES` (R1, R2, R3)

Estado actual, `middleware.ts:3`:

```ts
const PUBLIC_ROUTES = ["/login", "/api/health"];
```

Estado objetivo:

```ts
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
```

El guard (`:11-16`), el matcher (`:22`) y la comparación `pathname.startsWith(r)`
(`:8`) **no se tocan**.

### Por qué esto basta

Las páginas ya se autoprotegen donde corresponde: `app/recuperar-contrasena/page.tsx`
redirige a `/` si ya hay sesión válida (mismo patrón que `app/login/page.tsx`), así que
abrir la ruta en el middleware no expone el formulario a un usuario autenticado.
`app/postulacion/page.tsx` no lee cookies ni concede sesión y solo carga catálogos
públicos no sensibles (tipos de identificación, vehículos), por diseño de su R22.

## Cambio 2 — Tests de `middleware.ts` (R1–R6)

Archivo: `tests/unit/auth/middleware.test.ts` (junto a `menu-visibility.test.ts`, el
otro test de auth del repo).

Entorno: **node**, el default de `vitest.config.ts:10`. No lleva la directiva
`// @vitest-environment jsdom`: `middleware.ts` es código de servidor y no necesita DOM.

### Patrón propuesto (citado)

No hay precedente de `NextRequest` en `tests/`: los tests de ruta existentes usan el
`Request` estándar de la Web API (p. ej.
`tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts:41`,
`tests/integration/actions/corte-diario-route.test.ts:22`). Ese patrón **no sirve
aquí**, porque `middleware.ts` consume `request.nextUrl` (`:6`) y `request.cookies`
(`:11`), que solo existen en `NextRequest`. El patrón propuesto es construir el
`NextRequest` real y usar su API de cookies:

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function buildRequest(pathname: string, session?: string): NextRequest {
  const request = new NextRequest(new URL(pathname, "https://app.test"));
  if (session) request.cookies.set("session", session);
  return request;
}
```

Asserts:

- **Pasa** (`NextResponse.next()`): `expect(res.headers.get("location")).toBeNull()`.
  Se afirma sobre la ausencia de `location`, no sobre `res.status`, porque es la señal
  que distingue `next()` de `redirect()` sin depender del status que Next elija.
- **Redirige** (`NextResponse.redirect()`): `expect(res.headers.get("location")).toBe(
  "https://app.test/login?redirect=%2Fordenes")`. La URL completa fija a la vez el
  destino `/login` **y** el `?redirect=` codificado (R4), que es el contrato que el
  `LoginForm` consume.

El alias `@` resuelve a la raíz del repo (`vitest.config.ts:24-28`), así que
`@/middleware` importa el archivo real. **Se importa el middleware de producción, no una
copia**: un test que reimplemente la lógica no verificaría nada.

### Riesgo conocido y fallback

`NextRequest` en entorno node bajo vitest depende de que los globals Web (`Request`,
`Headers`, `URL`) estén disponibles; con Node 18+ y Next 16.2.10 debería instanciarse
sin `next/server` mock. **No se pudo ejecutar la sonda** durante la autoría del spec
(el spec_author no tiene shell), así que la task T1 lo verifica **antes** de escribir el
resto de casos. Fallback si `NextRequest` no instancia en node: usar
`// @vitest-environment jsdom` (jsdom ^29 ya está instalado); segundo fallback: un doble
mínimo con `nextUrl` y `cookies.get()`, que es **peor** (se aleja del objeto real) y solo
se acepta si los dos anteriores fallan, documentándolo en `progress/impl_78.md`.

### Casos

| # | Ruta | Cookie | Espera | R |
|---|------|--------|--------|---|
| 1 | `/recuperar-contrasena` | no | pasa | R1 |
| 2 | `/postulacion` | no | pasa | R2 |
| 3 | `/login` | no | pasa | R3 |
| 4 | `/api/health` | no | pasa | R3 |
| 5 | `/ordenes` | no | redirige a `/login?redirect=%2Fordenes` | R4 |
| 6 | `/ordenes` | sí | pasa | R5 |
| 7 | `/paquete/ABC123` | no | redirige a `/login` (caracterización) | R6 |

El caso 5 usa `/ordenes` por ser una ruta privada real de `(app)`. Los casos 1 y 2
**fallan hoy** contra el `middleware.ts` actual: son la prueba de regresión del bug, y
deben escribirse y verse fallar **antes** del cambio 1 (task T2 → T3).

### Caso 7 — test de caracterización de `/paquete` (R6)

Decisión del humano (P2, 2026-07-16). **Pasa hoy y debe seguir pasando tras el cambio 1**
(a diferencia de los casos 1 y 2): `/paquete` no entra en `PUBLIC_ROUTES`.

No documenta un comportamiento deseado sino el **estado actual pendiente de decisión**.
El objetivo es que la feature 79 se encuentre este test en rojo al abrir `/paquete` y
tenga que **invertirlo deliberadamente**, en vez de que la ruta siga bloqueada por
olvido — que es exactamente cómo `/recuperar-contrasena` y `/postulacion` llegaron a
este punto. El nombre del test y un comentario deben decirlo, p. ej.:

```ts
// CARACTERIZACION, no comportamiento deseado: fija que HOY /paquete/[numGuia]
// redirige a /login por no estar en PUBLIC_ROUTES. Si la feature 79 decide que
// el rastreo es publico, este test DEBE cambiarse a proposito (y ese es el
// punto: obliga a decidir en vez de olvidar).
it("caracterizacion: hoy /paquete/[numGuia] redirige a /login sin cookie (pendiente feature 79)", ...)
```

## Cambio 3 — `TODO:` del proveedor de correo (R7)

**Un solo archivo**: `lib/actions/password-reset.ts:31-38`, donde producción elige el
stub (`const emailProvider = new StubEmailProvider();`, `:35`). Decisión del humano (P3).

El `TODO:` anota: no hay proveedor real (no hay Resend/SendGrid/SES en `package.json`);
`StubEmailProvider` solo hace `console.info` de metadata; la entrega del OTP depende
**hoy** del `console.log` de `OtpChallengeIssuer.ts:39` en los logs del servidor;
`lib/interfaces/external/IEmailProvider.ts` ya está lista para la implementación real;
**los comentarios de `EmailProvider.ts` y `OtpChallengeIssuer.ts` describen un estado
que aún no existe y quedan desactualizados a propósito hasta la feature 80**; saldarlo
todo es la **feature 80**.

**No se tocan** (decisión del humano, "el log es para uso humano, déjalo por ahora"):
- `OtpChallengeIssuer.ts:39` — el `console.log` del OTP (decisión (c), riesgo aceptado:
  hoy es el único modo de completar el flujo; quitarlo sin proveedor de correo dejaría
  la recuperación irrecuperable).
- `OtpChallengeIssuer.ts:27-30` (*"El codigo en claro solo viaja por email"*) y
  `EmailProvider.ts:3-9` (*"nunca el codigo en claro"*) — hoy literalmente falsos, se
  difieren a la feature 80.

Consecuencia asumida: el código conserva dos comentarios que mienten, y este `TODO:` es
el **único punto que dice la verdad**. Por eso R7 exige que el `TODO:` los señale por
nombre: un lector que llegue a `EmailProvider.ts` primero seguirá siendo inducido a
error, y esa deuda es explícita, fechada y atada a la 80 — no un descuido.

## Alternativas descartadas

### A) Endurecer el match a exacto (`pathname === r`) — DESCARTADA

`pathname.startsWith("/login")` abre también `/login-interno`, `/loginX` o cualquier
ruta futura que comparta el prefijo: es un prefijo, no una ruta. La versión estricta
sería `pathname === r || pathname.startsWith(r + "/")`.

**Se descarta por decisión explícita del humano (b), 2026-07-16.** Razones: (1) ninguna
ruta privada actual comparte esos prefijos, así que el riesgo hoy es cero; (2) esta
feature arregla un bug de una línea y cambiar la lógica de matching que hoy funciona
mete un segundo cambio, con su propio riesgo, en la misma entrega; (3) `/api/health` sí
depende del prefijo si alguna vez cuelga subrutas. Un endurecimiento futuro necesita su
propia feature y sus propios tests. **Los tests de esta feature no deben afirmar nada
sobre el matching por prefijo**, para no congelar como contrato algo que quizá se
endurezca luego. (Nota: el caso 7 usa `/paquete/ABC123`, que se apoya en el prefijo solo
de forma incidental — hoy `/paquete` no está en la lista, así que no hay contrato de
prefijo que congelar.)

### B) Mover las páginas públicas a un route group `(public)` y excluirlo del matcher — DESCARTADA

Más "arquitectónico": el matcher dejaría de tocar lo público y la lista de rutas no se
volvería a desincronizar. Se descarta porque exige mover cuatro directorios de `app/`,
tocar la feature 79 (que aún no decidió si `/paquete` es pública) y reencaminar tests de
página existentes — todo para arreglar un bug de una línea. Coste y radio de impacto
desproporcionados frente al beneficio. Además el matcher seguiría necesitando una lista
(la del group), así que no elimina la clase de bug, solo la muda de sitio. El test de
middleware que sí entrega esta feature es la defensa real contra la reincidencia.

### C) Chequear la sesión en cada página pública en vez de en el middleware — DESCARTADA

Duplicaría el guard en N páginas y es exactamente la clase de error que causó este bug:
la verdad sobre "qué es público" quedaría repartida. La única fuente de verdad se
mantiene en `middleware.ts:3`.

## Contratos de entrada/salida

Sin cambios. `middleware(request: NextRequest) => NextResponse` mantiene su firma. El
contrato observable que esta feature **fija con tests** (antes solo implícito) es:

- Ruta pública, sin cookie → `NextResponse.next()`, sin header `location`.
- Ruta privada, sin cookie → `NextResponse.redirect("/login?redirect=<pathname>")`.
- Ruta privada, con cookie `session` → `NextResponse.next()`.

Nótese que el middleware solo verifica la **presencia** de la cookie, no su validez
(`:11-12`); la validación real vive en las páginas/acciones. Esta feature **no cambia**
eso y los tests no deben afirmar lo contrario.

## Integraciones

Ninguna nueva. Se documenta explícitamente la **ausencia** de proveedor de correo
(cambio 3), atada a la feature 80.

## Verificación

- `npm test` — tests de middleware nuevos en verde (y los casos 1 y 2 en rojo antes del
  cambio 1).
- `npm run typecheck`, `npm run lint`, `./init.sh` — en verde.
- **Prueba manual en sesión anónima** (ventana privada, sin cookie `session`):
  `/recuperar-contrasena` y `/postulacion` deben **cargar**, no redirigir a `/login`.
  Es la verificación que ningún unit test sustituye, porque el bug era de runtime.
- **Baseline: MEDIR en worktree limpio**, no citar la bitácora. Precedente de las
  features 72/73/76: `dev` arrastra ~13-20 flakes de timeout 5000ms bajo carga que pasan
  en aislado; un baseline citado de la bitácora caduca con cualquier PR ajeno.
