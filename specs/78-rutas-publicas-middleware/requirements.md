# Feature 78 — Rutas públicas alcanzables: recuperación de contraseña y postulación

## Contexto

La lógica y las pantallas de recuperación de contraseña (feature 20, `done`) y de
postulación de mensajero (feature 21, `done`) **existen y están completas**. Esta
feature **no genera ni modifica** ese flujo.

El defecto es de una línea, en `middleware.ts:3`:

```ts
const PUBLIC_ROUTES = ["/login", "/api/health"];
```

El matcher (`middleware.ts:22`) cubre toda la app y el guard (`:11-16`) redirige a
`/login` cualquier request sin cookie `session`. Existen cuatro rutas públicas fuera
de `(app)` — `login`, `postulacion`, `paquete/[numGuia]`, `recuperar-contrasena` — y
solo `/login` está listada. Consecuencia verificada:

- `/recuperar-contrasena` es inalcanzable en runtime justo para quien la necesita
  (usuario sin sesión).
- `/postulacion` es inalcanzable, lo que **viola el R22 de la feature 21 ya cerrada**.
  Su propio comentario (`app/postulacion/page.tsx:13-15`) declara: *"pagina PUBLICA de
  postulacion de mensajero (R1). Es la unica via de auto-registro. Acceso sin sesion
  ni cookie (R22)"*. El único camino de auto-registro del sistema está cerrado.

Ningún test lo caza: no existe test de `middleware.ts` en el repo (`tests/unit/auth/`
solo contiene `menu-visibility.test.ts`); los tests de página montan el componente
directo y se saltan el middleware. Ese es exactamente el hueco por el que se coló.

## Alcance

Dentro: (1) las dos rutas en `PUBLIC_ROUTES`, (2) tests reales de `middleware.ts`
—incluido un test de **caracterización** de `/paquete`—, (3) un `TODO:` que documenta
el estado real del proveedor de correo.

Fuera, por **decisión explícita del humano (2026-07-16)**, no reabrir:
- Abrir `/paquete/[numGuia]` → feature 79 (por si el rastreo debe exigir sesión). Esta
  feature solo **fija su estado actual** con un test (R6); no lo cambia.
- Endurecer el match a exacto → se conserva `pathname.startsWith(r)` tal cual.
- El `console.log("Codigo OTP generado:", code)` de `OtpChallengeIssuer.ts:39` → se
  queda; riesgo aceptado ("el log es para uso humano, déjalo por ahora"); feature 80.
- Los comentarios de `OtpChallengeIssuer.ts:27-30` y `EmailProvider.ts:3-9`, hoy
  literalmente falsos → **no se tocan**; se difieren a la feature 80.
- Cablear un proveedor de correo real → feature 80.
- La lógica de reset, el OTP y la UI.

## Requisitos

### Acceso sin sesión a las rutas públicas

**R1.** MIENTRAS la request no presente la cookie `session`, CUANDO la ruta solicitada
sea `/recuperar-contrasena`, el sistema DEBE permitir que la request continúe hacia la
página sin redirigir.

**R2.** MIENTRAS la request no presente la cookie `session`, CUANDO la ruta solicitada
sea `/postulacion`, el sistema DEBE permitir que la request continúe hacia la página
sin redirigir.

**R3.** MIENTRAS la request no presente la cookie `session`, CUANDO la ruta solicitada
sea `/login` o `/api/health`, el sistema DEBE permitir que la request continúe sin
redirigir (no-regresión del comportamiento vigente).

### Protección de rutas privadas (no-regresión)

**R4.** MIENTRAS la request no presente la cookie `session`, CUANDO la ruta solicitada
no sea pública, el sistema DEBE responder una redirección a `/login` incluyendo el
parámetro de consulta `redirect` con el pathname solicitado.

**R5.** MIENTRAS la request presente la cookie `session`, CUANDO la ruta solicitada no
sea pública, el sistema DEBE permitir que la request continúe sin redirigir.

### Caracterización de `/paquete/[numGuia]`

**R6.** MIENTRAS la request no presente la cookie `session`, CUANDO la ruta solicitada
sea `/paquete/<numGuia>`, el sistema DEBE responder una redirección a `/login`.

> **R6 NO afirma que este sea el comportamiento deseado.** Es un test de
> **caracterización**: fija el estado **actual** (`/paquete` no está en `PUBLIC_ROUTES`)
> y lo deja pendiente de decisión en la **feature 79**. Su propósito es que la 79 tenga
> que ponerlo en rojo e **invertirlo deliberadamente** —decidiendo si el rastreo exige
> sesión— en lugar de que `/paquete` siga bloqueada por olvido, que es exactamente cómo
> `/recuperar-contrasena` y `/postulacion` llegaron hasta aquí. El nombre del test y su
> comentario deben decir esto.

### Documentación del estado real del correo

**R7.** El sistema DEBE documentar en el código, en el punto donde producción instancia
el proveedor de correo, que: no existe proveedor real; `StubEmailProvider` solo emite
`console.info` con metadata; la entrega del OTP depende hoy del log del servidor;
`lib/interfaces/external/IEmailProvider.ts` ya está lista para la implementación real;
los comentarios de `EmailProvider.ts` y `OtpChallengeIssuer.ts` describen un estado que
aún no existe y quedan **desactualizados a propósito** hasta la feature 80; y que saldar
todo esto es la **feature 80**.

> Con la decisión del humano de no tocar esos comentarios, este `TODO:` queda como el
> **único punto del código que dice la verdad** sobre el correo, y por eso debe apuntar
> al resto.

## Trazabilidad prevista (R → test)

| R  | Test previsto (`tests/unit/auth/middleware.test.ts`) |
|----|------|
| R1 | `deja pasar /recuperar-contrasena sin cookie de sesion` |
| R2 | `deja pasar /postulacion sin cookie de sesion` |
| R3 | `deja pasar /login y /api/health sin cookie de sesion` |
| R4 | `redirige a /login con ?redirect= cuando una ruta privada no trae cookie` |
| R5 | `deja pasar una ruta privada cuando trae cookie de sesion` |
| R6 | `caracterizacion: hoy /paquete/[numGuia] redirige a /login sin cookie (pendiente feature 79)` |
| R7 | Revisión del reviewer (comentario `TODO:` presente y correcto) — no automatizable |

R7 es documental: se verifica por inspección del reviewer, no por assert. Se declara
aquí de forma explícita para que no se lea como requisito sin test.

## Preguntas abiertas

Ninguna. Las tres preguntas de la gate F1.4 (P1 alcance de `/paquete`, P2 test de
caracterización, P3 ubicación del `TODO:`) fueron resueltas por el humano el 2026-07-16
e incorporadas arriba.
